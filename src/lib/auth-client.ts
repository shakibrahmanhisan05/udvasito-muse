import { createAuthClient } from "better-auth/react";
import { convexClient, crossDomainClient } from "@convex-dev/better-auth/client/plugins";

/**
 * Better Auth client (ADR-003). Sign-in works only when the Convex backend
 * is connected (EXPO_PUBLIC_* set by Vercel/EAS env — human step RB-2/RB-4).
 * When it is not configured the sign-in screen shows `signin.notConfigured`
 * — the app NEVER fakes a sign-in (specs §1.9).
 *
 * crossDomainClient() is REQUIRED for the web app (found live 2026-11-26):
 * the app origin (Vercel) differs from the auth origin (.convex.site), so
 * after Google consent the server redirects back with a one-time token
 * (?ott=…) and ConvexBetterAuthProvider exchanges it via
 * authClient.crossDomain.oneTimeToken.verify() and keeps the session
 * cookie in this plugin's localStorage jar. Without the plugin,
 * authClient.crossDomain is undefined, the exchange throws inside the
 * provider, and the app silently bounces back to /sign-in signed out —
 * while every backend probe returns 200.
 */
export const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL ?? "";
export const convexSiteUrl = process.env.EXPO_PUBLIC_CONVEX_SITE_URL ?? "";

export const isAuthConfigured = Boolean(convexUrl && convexSiteUrl);

export const authClient = createAuthClient({
  baseURL: convexSiteUrl || "http://localhost:0",
  plugins: [crossDomainClient(), convexClient()],
});
