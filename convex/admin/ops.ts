import { internalMutationGeneric } from "convex/server";
import { v } from "convex/values";
import { fail } from "../_lib/errors";
import { writeAudit } from "../_lib/audit";

/**
 * internal.admin.ops.* (specs §6.6) — the ONLY way to change live rows by
 * hand (roadmap §2.6 rule 2). Every operation is audit-logged. Used from the
 * CLI until the admin screens land in P3/P5.
 */

const statusValidator = v.union(
  v.literal("active"), v.literal("frozen"), v.literal("suspended"),
  v.literal("banned"), v.literal("deletion_pending"), v.literal("underage_blocked"),
);

export const setStatus = internalMutationGeneric({
  args: {
    profileId: v.id("profiles"),
    status: statusValidator,
    reason: v.string(),
    actorId: v.optional(v.id("profiles")),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.profileId);
    if (!profile) fail("ERR_NOT_FOUND");
    await ctx.db.patch(args.profileId, {
      status: args.status,
      statusReason: args.reason,
    });
    const actor = args.actorId ? await ctx.db.get(args.actorId) : null;
    await writeAudit(ctx, {
      actor,
      action: "status_changed",
      targetType: "profiles",
      targetId: args.profileId,
      reason: args.reason,
    });
    return { ok: true };
  },
});

export const setRole = internalMutationGeneric({
  args: {
    profileId: v.id("profiles"),
    role: v.union(v.literal("member"), v.literal("volunteer"), v.literal("admin"), v.literal("superadmin")),
    reason: v.string(),
    actorId: v.optional(v.id("profiles")),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.profileId);
    if (!profile) fail("ERR_NOT_FOUND");
    if (
      (profile!.role === "admin" || profile!.role === "superadmin") &&
      args.role !== "admin" &&
      args.role !== "superadmin"
    ) {
      // ERR_LAST_ADMIN guard (specs §6.7): never leave zero admins.
      const [admins, superadmins] = await Promise.all([
        ctx.db.query("profiles").withIndex("by_role", (q) => q.eq("role", "admin")).collect(),
        ctx.db.query("profiles").withIndex("by_role", (q) => q.eq("role", "superadmin")).collect(),
      ]);
      const others = [...admins, ...superadmins].filter((p) => p._id !== args.profileId);
      if (others.length === 0) fail("ERR_LAST_ADMIN");
    }
    await ctx.db.patch(args.profileId, { role: args.role });
    const actor = args.actorId ? await ctx.db.get(args.actorId) : null;
    await writeAudit(ctx, {
      actor,
      action: "role_changed",
      targetType: "profiles",
      targetId: args.profileId,
      reason: args.reason,
    });
    return { ok: true };
  },
});

/** Flag/unflag a practice-area account (F-912). The only way isDemo changes. */
export const setDemo = internalMutationGeneric({
  args: {
    profileId: v.id("profiles"),
    isDemo: v.boolean(),
    actorId: v.optional(v.id("profiles")),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.profileId);
    if (!profile) fail("ERR_NOT_FOUND");
    await ctx.db.patch(args.profileId, { isDemo: args.isDemo });
    const actor = args.actorId ? await ctx.db.get(args.actorId) : null;
    await writeAudit(ctx, {
      actor,
      action: args.isDemo ? "demo_account_created" : "demo_reset",
      targetType: "profiles",
      targetId: args.profileId,
    });
    return { ok: true };
  },
});

export const closeRequest = internalMutationGeneric({
  args: {
    requestId: v.id("requests"),
    reason: v.string(),
    actorId: v.optional(v.id("profiles")),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) fail("ERR_NOT_FOUND");
    await ctx.db.patch(args.requestId, {
      status: "closed",
      closeReason: "removed",
      closedAt: Date.now(),
    });
    const actor = args.actorId ? await ctx.db.get(args.actorId) : null;
    await writeAudit(ctx, {
      actor,
      action: "status_changed",
      targetType: "requests",
      targetId: args.requestId,
      reason: args.reason,
    });
    return { ok: true };
  },
});
