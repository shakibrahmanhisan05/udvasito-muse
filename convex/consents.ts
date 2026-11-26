import { v } from "convex/values";
import { memberMutationV } from "./_lib/auth";
import { writeAudit } from "./_lib/audit";

/**
 * consents.accept (specs §6.1, F-101/X08) — records a consent row and, for
 * terms_privacy, advances profile.consentVersion (gate G3's server side).
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
