import { v } from "convex/values";
import { memberMutationV } from "./_lib/auth";
import { fail } from "./_lib/errors";
import { eqRange } from "./_lib/db";

/**
 * Blocks (specs §6.4, F-801): a block is mutual in effect for matching —
 * neither side is ever alerted about the other's requests, and accept is
 * refused with ERR_BLOCKED (see matching.ts / responses.ts).
 */

export const create = memberMutationV({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args) => {
    if (args.profileId === ctx.profile._id) fail("ERR_VALIDATION", {}, "profileId");
    const other = await ctx.db.get(args.profileId);
    if (!other || other.isDemo !== ctx.profile.isDemo) fail("ERR_NOT_FOUND");
    const existing = await ctx.db
      .query("blocks")
      .withIndex(
        "by_pair",
        eqRange([["blockerId", ctx.profile._id], ["blockedId", args.profileId]]),
      )
      .first();
    if (!existing) {
      await ctx.db.insert("blocks", {
        blockerId: ctx.profile._id,
        blockedId: args.profileId,
      });
    }
    return null;
  },
});

export const remove = memberMutationV({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("blocks")
      .withIndex(
        "by_pair",
        eqRange([["blockerId", ctx.profile._id], ["blockedId", args.profileId]]),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});
