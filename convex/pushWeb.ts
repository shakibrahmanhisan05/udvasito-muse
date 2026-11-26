"use node";
/**
 * Web Push sender (F-303, specs §7.6) — Node action because payload
 * encryption needs Node crypto. Called by _lib/notify via the scheduler
 * whenever a notification recipient holds web subscriptions.
 *
 * Honest degradation: with no VAPID keys in the deployment env the
 * action reports `not_configured` and sends nothing — the in-app inbox
 * remains the record, exactly as on devices without push.
 *
 * Delivery bookkeeping (§7.6): success resets the failure counter;
 * 404/410 removes the dead subscription at once; other failures count
 * up and the subscription is removed after 5 consecutive failures.
 */
import { internalActionGeneric, makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import {
  encryptWebPushPayload,
  vapidAuthorization,
} from "./_lib/webPushCrypto";

const subsRef = makeFunctionReference<"query">("push:webSubscriptionsFor");
const successRef = makeFunctionReference<"mutation">("push:webPushSucceeded");
const failureRef = makeFunctionReference<"mutation">("push:webPushFailed");
const removeRef = makeFunctionReference<"mutation">("push:webPushRemove");

export const sendToProfile = internalActionGeneric({
  args: {
    profileId: v.id("profiles"),
    title: v.string(),
    body: v.string(),
    url: v.string(),
    tag: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const subs = await ctx.runQuery(subsRef, { profileId: args.profileId });
    if (subs.length === 0) return { sent: 0, reason: "no_subscriptions" as const };

    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT ?? "https://udvasito.org";
    if (!publicKey || !privateKey) {
      return { sent: 0, reason: "not_configured" as const };
    }

    const payload = JSON.stringify({
      title: args.title,
      body: args.body,
      url: args.url,
      tag: args.tag ?? "udvasito",
    });
    let sent = 0;
    for (const sub of subs) {
      try {
        const body = encryptWebPushPayload(
          { p256dh: sub.p256dh, auth: sub.auth },
          payload,
        );
        const res = await fetch(sub.endpoint, {
          method: "POST",
          headers: {
            Authorization: vapidAuthorization(
              new URL(sub.endpoint).origin,
              subject,
              privateKey,
              publicKey,
            ),
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            TTL: "86400",
          },
          body: new Uint8Array(body),
        });
        if (res.status >= 200 && res.status < 300) {
          sent++;
          await ctx.runMutation(successRef, { subscriptionId: sub._id });
        } else if (res.status === 404 || res.status === 410) {
          await ctx.runMutation(removeRef, { subscriptionId: sub._id });
        } else {
          await ctx.runMutation(failureRef, { subscriptionId: sub._id });
        }
      } catch {
        await ctx.runMutation(failureRef, { subscriptionId: sub._id });
      }
    }
    return { sent };
  },
});
