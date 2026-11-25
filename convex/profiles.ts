import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { getAuthProfile, memberMutationV } from "./_lib/auth";
import { fail } from "./_lib/errors";
import { getSetting } from "./_lib/settings";
import { writeAudit } from "./_lib/audit";
import { recordEvent } from "./_lib/events";
import { limitOrThrow } from "./_lib/ratelimit";
import { refreshDonorLive } from "./_lib/donorLive";
import { normalisePhone, validateDateOfBirth, validateName, validatePhone } from "./rules/validation";

/**
 * profiles.me (specs §6.1) — the signed-in user's own profile, or null.
 * Phone is returned ONLY to the owner themselves (their own record).
 */
export const me = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const profile = await getAuthProfile(ctx);
    if (!profile) return null;
    const consentVersion = await getSetting<string>(ctx, "consentVersion");
    const donor = await ctx.db
      .query("donorProfiles")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .unique();
    const volunteer = await ctx.db
      .query("volunteerProfiles")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .unique();
    return {
      id: profile._id,
      name: profile.name,
      firstName: profile.firstName,
      language: profile.language,
      role: profile.role,
      phone: profile.phone,
      phoneVerified: profile.phoneVerified,
      status: profile.status,
      statusReason: profile.statusReason,
      statusUntil: profile.statusUntil,
      isDemo: profile.isDemo,
      consentVersion: profile.consentVersion,
      needsConsent: profile.consentVersion !== consentVersion,
      onboardingComplete: Boolean(profile.name && profile.dateOfBirth && profile.phone),
      donor: donor
        ? {
            id: donor._id,
            bloodGroup: donor.bloodGroup,
            live: donor.live,
            eligibleFrom: donor.eligibleFrom,
            eligibleFromPlatelets: donor.eligibleFromPlatelets,
          }
        : null,
      volunteer: volunteer ? { id: volunteer._id, status: volunteer.status, onDuty: volunteer.onDuty } : null,
    };
  },
});

/**
 * profiles.completeOnboarding (specs §6.1, F-102) — creates the profile
 * after Google sign-in. The 18+ gate (S-01) is enforced here: an under-18
 * date of birth marks the account `underage_blocked` and returns
 * { result: "underage" } instead of an error (SCR-O03 special state).
 * Cannot use the member wrappers — the profile may not exist yet.
 */
export const completeOnboarding = mutationGeneric({
  args: {
    name: v.string(),
    dateOfBirth: v.string(),
    phone: v.string(),
    language: v.union(v.literal("en"), v.literal("bn")),
    consentVersion: v.string(),
    consentAcceptedAt: v.number(),
    campaignCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) fail("ERR_UNAUTHENTICATED");
    await limitOrThrow(ctx, "signUp", identity!.subject);

    const nameCheck = validateName(args.name);
    if (!nameCheck.ok) fail("ERR_VALIDATION", {}, nameCheck.field);
    const dobCheck = validateDateOfBirth(args.dateOfBirth, Date.now());
    if (!dobCheck.ok) fail("ERR_VALIDATION", {}, dobCheck.field);
    const phoneCheck = validatePhone(args.phone);
    if (!phoneCheck.ok) fail("ERR_VALIDATION", {}, phoneCheck.field);
    const phone = normalisePhone(args.phone)!;

    const minAge = await getSetting<number>(ctx, "minAge");
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", identity!.subject))
      .unique();

    const firstName = args.name.trim().split(/\s+/)[0];
    const underage = (dobCheck.age ?? 0) < minAge;

    // Campaign attribution (V07): only codes that exist and are active.
    let campaignCode: string | undefined;
    if (args.campaignCode) {
      const campaign = await ctx.db
        .query("campaigns")
        .withIndex("by_code", (q) => q.eq("code", args.campaignCode as string))
        .unique();
      if (campaign?.active) campaignCode = campaign.code;
    }

    if (existing) {
      if (existing!.status === "active" && existing!.phone && existing!.dateOfBirth && !underage) {
        return { result: "ok" as const }; // idempotent retry of a completed onboarding
      }
      await ctx.db.patch(existing!._id, {
        name: args.name.trim(),
        firstName,
        dateOfBirth: args.dateOfBirth,
        language: args.language,
        phone,
        phoneVerified: existing!.phone === phone ? existing!.phoneVerified : false,
        status: underage ? "underage_blocked" : "active",
        consentVersion: args.consentVersion,
        campaignCode: campaignCode ?? existing!.campaignCode,
        lastActiveAt: Date.now(),
      });
      if (underage) return { result: "underage" as const };
      await ctx.db.insert("consents", {
        profileId: existing!._id,
        kind: "terms_privacy",
        version: args.consentVersion,
        lang: args.language,
        acceptedAt: args.consentAcceptedAt,
      });
      await writeAudit(ctx, {
        actor: existing,
        action: "consent_accepted",
        targetType: "profiles",
        targetId: existing!._id,
      });
      await recordEvent(ctx, "profile_completed", {
        actorRole: existing!.role,
        isDemo: existing!.isDemo,
      });
      return { result: "ok" as const };
    }

    const profileId = await ctx.db.insert("profiles", {
      authUserId: identity!.subject,
      name: args.name.trim(),
      firstName,
      dateOfBirth: args.dateOfBirth,
      language: args.language,
      role: "member",
      phone,
      phoneVerified: false,
      status: underage ? "underage_blocked" : "active",
      consentVersion: args.consentVersion,
      lastActiveAt: Date.now(),
      campaignCode,
      isDemo: false,
    });
    if (underage) return { result: "underage" as const };
    const profile = await ctx.db.get(profileId);
    await ctx.db.insert("consents", {
      profileId,
      kind: "terms_privacy",
      version: args.consentVersion,
      lang: args.language,
      acceptedAt: args.consentAcceptedAt,
    });
    await writeAudit(ctx, {
      actor: profile,
      action: "consent_accepted",
      targetType: "profiles",
      targetId: profileId,
    });
    await recordEvent(ctx, "profile_completed", { actorRole: "member", isDemo: false });
    return { result: "ok" as const };
  },
});

/** profiles.updateLanguage (specs §6.1). */
export const updateLanguage = memberMutationV({
  args: { language: v.union(v.literal("en"), v.literal("bn")) },
  handler: async (ctx, args) => {
    await ctx.db.patch(ctx.profile._id, { language: args.language });
    return null;
  },
});

/**
 * profiles.updateProfile (specs §6.1) — name/phone edits. A phone change
 * un-verifies the number and recomputes donor `live` (specs §6.1).
 */
export const updateProfile = memberMutationV({
  args: { name: v.optional(v.string()), phone: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      const check = validateName(args.name);
      if (!check.ok) fail("ERR_VALIDATION", {}, check.field);
      patch.name = args.name.trim();
      patch.firstName = args.name.trim().split(/\s+/)[0];
    }
    let phoneChanged = false;
    if (args.phone !== undefined) {
      const check = validatePhone(args.phone);
      if (!check.ok) fail("ERR_VALIDATION", {}, check.field);
      const phone = normalisePhone(args.phone)!;
      if (phone !== ctx.profile.phone) {
        patch.phone = phone;
        patch.phoneVerified = false;
        patch.phoneVerifiedAt = undefined;
        patch.phoneVerifiedVia = undefined;
        patch.phoneVerifiedBy = undefined;
        phoneChanged = true;
      }
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(ctx.profile._id, patch);
    }
    if (phoneChanged) {
      const donor = await ctx.db
        .query("donorProfiles")
        .withIndex("by_profile", (q) => q.eq("profileId", ctx.profile._id))
        .unique();
      if (donor) {
        const updated = { ...ctx.profile, phoneVerified: false };
        await refreshDonorLive(ctx, updated as typeof ctx.profile, donor);
      }
    }
    return null;
  },
});

/** profiles.cancelDeletion (specs §6.1) — SCR-O06 action. */
export const cancelDeletion = mutationGeneric({
  args: {},
  handler: async (ctx) => {
    const profile = await getAuthProfile(ctx);
    if (!profile) fail("ERR_UNAUTHENTICATED");
    if (profile!.status !== "deletion_pending") fail("ERR_VALIDATION");
    await ctx.db.patch(profile!._id, {
      status: "active",
      deletionRequestedAt: undefined,
    });
    return null;
  },
});
