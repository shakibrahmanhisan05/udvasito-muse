import { queryGeneric } from "convex/server";
import { v } from "convex/values";
import { featureOn, getSetting } from "./_lib/settings";
import { COMPONENT_LABEL, formatTimeDhaka } from "./_lib/notify";

/**
 * public.appConfig (specs §6.1) — unauthenticated, safe-to-cache config the
 * app needs before sign-in: version gates (G1), consent version (G3),
 * feature switches and the verification-method availability the sign-in
 * and verify screens render from. NEVER includes phone numbers (the
 * helpline number is served separately by GET /public/helpline, D-R3).
 */
export const appConfig = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const [
      minimumAppVersion, latestAppVersion, consentVersion, features,
      demoAreaEnabled, emailSignInEnabled, apkUrl, apkSha256, verification, aiFeatures,
      contactEmail, medicalReviewer,
    ] = await Promise.all([
      getSetting<string>(ctx, "minimumAppVersion"),
      getSetting<string>(ctx, "latestAppVersion"),
      getSetting<string>(ctx, "consentVersion"),
      getSetting<Record<string, boolean>>(ctx, "features"),
      getSetting<boolean>(ctx, "demoAreaEnabled"),
      getSetting<boolean>(ctx, "emailSignInEnabled"),
      getSetting<string>(ctx, "apkUrl"),
      getSetting<string>(ctx, "apkSha256"),
      getSetting<{
        telegram: boolean; whatsapp: boolean; inPerson: boolean;
        telegramBot: string; whatsappNumber: string;
      }>(ctx, "verification"),
      getSetting<Record<string, boolean>>(ctx, "ai.features"),
      // Public-by-design values for the SCR-P01 footer / SCR-P05 About
      // page: the team's published contact address and the medical
      // reviewer's credit (OQ-10 / OQ-01). Empty until the team sets
      // them; the pages render them only when present.
      getSetting<string>(ctx, "contactEmail"),
      getSetting<{ name: string; reviewedAt: number }>(ctx, "medicalReviewer"),
    ]);
    return {
      minimumAppVersion,
      latestAppVersion,
      consentVersion,
      features,
      practiceAreaEnabled: demoAreaEnabled,
      emailSignInEnabled,
      apkUrl,
      apkSha256,
      verification,
      aiFeatures,
      contactEmail,
      medicalReviewer,
    };
  },
});

/**
 * public.sharedRequestBySlug (F-1002) — the server-side lookup the
 * Vercel /r/<slug> function (api/r/[slug].ts, ADR-006) uses for Open
 * Graph tags. Same gates as requests.publicView: features.sharedLinks
 * on, never practice, never moderation-hidden; anything else is null
 * and the function serves its branded 404. Anonymised fields only.
 */
export const sharedRequestBySlug = queryGeneric({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    if (!(await featureOn(ctx, "sharedLinks"))) return null;
    const request = await ctx.db
      .query("requests")
      .withIndex("by_publicSlug", (q) => q.eq("publicSlug", args.slug))
      .unique();
    if (!request || request.isDemo || request.hiddenByModerator) return null;
    const hospital = request.hospitalId
      ? await ctx.db.get(request.hospitalId)
      : undefined;
    const upazila = await ctx.db.get(request.upazilaId);
    const lang = "en" as const;
    return {
      bloodGroup: request.bloodGroup,
      component: COMPONENT_LABEL[lang][request.component] ?? request.component,
      hospitalName: hospital?.nameEn ?? request.hospitalFreeText ?? "",
      area: upazila?.nameEn ?? "",
      neededByText: formatTimeDhaka(request.neededBy),
    };
  },
});
