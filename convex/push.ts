import { v } from "convex/values";
import {
  internalMutationGeneric,
  internalQueryGeneric,
} from "convex/server";
import { PushNotifications } from "@convex-dev/expo-push-notifications";
import { components } from "./_generated/api";
import { memberMutationV, memberQueryV } from "./_lib/auth";
import { fail } from "./_lib/errors";
import { limitOrThrow } from "./_lib/ratelimit";
import { notifyUser } from "./_lib/notify";

/**
 * Push registration (specs §6.4, F-303). Tokens are stored by the Expo
 * Push Notifications component, keyed by the member's auth user id — the
 * same key _lib/notify sends to. Web Push subscriptions arrive with the
 * PWA work in a later phase (roadmap P1 is Expo/Android push).
 */
const push = new PushNotifications<string>(components.pushNotifications);

export const registerExpoToken = memberMutationV({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await push.recordToken(ctx, {
      userId: ctx.profile.authUserId,
      pushToken: args.token,
    });
    return null;
  },
});

export const unregister = memberMutationV({
  args: { token: v.optional(v.string()), endpoint: v.optional(v.string()) },
  handler: async (ctx) => {
    await push.removeToken(ctx, { userId: ctx.profile.authUserId });
    return null;
  },
});

/** push.sendTest (specs §6.4) — NTF-18, rate-limited 3/hour. */
export const sendTest = memberMutationV({
  args: {},
  handler: async (ctx) => {
    await limitOrThrow(ctx, "pushTest", ctx.profile._id);
    await notifyUser(ctx, {
      recipient: ctx.profile,
      template: "NTF-18",
      params: {},
      url: "/donor/alert-guide",
      channelId: "updates",
    });
    return null;
  },
});

// ── Web Push (F-303) ───────────────────────────────────────────────────

/** Whether this deployment can actually send Web Push (VAPID keys in
 *  env, RB-8). Clients render the honest state from this — never a
 *  fake "subscribed" when sending is impossible. */
export const webPushStatus = memberQueryV({
  args: {},
  handler: async () => {
    return { configured: Boolean(process.env.VAPID_PUBLIC_KEY) };
  },
});

/**
 * push.registerWebSubscription (specs §6.4) — stores the browser's
 * PushSubscription for the caller. Upserted by endpoint: a browser
 * belongs to whoever is signed in on it now. Returns whether the
 * deployment is configured to send (VAPID), so the client can tell
 * the member the truth about delivery.
 */
export const registerWebSubscription = memberMutationV({
  args: {
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let url: URL;
    try {
      url = new URL(args.endpoint);
    } catch {
      fail("ERR_VALIDATION", {}, "endpoint");
    }
    if (url!.protocol !== "https:" || !args.p256dh || !args.auth) {
      fail("ERR_VALIDATION", {}, "endpoint");
    }
    const existing = await ctx.db
      .query("webPushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        profileId: ctx.profile._id,
        p256dh: args.p256dh,
        auth: args.auth,
        userAgent: args.userAgent,
        failures: 0,
      });
    } else {
      await ctx.db.insert("webPushSubscriptions", {
        profileId: ctx.profile._id,
        endpoint: args.endpoint,
        p256dh: args.p256dh,
        auth: args.auth,
        userAgent: args.userAgent,
        failures: 0,
      });
    }
    return { configured: Boolean(process.env.VAPID_PUBLIC_KEY) };
  },
});

/** internal.push.webSubscriptionsFor — the sender action's read. */
export const webSubscriptionsFor = internalQueryGeneric({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("webPushSubscriptions")
      .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
      .collect();
  },
});

/** internal.push.webPushSucceeded — reset the failure counter (§7.6). */
export const webPushSucceeded = internalMutationGeneric({
  args: { subscriptionId: v.id("webPushSubscriptions") },
  handler: async (ctx, args) => {
    const sub = await ctx.db.get(args.subscriptionId);
    if (sub) {
      await ctx.db.patch(sub._id, { failures: 0, lastSuccessAt: Date.now() });
    }
    return null;
  },
});

/** internal.push.webPushFailed — count a failure; the 5th consecutive
 *  failure removes the subscription (§7.6). */
export const webPushFailed = internalMutationGeneric({
  args: { subscriptionId: v.id("webPushSubscriptions") },
  handler: async (ctx, args) => {
    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub) return null;
    if (sub.failures + 1 >= 5) {
      await ctx.db.delete(sub._id);
    } else {
      await ctx.db.patch(sub._id, { failures: sub.failures + 1 });
    }
    return null;
  },
});

/** internal.push.webPushRemove — endpoint gone (404/410 from the push
 *  service): drop the subscription immediately. */
export const webPushRemove = internalMutationGeneric({
  args: { subscriptionId: v.id("webPushSubscriptions") },
  handler: async (ctx, args) => {
    const sub = await ctx.db.get(args.subscriptionId);
    if (sub) await ctx.db.delete(sub._id);
    return null;
  },
});
