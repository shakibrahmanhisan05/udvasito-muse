import { internalMutationGeneric } from "convex/server";
import { v } from "convex/values";
import { fail } from "../_lib/errors";
import { writeAudit } from "../_lib/audit";

/**
 * internal.admin.bootstrap.bootstrapSuperAdmin (specs §6.6, RB-10).
 * Run ONCE per environment from the CLI after the team account has signed in
 * and finished onboarding:
 *   npx convex run admin/bootstrap:bootstrapSuperAdmin '{"authUserId":"<id>"}'
 * Refuses to run when a superadmin already exists.
 */
export const bootstrapSuperAdmin = internalMutationGeneric({
  args: { authUserId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_role", (q) => q.eq("role", "superadmin"))
      .first();
    if (existing) fail("ERR_FORBIDDEN");
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", args.authUserId))
      .unique();
    if (!profile) fail("ERR_NOT_FOUND");
    await ctx.db.patch(profile!._id, { role: "superadmin" });
    await writeAudit(ctx, {
      actor: profile,
      actorRole: "system",
      action: "role_changed",
      targetType: "profiles",
      targetId: profile!._id,
      reason: "bootstrapSuperAdmin",
    });
    return { profileId: profile!._id };
  },
});
