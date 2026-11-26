import { internalMutationGeneric } from "convex/server";
import { v } from "convex/values";
import { memberQueryV } from "./_lib/auth";
import { getSetting } from "./_lib/settings";
import { limitOrThrow } from "./_lib/ratelimit";

/**
 * support.helpline (specs §6.1, D-R3) — the team helpline number
 * (settings.fallbackContactPhone, DEP-05) for signed-in members. Signed-out
 * callers use GET /public/helpline instead. The number is fetched on tap,
 * never pre-rendered, and never part of public.appConfig.
 */
export const helpline = memberQueryV({
  args: {},
  handler: async (ctx) => {
    const phone = await getSetting<string>(ctx, "fallbackContactPhone");
    return { phone };
  },
});

/**
 * Internal helper for GET /public/helpline (specs §6.5): enforces the
 * 30/hour/network rate limit (keyed by a hash of the caller IP — the raw
 * IP is never stored) and returns the configured number.
 */
export const helplineFetch = internalMutationGeneric({
  args: { ipHash: v.string() },
  handler: async (ctx, args) => {
    await limitOrThrow(ctx, "helplineFetch", args.ipHash);
    const phone = await getSetting<string>(ctx, "fallbackContactPhone");
    return { phone };
  },
});
