import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { adminQueryV } from "../_lib/auth";

/**
 * Audit viewer (specs §6.4, F-804, SCR-A06): read-only, filterable by
 * actor, action and date range, 50 per page by default. There is NO
 * write path here — audit rows are append-only, written by the actions
 * themselves (§6.9).
 *
 * Pagination: Convex allows only ONE .paginate() per query, and the
 * practice wall (below) must filter AFTER the page is cut, so this
 * viewer uses an offset cursor over the newest MAX_SCAN matching rows
 * instead — the same collect-then-slice pattern as admin.people.search.
 * At pilot scale that is exact and total-ordered; the cursor is the
 * offset as a string, null for the first page.
 *
 * Practice wall: entries whose actor is a practice account are hidden
 * from real admins (and vice versa); system rows (no actor) show for
 * both. Phone numbers can never appear — writeAudit callers never log
 * them (§6.9) and this viewer adds no joins that could surface one.
 */
const MAX_SCAN = 1000;

export const list = adminQueryV({
  args: {
    actorId: v.optional(v.id("profiles")),
    action: v.optional(v.string()),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const ordered = args.action
      ? ctx.db.query("auditLog").withIndex("by_action", (q) => q.eq("action", args.action!)).order("desc")
      : args.actorId
        ? ctx.db.query("auditLog").withIndex("by_actor", (q) => q.eq("actorId", args.actorId!)).order("desc")
        : ctx.db.query("auditLog").order("desc");
    const rows = await ordered
      .filter((q) =>
        q.and(
          args.actorId ? q.eq(q.field("actorId"), args.actorId) : q.eq(1, 1),
          args.from !== undefined ? q.gte(q.field("_creationTime"), args.from) : q.eq(1, 1),
          args.to !== undefined ? q.lte(q.field("_creationTime"), args.to) : q.eq(1, 1),
        ),
      )
      .take(MAX_SCAN);

    const visible = [];
    for (const row of rows) {
      const actor = row.actorId ? await ctx.db.get(row.actorId) : null;
      if (actor && actor.isDemo !== ctx.profile.isDemo) continue; // practice wall
      visible.push({
        auditId: row._id,
        createdAt: row._creationTime,
        actorId: row.actorId ?? null,
        actorName: actor?.name ?? null,
        actorRole: row.actorRole,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        reason: row.reason ?? null,
      });
    }

    const offset = args.paginationOpts.cursor ? Number(args.paginationOpts.cursor) || 0 : 0;
    const page = visible.slice(offset, offset + args.paginationOpts.numItems);
    const nextOffset = offset + page.length;
    return {
      page,
      isDone: nextOffset >= visible.length,
      continueCursor: String(nextOffset),
    };
  },
});
