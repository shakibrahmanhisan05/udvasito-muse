import { v } from "convex/values";
import { memberMutationV } from "./_lib/auth";
import { fail } from "./_lib/errors";
import { recordEvent } from "./_lib/events";
import { writeAudit } from "./_lib/audit";
import { notifyUser } from "./_lib/notify";
import { refreshDonorLive } from "./_lib/donorLive";
import { limitOrThrow } from "./_lib/ratelimit";
import { eqRange } from "./_lib/db";
import { allResponses } from "./matching";

/**
 * Reports (specs §6.4, F-801, SCR-C01): a member reports another member,
 * optionally blocking them in the same tap. Automatic safety actions
 * (PRD §5.8) apply immediately and are audited: an "asked for money"
 * report freezes the subject's account; a confirmed donor's "fake
 * request" report freezes the request's reveals. Everything else waits
 * for a human decision in the moderation queue (P5).
 */

const reason = v.union(
  v.literal("fake"), v.literal("money"), v.literal("harassment"), v.literal("other"),
);

/** reports.create (specs §6.4) — rate-limited to 10 per member per day. */
export const create = memberMutationV({
  args: {
    subjectId: v.id("profiles"),
    requestId: v.optional(v.id("requests")),
    reason,
    details: v.optional(v.string()),
    block: v.boolean(),
  },
  handler: async (ctx, args) => {
    if (args.subjectId === ctx.profile._id) fail("ERR_VALIDATION", {}, "subjectId");
    const subject = await ctx.db.get(args.subjectId);
    if (!subject || subject!.isDemo !== ctx.profile.isDemo) fail("ERR_NOT_FOUND");
    let request = null;
    if (args.requestId) {
      request = await ctx.db.get(args.requestId);
      if (!request || request!.isDemo !== ctx.profile.isDemo) fail("ERR_NOT_FOUND");
    }
    await limitOrThrow(ctx, "reportCreate", String(ctx.profile._id));

    const severity =
      args.reason === "money" || args.reason === "fake"
        ? "high"
        : args.reason === "harassment"
          ? "medium"
          : "low";
    const moderationItemId = await ctx.db.insert("moderationItems", {
      type: "report",
      kind: args.reason,
      subjectId: subject!._id,
      requestId: request?._id,
      severity,
      status: "open",
      isDemo: ctx.profile.isDemo,
    });

    let autoAction: "account_frozen" | "reveals_frozen" | undefined;
    if (args.reason === "money" && subject!.status === "active") {
      await ctx.db.patch(subject!._id, {
        status: "frozen",
        statusReason: "report_money",
      });
      autoAction = "account_frozen";
      await writeAudit(ctx, {
        actor: ctx.profile,
        action: "account_frozen_auto",
        targetType: "profiles",
        targetId: subject!._id,
        reason: "report:money",
      });
      const donor = await ctx.db
        .query("donorProfiles")
        .withIndex("by_profile", (q) => q.eq("profileId", subject!._id))
        .unique();
      if (donor) {
        const frozen = await ctx.db.get(subject!._id);
        if (frozen) await refreshDonorLive(ctx, frozen, donor);
      }
    }
    if (args.reason === "fake" && request && !request.revealsFrozen) {
      // Only a donor actually confirmed on this request can freeze its
      // reveals (PRD §5.8) — anyone else's report just queues for review.
      const responses = await allResponses(ctx, request._id);
      const mine = responses.find(
        (r) => r.donorId === ctx.profile._id && r.state === "confirmed",
      );
      if (mine) {
        await ctx.db.patch(request._id, { revealsFrozen: true });
        autoAction = "reveals_frozen";
        await writeAudit(ctx, {
          actor: ctx.profile,
          action: "reveals_frozen_auto",
          targetType: "requests",
          targetId: request._id,
          reason: "report:fake",
        });
      }
    }

    await ctx.db.insert("reports", {
      reporterId: ctx.profile._id,
      subjectId: subject!._id,
      requestId: request?._id,
      reason: args.reason,
      details: args.details,
      autoAction,
      moderationItemId,
      isDemo: ctx.profile.isDemo,
    });

    if (args.block) {
      const existing = await ctx.db
        .query("blocks")
        .withIndex(
          "by_pair",
          eqRange([["blockerId", ctx.profile._id], ["blockedId", subject!._id]]),
        )
        .first();
      if (!existing) {
        await ctx.db.insert("blocks", {
          blockerId: ctx.profile._id,
          blockedId: subject!._id,
        });
      }
    }

    // NTF-17 to every active admin on the same side of the demo wall.
    for (const roleName of ["admin", "superadmin"] as const) {
      const rows = await ctx.db
        .query("profiles")
        .withIndex("by_role", (q) => q.eq("role", roleName))
        .collect();
      for (const admin of rows) {
        if (admin.status !== "active" || admin.isDemo !== ctx.profile.isDemo) continue;
        await notifyUser(ctx, {
          recipient: admin,
          template: "NTF-17",
          requestId: request?._id,
          params: { kind: args.reason },
          url: "/admin/moderation",
          channelId: "updates",
        });
      }
    }

    await recordEvent(ctx, "report_filed", {
      requestId: request?._id,
      actorRole: ctx.profile.role,
      props: { reason: args.reason, auto: autoAction ?? "none" },
      isDemo: ctx.profile.isDemo,
    });
    return { autoAction };
  },
});
