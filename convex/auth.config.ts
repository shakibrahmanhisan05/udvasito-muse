import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import type { AuthConfig } from "convex/server";

/**
 * Convex-side JWT verification config for Better Auth session tokens
 * (@convex-dev/better-auth 0.13 setup; required by the `convex()` server
 * plugin in auth.ts). Without this file, Convex cannot validate the
 * tokens the auth site issues, and the auth plugin wiring is incomplete.
 */
export default {
  providers: [getAuthConfigProvider()],
} satisfies AuthConfig;
