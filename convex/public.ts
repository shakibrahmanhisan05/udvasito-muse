import { queryGeneric } from "convex/server";
import { getSetting } from "./_lib/settings";

/**
 * public.appConfig (specs §6.1) — unauthenticated, safe-to-cache config the
 * app needs before sign-in: version gates (G1), consent version (G3) and
 * feature switches. NEVER includes phone numbers (the helpline number is
 * served separately by GET /public/helpline in P1, D-R3).
 */
export const appConfig = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const [minimumAppVersion, latestAppVersion, consentVersion, features, demoAreaEnabled, emailSignInEnabled, apkUrl] =
      await Promise.all([
        getSetting<string>(ctx, "minimumAppVersion"),
        getSetting<string>(ctx, "latestAppVersion"),
        getSetting<string>(ctx, "consentVersion"),
        getSetting<Record<string, boolean>>(ctx, "features"),
        getSetting<boolean>(ctx, "demoAreaEnabled"),
        getSetting<boolean>(ctx, "emailSignInEnabled"),
        getSetting<string>(ctx, "apkUrl"),
      ]);
    return {
      minimumAppVersion,
      latestAppVersion,
      consentVersion,
      features,
      practiceAreaEnabled: demoAreaEnabled,
      emailSignInEnabled,
      apkUrl,
    };
  },
});
