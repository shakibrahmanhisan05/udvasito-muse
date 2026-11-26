import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc, Id } from "../schemaTypes";
import { writeAudit } from "./audit";
import { fail } from "./errors";
import { eqRange } from "./db";
import { getSetting } from "./settings";
import { startOfDhakaDay } from "../rules/alertPolicy";

type Profile = Doc<"profiles">;

/**
 * THE ONLY module allowed to hand out phone numbers (CLAUDE.md rule 2,
 * PRD §3.3, specs §6.0). Functions marked 📞 in specs §6 call
 * `recordContactReveal` here; every reveal writes a `contactReveals` row
 * AND an `auditLog` entry. No other file may return `profile.phone` or
 * `request.contactPhone` from a public function.
 */

export const REVEAL_REASONS = [
  "confirmed_slot",
  "volunteer_hotline",
  "volunteer_optin_call",
  "admin_reveal",
  "volunteer_case",
] as const;
export type RevealReason = (typeof REVEAL_REASONS)[number];

/** Internal accessor — for use inside this module and server-only checks. */
export function phoneOf(profile: Profile): string {
  return profile.phone;
}

export async function recordContactReveal(
  ctx: GenericMutationCtx<DataModel>,
  args: {
    viewer: Profile;
    subject: Profile;
    subjectRole: "donor" | "requester" | "volunteer";
    /** Optional since P3: an admin person-level reveal (F-805) has no
     * request context; every request-scoped reveal still passes it. */
    requestId?: Id<"requests">;
    reason: RevealReason;
    reasonText?: string;
    /** §6.9 action name; defaults to the generic `contact_revealed`. */
    auditAction?: string;
    expiresAt: number;
    isDemo: boolean;
  },
): Promise<string> {
  if (args.viewer.isDemo !== args.isDemo || args.subject.isDemo !== args.isDemo) {
    fail("ERR_DEMO_ISOLATION");
  }
  if (
    (args.reason === "admin_reveal" || args.reason === "volunteer_optin_call") &&
    !args.reasonText
  ) {
    fail("ERR_VALIDATION", {}, "reasonText");
  }
  await ctx.db.insert("contactReveals", {
    requestId: args.requestId,
    viewerId: args.viewer._id,
    subjectId: args.subject._id,
    subjectRole: args.subjectRole,
    reason: args.reason,
    reasonText: args.reasonText,
    expiresAt: args.expiresAt,
    isDemo: args.isDemo,
  });
  await writeAudit(ctx, {
    actor: args.viewer,
    action: args.auditAction ?? "contact_revealed",
    targetType: "profiles",
    targetId: args.subject._id,
    reason: args.reasonText ?? args.reason,
  });
  // Reveal-volume flag (S-24, F-802): staff-side reveals (admin /
  // volunteer) past the daily threshold raise a moderation flag, once,
  // at the crossing. Ordinary confirmed-slot reveals are not staff-side.
  if (
    args.reason === "admin_reveal" ||
    args.reason === "volunteer_optin_call" ||
    args.reason === "volunteer_case"
  ) {
    const threshold = await getSetting<number>(ctx, "revealFlagPerDay");
    const mine = await ctx.db
      .query("contactReveals")
      .withIndex("by_viewer_request", eqRange([["viewerId", args.viewer._id]]))
      .collect();
    const today = mine.filter((r) => r._creationTime >= startOfDhakaDay(Date.now())).length;
    if (today === threshold + 1) {
      await ctx.db.insert("moderationItems", {
        type: "flag",
        kind: "reveal_volume",
        subjectId: args.viewer._id,
        severity: "medium",
        status: "open",
        isDemo: args.isDemo,
      });
    }
  }
  return args.subject.phone;
}

/**
 * S-23 (PRD §5.8): how many numbers a requester has RECEIVED so far
 * today (Asia/Dhaka) across every reveal where they are the viewer.
 * Shared by every donor→requester reveal path — accept (responses.ts)
 * and standby promotions (matching.ts) alike, so no path can push a
 * requester past the daily cap (P2 review finding S3-F1).
 */
export async function requesterRevealsToday(
  ctx: GenericMutationCtx<DataModel> | GenericQueryCtx<DataModel>,
  requesterId: Id<"profiles">,
  now: number,
): Promise<number> {
  const rows = await ctx.db
    .query("contactReveals")
    .withIndex("by_viewer_request", eqRange([["viewerId", requesterId]]))
    .collect();
  return rows.filter((r) => r._creationTime >= startOfDhakaDay(now)).length;
}

/** True when one more reveal TO this requester still fits under S-23. */
export async function requesterUnderRevealCap(
  ctx: GenericMutationCtx<DataModel> | GenericQueryCtx<DataModel>,
  requesterId: Id<"profiles">,
  now: number,
): Promise<boolean> {
  const cap = await getSetting<number>(ctx, "revealsPerRequesterPerDay");
  return (await requesterRevealsToday(ctx, requesterId, now)) < cap;
}
