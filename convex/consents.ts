import { v } from "convex/values";
import { memberMutationV } from "./_lib/auth";
import { fail } from "./_lib/errors";
import { getSetting } from "./_lib/settings";
import { writeAudit } from "./_lib/audit";

/**
 * consents.accept (specs §6.1, F-101/X08) — records a consent row and, for
 * terms_privacy, advances profile.consentVersion (gate G3's server side).
 *
 * Re-consent (roadmap P6, D-R5): when the law review lands, the team
 * advances the `consentVersion` setting; every member whose accepted
 * version differs is gated at G3 (profiles.me → needsConsent) until
 * they accept the CURRENT version here. A terms_privacy acceptance is
 * therefore only valid for the exact current version — a stale client
 * (or a caller guessing a version string) is rejected with
 * ERR_VALIDATION, so an old acceptance can never silently satisfy a
 * newer gate.
 */
export const accept = memberMutationV({
  args: {
    kind: v.union(
      v.literal("terms_privacy"),
      v.literal("donor_health_contact"),
      v.literal("volunteer_number_display"),
    ),
    version: v.string(),
    lang: v.union(v.literal("en"), v.literal("bn")),
  },
  handler: async (ctx, args) => {
    if (args.kind === "terms_privacy") {
      const current = await getSetting<string>(ctx, "consentVersion");
      if (args.version !== current) fail("ERR_VALIDATION", {}, "version");
    }
    await ctx.db.insert("consents", {
      profileId: ctx.profile._id,
      kind: args.kind,
      version: args.version,
      lang: args.lang,
      acceptedAt: Date.now(),
    });
    if (args.kind === "terms_privacy") {
      await ctx.db.patch(ctx.profile._id, { consentVersion: args.version });
    }
    await writeAudit(ctx, {
      actor: ctx.profile,
      action: "consent_accepted",
      targetType: "profiles",
      targetId: ctx.profile._id,
      reason: args.kind,
    });
    return null;
  },
});
