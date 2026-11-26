import { v } from "convex/values";
import { PushNotifications } from "@convex-dev/expo-push-notifications";
import { components } from "./_generated/api";
import { memberMutationV } from "./_lib/auth";
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
