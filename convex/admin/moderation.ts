import { v } from "convex/values";
import type { GenericQueryCtx } from "convex/server";
import type { DataModel, Doc, Id } from "../schemaTypes";
import { adminMutationV, adminQueryV } from "../_lib/auth";
import { fail } from "../_lib/errors";
import { writeAudit } from "../_lib/audit";
import { recordEvent } from "../_lib/events";
import { notifyUser } from "../_lib/notify";
import { refreshDonorLive } from "../_lib/donorLive";
import { validateReason } from "../rules/validation";
import { anyFreeze, decisionActionText, type FreezeState } from "../rules/moderation";

/**
 * Moderation queue + decisions (specs §6.4, F-803, SCR-A02/A03).
 * Items arrive from reports.create (P2) and the automatic F-803 flags
 * (P3). A decision ALWAYS writes the §6.9 `moderation_decided` audit
 * entry and notifies the affected person (NTF-14) with the reason —
 * including dismissals, so nobody is actioned (or cleared) silently.
 * Payloads never contain phone numbers or patient names: the queue is
 * about behaviour, not identities' contact details.
 */

type QCtx = GenericQueryCtx<DataModel>;

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

async function itemOf(ctx: QCtx, callerIsDemo: boolean, itemId: Id<"moderationItems">) {
  const item = await ctx.db.get(itemId);
  if (!item || item!.isDemo !== callerIsDemo) fail("ERR_NOT_FOUND");
  return item!;
}

async function reportsOf(ctx: QCtx, itemId: Id<"moderationItems">) {
  const all = await ctx.db.query("reports").collect();
  return all.filter((r) => r.moderationItemId === itemId);
}

function itemSummary(
  item: Doc<"moderationItems">,
  subject: Doc<"profiles"> | null,
  reports: Doc<"reports">[],
) {
  return {
    itemId: item._id,
    type: item.type,
    kind: item.kind,
    severity: item.severity,
    status: item.status,
    subjectId: item.subjectId ?? null,
    subjectName: subject?.name ?? null,
    subjectRole: subject?.role ?? null,
    requestId: item.requestId ?? null,
    createdAt: item._creationTime,
    autoAction: reports.find((r) => r.autoAction)?.autoAction ?? null,
    reportCount: reports.length,
    decision: item.decision ?? null,
    decisionReason: item.decisionReason ?? null,
    decidedAt: item.decidedAt ?? null,
  };
}

/** admin.moderation.list (specs §6.4, SCR-A02): open first — severity,
 *  then age — decided items after, newest decision first. */
export const list = adminQueryV({
  args: { status: v.union(v.literal("open"), v.literal("decided"), v.literal("all")) },
  handler: async (ctx, args) => {
    const items = (await ctx.db.query("moderationItems").collect())
      .filter((i) => i.isDemo === ctx.profile.isDemo)
      .filter((i) => args.status === "all" || i.status === args.status);
    const out = [];
    for (const item of items) {
      const subject = item.subjectId ? await ctx.db.get(item.subjectId) : null;
      out.push(itemSummary(item, subject, await reportsOf(ctx, item._id)));
    }
    out.sort((a, b) => {
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      if (a.status === "open") {
        const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
        return sev !== 0 ? sev : a.createdAt - b.createdAt;
      }
      return (b.decidedAt ?? 0) - (a.decidedAt ?? 0);
    });
    return out;
  },
});

/** admin.moderation.get (specs §6.4, SCR-A03): the item, its reports,
 *  the request (no contact phone, no patient name), the subject's
 *  history and the audit trail touching either. */
export const get = adminQueryV({
  args: { itemId: v.id("moderationItems") },
  handler: async (ctx, args) => {
    const item = await itemOf(ctx, ctx.profile.isDemo, args.itemId);
    const reports = await reportsOf(ctx, item._id);
    const subject = item.subjectId ? await ctx.db.get(item.subjectId) : null;
    const request = item.requestId ? await ctx.db.get(item.requestId) : null;
    const hospital = request?.hospitalId ? await ctx.db.get(request.hospitalId) : null;

    let subjectHistory = null;
    if (subject) {
      const [subjectRequests, subjectResponses, reportsAbout, revealsAsViewer, revealsAsSubject] =
        await Promise.all([
          ctx.db.query("requests").withIndex("by_requester_status", (q) => q.eq("requesterId", subject._id)).collect(),
          ctx.db.query("responses").withIndex("by_donor_state", (q) => q.eq("donorId", subject._id)).collect(),
          ctx.db.query("reports").withIndex("by_subject", (q) => q.eq("subjectId", subject._id)).collect(),
          ctx.db.query("contactReveals").withIndex("by_viewer_request", (q) => q.eq("viewerId", subject._id)).collect(),
          ctx.db.query("contactReveals").withIndex("by_subject", (q) => q.eq("subjectId", subject._id)).collect(),
        ]);
      subjectHistory = {
        requests: subjectRequests.length,
        responses: subjectResponses.length,
        reportsAbout: reportsAbout.length,
        revealsAsViewer: revealsAsViewer.length,
        revealsAsSubject: revealsAsSubject.length,
        status: subject.status,
        role: subject.role,
        joinedAt: subject._creationTime,
      };
    }

    const auditAll = await ctx.db.query("auditLog").collect();
    const trail = auditAll
      .filter(
        (a) =>
          (item.subjectId !== undefined && a.targetId === (item.subjectId as string)) ||
          a.targetId === (item._id as string) ||
          (item.requestId !== undefined && a.targetId === (item.requestId as string)),
      )
      .sort((a, b) => b._creationTime - a._creationTime)
      .slice(0, 20)
      .map((a) => ({
        action: a.action, actorRole: a.actorRole, reason: a.reason ?? null,
        createdAt: a._creationTime,
      }));

    return {
      ...itemSummary(item, subject, reports),
      reports: reports.map((r) => ({
        reportId: r._id,
        reason: r.reason,
        details: r.details ?? null,
        autoAction: r.autoAction ?? null,
        createdAt: r._creationTime,
      })),
      request: request
        ? {
            requestId: request._id,
            bloodGroup: request.bloodGroup,
            component: request.component,
            unitsNeeded: request.unitsNeeded,
            unitsConfirmed: request.unitsConfirmed,
            hospitalName: hospital?.nameEn ?? request.placeText ?? "",
            status: request.status,
            closeReason: request.closeReason ?? null,
            hiddenByModerator: request.hiddenByModerator,
            revealsFrozen: request.revealsFrozen,
            slipStatus: request.slipStatus,
            createdAt: request._creationTime,
          }
        : null,
      subjectHistory,
      auditTrail: trail,
    };
  },
});

const decision = v.union(
  v.literal("dismiss"), v.literal("warn"), v.literal("hide_request"),
  v.literal("suspend"), v.literal("ban"), v.literal("restore"),
);

/** admin.moderation.decide (specs §6.4, SCR-A03): apply a decision.
 *  Every decision requires a reason (VAL-18), closes the item, writes
 *  audit + event, and notifies the affected person (NTF-14).
 *
 *  Freeze choice (SCR-A03, P5 review F1): dismiss/warn on an item whose
 *  P2 auto-actions (PRD §5.8) are still in place MUST say what happens
 *  to them — `freezeChoice: "lift"` undoes the auto-freezes this item
 *  caused, `"keep"` leaves them in place. Without a choice the call is
 *  rejected, so no moderator can close such an item by accident, and
 *  the NTF-14 wording is built from the real outcome
 *  (rules/moderation.decisionActionText) — it never claims "no action
 *  taken" while a freeze persists. Restore always lifts (its existing
 *  meaning); suspend/ban supersede a freeze with their own state. */
export const decide = adminMutationV({
  args: {
    itemId: v.id("moderationItems"),
    decision,
    reason: v.string(),
    suspendDays: v.optional(v.number()),
    freezeChoice: v.optional(v.union(v.literal("lift"), v.literal("keep"))),
  },
  handler: async (ctx, args) => {
    const check = validateReason(args.reason);
    if (!check.ok) fail("ERR_VALIDATION", {}, check.field);
    const item = await itemOf(ctx, ctx.profile.isDemo, args.itemId);
    if (item.status !== "open") fail("ERR_VALIDATION", {}, "status");
    const reason = args.reason.trim();
    const now = Date.now();

    const subject = item.subjectId ? await ctx.db.get(item.subjectId) : null;
    const request = item.requestId ? await ctx.db.get(item.requestId) : null;
    // The person affected by the decision: the item's subject, or (for
    // request-only items) the requester.
    const affected = subject ?? (request ? await ctx.db.get(request.requesterId) : null);

    // Which of this item's automatic freezes are still in place?
    const itemReports = await reportsOf(ctx, item._id);
    const freezes: FreezeState = {
      account:
        itemReports.some((r) => r.autoAction === "account_frozen") &&
        subject?.status === "frozen",
      reveals:
        itemReports.some((r) => r.autoAction === "reveals_frozen") &&
        request?.revealsFrozen === true,
    };
    const liftsFreezes =
      args.decision === "restore" ||
      ((args.decision === "dismiss" || args.decision === "warn") &&
        args.freezeChoice === "lift");
    if (
      (args.decision === "dismiss" || args.decision === "warn") &&
      anyFreeze(freezes) &&
      args.freezeChoice === undefined
    ) {
      fail("ERR_VALIDATION", {}, "freezeChoice");
    }

    if (liftsFreezes && anyFreeze(freezes)) {
      if (freezes.account && subject) {
        await ctx.db.patch(subject._id, {
          status: "active", statusReason: undefined, statusUntil: undefined,
        });
        const donor = await ctx.db
          .query("donorProfiles")
          .withIndex("by_profile", (q) => q.eq("profileId", subject._id))
          .unique();
        if (donor) {
          const fresh = await ctx.db.get(subject._id);
          if (fresh) await refreshDonorLive(ctx, fresh, donor);
        }
      }
      if (freezes.reveals && request) {
        await ctx.db.patch(request._id, { revealsFrozen: false });
      }
    }

    if (args.decision === "hide_request") {
      if (!request) fail("ERR_VALIDATION", {}, "requestId");
      await ctx.db.patch(request!._id, { hiddenByModerator: true });
      if (request!.status === "live" || request!.status === "covered") {
        await ctx.db.patch(request!._id, {
          status: "closed", closeReason: "removed", closedAt: now,
        });
        await recordEvent(ctx, "request_closed", {
          requestId: request!._id, actorRole: ctx.profile.role,
          props: { reason: "removed" }, isDemo: item.isDemo,
        });
      }
    }

    if (args.decision === "suspend" || args.decision === "ban" || args.decision === "restore") {
      if (!subject) fail("ERR_VALIDATION", {}, "subjectId");
      if (args.decision === "suspend") {
        if (
          args.suspendDays === undefined ||
          !Number.isInteger(args.suspendDays) ||
          args.suspendDays < 1 ||
          args.suspendDays > 30
        ) {
          fail("ERR_VALIDATION", {}, "suspendDays");
        }
        await ctx.db.patch(subject!._id, {
          status: "suspended",
          statusReason: reason,
          statusUntil: now + args.suspendDays! * 86_400_000,
        });
      } else if (args.decision === "ban") {
        await ctx.db.patch(subject!._id, {
          status: "banned", statusReason: reason, statusUntil: undefined,
        });
      } else {
        // restore: lift the account-level freeze/suspension/ban and any
        // automatic request freezes this item caused. A request already
        // closed stays closed (restore is not a reopen).
        await ctx.db.patch(subject!._id, {
          status: "active", statusReason: undefined, statusUntil: undefined,
        });
        if (request && (request.revealsFrozen || request.hiddenByModerator)) {
          await ctx.db.patch(request._id, {
            revealsFrozen: false, hiddenByModerator: false,
          });
        }
      }
      if (args.decision !== "restore") {
        const vp = await ctx.db
          .query("volunteerProfiles")
          .withIndex("by_profile", (q) => q.eq("profileId", subject!._id))
          .unique();
        if (vp && vp.onDuty) await ctx.db.patch(vp._id, { onDuty: false });
      }
      const donor = await ctx.db
        .query("donorProfiles")
        .withIndex("by_profile", (q) => q.eq("profileId", subject!._id))
        .unique();
      if (donor) {
        const fresh = await ctx.db.get(subject!._id);
        if (fresh) await refreshDonorLive(ctx, fresh, donor);
      }
    }

    await ctx.db.patch(item._id, {
      status: "decided",
      decision: args.decision,
      decisionReason: reason,
      decidedBy: ctx.profile._id,
      decidedAt: now,
    });
    await writeAudit(ctx, {
      actor: ctx.profile,
      action: "moderation_decided",
      targetType: "moderationItems",
      targetId: item._id,
      reason,
      meta: {
        decision: args.decision,
        subjectId: item.subjectId ?? null,
        requestId: item.requestId ?? null,
        freezeChoice: args.freezeChoice ?? null,
        freezesLifted: liftsFreezes
          ? [
              ...(freezes.account ? ["account"] : []),
              ...(freezes.reveals ? ["reveals"] : []),
            ]
          : [],
      },
    });
    await recordEvent(ctx, "moderation_decided", {
      requestId: item.requestId,
      actorRole: ctx.profile.role,
      props: {
        decision: args.decision,
        freeze: liftsFreezes && anyFreeze(freezes)
          ? "lifted"
          : anyFreeze(freezes)
            ? "kept"
            : "none",
      },
      isDemo: item.isDemo,
    });
    if (affected) {
      await notifyUser(ctx, {
        recipient: affected,
        template: "NTF-14",
        requestId: item.requestId,
        params: {
          action: decisionActionText(args.decision, freezes, args.freezeChoice),
          reason,
        },
        url: "/account-status",
        channelId: "updates",
      });
    }
    return null;
  },
});
