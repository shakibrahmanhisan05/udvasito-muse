import type { GenericMutationCtx } from "convex/server";
import type { DataModel, Doc, Id } from "../schemaTypes";
import { writeAudit } from "./audit";
import { fail } from "./errors";

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
    requestId: Id<"requests">;
    reason: RevealReason;
    reasonText?: string;
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
    action: "contact_revealed",
    targetType: "profiles",
    targetId: args.subject._id,
    reason: args.reasonText ?? args.reason,
  });
  return args.subject.phone;
}
