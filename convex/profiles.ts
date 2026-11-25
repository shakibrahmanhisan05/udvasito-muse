import { queryGeneric } from "convex/server";
import { getAuthProfile } from "./_lib/auth";

/**
 * profiles.me (specs §6.1) — the signed-in user's own profile, or null.
 * Phone is returned ONLY to the owner themselves (their own record).
 */
export const me = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const profile = await getAuthProfile(ctx);
    if (!profile) return null;
    return {
      id: profile._id,
      name: profile.name,
      firstName: profile.firstName,
      language: profile.language,
      role: profile.role,
      phoneVerified: profile.phoneVerified,
      status: profile.status,
      isDemo: profile.isDemo,
      consentVersion: profile.consentVersion,
      onboardingComplete: Boolean(profile.name && profile.dateOfBirth && profile.phone),
    };
  },
});
