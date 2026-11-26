import { internalMutationGeneric } from "convex/server";
import { v } from "convex/values";
import { volunteerMutationV, volunteerQueryV } from "./_lib/auth";
import { fail } from "./_lib/errors";
import { featureOn } from "./_lib/settings";
import { writeAudit } from "./_lib/audit";
import { recordEvent } from "./_lib/events";

/**
 * F-706 slip checks (specs §6.4, SCR-V04) — behind features.slips.
 * Slip photos are PRIVATE: they live in Convex file storage, are
 * served only by GET /slip/:requestId to the owner, volunteers and
 * admins (every view audited), and are deleted by the retention cron
 * at close + slipDeleteMaxDaysAfterClose (S-26). Approving a slip
 * sets the request's verifiedBadge.
 */

/** slips.queue — pending slips in the volunteer's scope, oldest first. */
export const queue = volunteerQueryV({
  args: {},
  handler: async (ctx) => {
    if (!(await featureOn(ctx, "slips"))) return [];
    const rows = await ctx.db
      .query("requests")
      .withIndex("by_status_neededBy", (q) => q.eq("status", "live"))
      .collect();
    const covered = await ctx.db
      .query("requests")
      .withIndex("by_status_neededBy", (q) => q.eq("status", "covered"))
      .collect();
    const pending = [...rows, ...covered]
      .filter((r) => r.isDemo === ctx.profile.isDemo && r.slipStatus === "pending")
      .sort((a, b) => a._creationTime - b._creationTime);
    const out = [];
    for (const r of pending) {
      const hospital = r.hospitalId ? await ctx.db.get(r.hospitalId) : null;
      out.push({
        requestId: r._id,
        bloodGroup: r.bloodGroup,
        component: r.component,
        unitsNeeded: r.unitsNeeded,
        hospitalName: hospital?.nameEn ?? r.placeText ?? "",
        createdAt: r._creationTime,
      });
    }
    return out;
  },
});

/** slips.review — approve → verifiedBadge; reject needs a VAL-18 reason. */
export const review = volunteerMutationV({
  args: {
    requestId: v.id("requests"),
    decision: v.union(v.literal("approve"), v.literal("reject")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!(await featureOn(ctx, "slips"))) fail("ERR_VALIDATION", {}, "feature");
    const request = await ctx.db.get(args.requestId);
    if (!request || request.isDemo !== ctx.profile.isDemo) fail("ERR_NOT_FOUND");
    if (request!.slipStatus !== "pending") fail("ERR_VALIDATION", {}, "slipStatus");
    const reason = args.reason?.trim();
    if (args.decision === "reject" && (!reason || reason.length < 5 || reason.length > 200)) {
      fail("ERR_VALIDATION", {}, "reason"); // VAL-18
    }
    if (reason && (reason.length < 5 || reason.length > 200)) {
      fail("ERR_VALIDATION", {}, "reason"); // VAL-18
    }
    const approved = args.decision === "approve";
    await ctx.db.patch(request!._id, {
      slipStatus: approved ? "approved" : "rejected",
      slipReviewedBy: ctx.profile._id,
      slipReviewReason: reason || undefined,
      verifiedBadge: approved ? true : request!.verifiedBadge,
    });
    await writeAudit(ctx, {
      actor: ctx.profile,
      action: "slip_reviewed",
      targetType: "request",
      targetId: request!._id,
      reason,
      meta: { decision: args.decision },
    });
    await recordEvent(ctx, "slip_reviewed", {
      requestId: request!._id,
      actorRole: ctx.profile.role,
      props: { result: args.decision },
      isDemo: request!.isDemo,
    });
    return { ok: true as const };
  },
});

/**
 * internal.slips.authorizeView — the gatekeeper for GET
 * /slip/:requestId: resolves the caller's profile from the session
 * subject, checks owner / volunteer / admin, writes the slip_viewed
 * audit row, and returns the storage id to serve. Anything else is
 * null (the route answers 404 — a slip's existence is not public).
 */
export const authorizeView = internalMutationGeneric({
  args: { subject: v.string(), requestId: v.id("requests") },
  handler: async (ctx, args) => {
    if (!(await featureOn(ctx, "slips"))) return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", args.subject))
      .unique();
    if (!profile || profile.status !== "active") return null;
    const request = await ctx.db.get(args.requestId);
    if (!request || request.isDemo !== profile.isDemo || !request.slipFileId) {
      return null;
    }
    const isOwner = request.requesterId === profile._id;
    const isStaff = ["volunteer", "admin", "superadmin"].includes(profile.role);
    if (!isOwner && !isStaff) return null;
    await writeAudit(ctx, {
      actor: profile,
      action: "slip_viewed",
      targetType: "request",
      targetId: request._id,
    });
    return { fileId: request.slipFileId };
  },
});
