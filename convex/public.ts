import { queryGeneric } from "convex/server";
import { getSetting } from "./_lib/settings";

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
    };
  },
});
