import { createAuthClient } from "better-auth/react";
import { convexClient } from "@convex-dev/better-auth/client/plugins";

/**
 * Better Auth client (ADR-003). Sign-in works only when the Convex backend
 * is connected (EXPO_PUBLIC_* set by Vercel/EAS env — human step RB-2/RB-4).
 * When it is not configured the sign-in screen shows `signin.notConfigured`
 * — the app NEVER fakes a sign-in (specs §1.9).
 */
export const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL ?? "";
export const convexSiteUrl = process.env.EXPO_PUBLIC_CONVEX_SITE_URL ?? "";

export const isAuthConfigured = Boolean(convexUrl && convexSiteUrl);

export const authClient = createAuthClient({
  baseURL: convexSiteUrl || "http://localhost:0",
  plugins: [convexClient()],
});
