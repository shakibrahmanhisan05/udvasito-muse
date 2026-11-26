import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { getAuthProfile, memberMutationV, memberQueryV } from "./_lib/auth";
import { fail } from "./_lib/errors";
import { getSetting } from "./_lib/settings";
import { writeAudit } from "./_lib/audit";
import { recordEvent } from "./_lib/events";
import { limitOrThrow } from "./_lib/ratelimit";
import { refreshDonorLive } from "./_lib/donorLive";
import { eqRange } from "./_lib/db";
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

// ─── Privacy & data control (specs §6.1/§6.4, F-603, SCR-M07) ───────

const DAY_MS = 86_400_000;

/** Whose hands a reveal put the caller's number into, in plain terms. */
function viewerRoleOf(reveal: {
  reason: string;
  subjectRole: string;
}): string {
  switch (reveal.reason) {
    case "volunteer_case":
    case "volunteer_optin_call":
      return "volunteer";
    case "admin_reveal":
      return "admin";
    case "volunteer_hotline":
      return "requester";
    default: // confirmed_slot: the other side of the slot
      return reveal.subjectRole === "donor" ? "requester" : "donor";
  }
}

/**
 * profiles.whoHasMyNumber 📞-meta (specs §6.1, SCR-M07): every reveal
 * where the caller is the subject — when, which request, who saw it
 * (first name + role) and until when. No numbers are returned.
 */
export const whoHasMyNumber = memberQueryV({
  args: {},
  handler: async (ctx) => {
    const reveals = await ctx.db
      .query("contactReveals")
      .withIndex("by_subject", (q) => q.eq("subjectId", ctx.profile._id))
      .collect();
    reveals.sort((a, b) => b._creationTime - a._creationTime);
    const out = [];
    for (const reveal of reveals) {
      const viewer = await ctx.db.get(reveal.viewerId);
      let hospitalName = "";
      let requestDate = reveal._creationTime;
      if (reveal.requestId) {
        const request = await ctx.db.get(reveal.requestId);
        if (request) {
          requestDate = request._creationTime;
          if (request.hospitalId) {
            const hospital = await ctx.db.get(request.hospitalId);
            hospitalName = hospital?.nameEn ?? "";
          } else {
            hospitalName = request.placeText ?? "";
          }
        }
      }
      out.push({
        requestDate,
        hospitalName,
        viewerFirstName: viewer?.firstName ?? "",
        viewerRole: viewerRoleOf(reveal),
        until: reveal.expiresAt,
      });
    }
    return out;
  },
});

/**
 * profiles.requestDeletion (specs §6.1, F-603): typing DELETE / মুছুন
 * (VAL-25) puts the account into `deletion_pending`; the daily
 * retention job anonymises it within S-27 days (PRD §5.9). Cancel any
 * time before then with profiles.cancelDeletion.
 */
export const requestDeletion = memberMutationV({
  args: { confirmWord: v.string() },
  handler: async (ctx, args) => {
    if (args.confirmWord !== "DELETE" && args.confirmWord !== "মুছুন") {
      fail("ERR_VALIDATION", {}, "confirmWord");
    }
    const now = Date.now();
    await ctx.db.patch(ctx.profile._id, {
      status: "deletion_pending",
      deletionRequestedAt: now,
    });
    const donor = await ctx.db
      .query("donorProfiles")
      .withIndex("by_profile", (q) => q.eq("profileId", ctx.profile._id))
      .unique();
    if (donor) {
      const fresh = await ctx.db.get(ctx.profile._id);
      if (fresh) await refreshDonorLive(ctx, fresh, donor);
    }
    const volunteer = await ctx.db
      .query("volunteerProfiles")
      .withIndex("by_profile", (q) => q.eq("profileId", ctx.profile._id))
      .unique();
    if (volunteer && volunteer.onDuty) {
      await ctx.db.patch(volunteer._id, { onDuty: false });
    }
    await writeAudit(ctx, {
      actor: ctx.profile,
      action: "deletion_requested",
      targetType: "profiles",
      targetId: ctx.profile._id,
    });
    const deletionDays = await getSetting<number>(ctx, "deletionDays");
    return { deleteBy: now + deletionDays * DAY_MS };
  },
});

/**
 * profiles.exportMyData (specs §6.1, F-603): a JSON download of the
 * caller's OWN data only — profile, donor/volunteer profiles, own
 * requests and responses, consents, and reveal metadata (first names,
 * never anyone else's number). Stored 24 h; at most 2 exports per day.
 * (Specs list this as an action; it is a mutation here so identity,
 * the rate check and the storage write stay in one transaction —
 * the client-visible contract {url, expiresAt} is unchanged.)
 */
export const exportMyData = memberMutationV({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const myExports = await ctx.db
      .query("exports")
      .withIndex("by_requestedBy", (q) => q.eq("requestedBy", ctx.profile._id))
      .collect();
    const todayMine = myExports.filter(
      (e) => e.kind === "my_data" && e._creationTime >= now - DAY_MS,
    );
    if (todayMine.length >= 2) {
      const oldest = Math.min(...todayMine.map((e) => e._creationTime));
      fail("ERR_RATE_LIMITED", {
        minutes: Math.max(1, Math.ceil((oldest + DAY_MS - now) / 60_000)),
      });
    }
    const profile = ctx.profile;
    const donor = await ctx.db
      .query("donorProfiles")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .unique();
    const volunteer = await ctx.db
      .query("volunteerProfiles")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .unique();
    const requests = (
      await Promise.all(
        (["live", "covered", "closed"] as const).map(
          async (status) =>
            await ctx.db
              .query("requests")
              .withIndex(
                "by_requester_status",
                eqRange([["requesterId", profile._id], ["status", status]]),
              )
              .collect(),
        ),
      )
    ).flat();
    const responses = await ctx.db
      .query("responses")
      .withIndex("by_donor_state", eqRange([["donorId", profile._id]]))
      .collect();
    const consents = await ctx.db
      .query("consents")
      .withIndex("by_profile_kind", eqRange([["profileId", profile._id]]))
      .collect();
    const revealsAboutMe = await ctx.db
      .query("contactReveals")
      .withIndex("by_subject", (q) => q.eq("subjectId", profile._id))
      .collect();
    const revealMeta = async (rows: typeof revealsAboutMe, other: "viewerId" | "subjectId") => {
      const out = [];
      for (const row of rows) {
        const person = await ctx.db.get(row[other]);
        out.push({
          createdAt: row._creationTime,
          personFirstName: person?.firstName ?? "",
          reason: row.reason,
          expiresAt: row.expiresAt,
        });
      }
      return out;
    };
    const revealsByMe = await ctx.db
      .query("contactReveals")
      .withIndex("by_viewer_request", eqRange([["viewerId", profile._id]]))
      .collect();

    const data = {
      exportedAt: new Date(now).toISOString(),
      profile: {
        name: profile.name,
        firstName: profile.firstName,
        dateOfBirth: profile.dateOfBirth,
        phone: profile.phone,
        phoneVerified: profile.phoneVerified,
        language: profile.language,
        role: profile.role,
        status: profile.status,
        joinedAt: profile._creationTime,
      },
      donorProfile: donor
        ? {
            bloodGroup: donor.bloodGroup,
            gender: donor.gender,
            areaText: donor.areaText,
            institution: donor.institution,
            travelRange: donor.travelRange,
            neverDonated: donor.neverDonated,
            lastDonationDate: donor.lastDonationDate,
            lastDonationType: donor.lastDonationType,
            plateletOptIn: donor.plateletOptIn,
            callMode: donor.callMode,
            volunteersMayCall: donor.volunteersMayCall,
            eligibleFrom: donor.eligibleFrom,
          }
        : null,
      volunteerProfile: volunteer
        ? {
            status: volunteer.status,
            institution: volunteer.institution,
            motivation: volunteer.motivation,
            onDuty: volunteer.onDuty,
          }
        : null,
      requests: requests.map((r) => ({
        id: r._id,
        createdAt: r._creationTime,
        bloodGroup: r.bloodGroup,
        component: r.component,
        unitsNeeded: r.unitsNeeded,
        unitsConfirmed: r.unitsConfirmed,
        placeText: r.placeText,
        neededBy: r.neededBy,
        status: r.status,
        contactPhone: r.contactPhone,
        patientName: r.patientName,
        ward: r.ward,
        note: r.note,
      })),
      responses: responses.map((r) => ({
        requestId: r.requestId,
        state: r.state,
        wave: r.wave,
        notifiedAt: r.notifiedAt,
        acceptedAt: r.acceptedAt,
        confirmedAt: r.confirmedAt,
        outcomeDonor: r.outcomeDonor,
        outcomeRequester: r.outcomeRequester,
      })),
      consents: consents.map((c) => ({
        kind: c.kind,
        version: c.version,
        lang: c.lang,
        acceptedAt: c.acceptedAt,
      })),
      whoHasMyNumber: await revealMeta(revealsAboutMe, "viewerId"),
      numbersIReceived: await revealMeta(revealsByMe, "subjectId"),
    };
    const fileId = await ctx.storage.store(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const expiresAt = now + DAY_MS;
    await ctx.db.insert("exports", {
      kind: "my_data",
      requestedBy: profile._id,
      fileId,
      expiresAt,
    });
    await writeAudit(ctx, {
      actor: profile,
      action: "export_created",
      targetType: "profiles",
      targetId: profile._id,
      meta: { kind: "my_data" },
    });
    return { url: await ctx.storage.getUrl(fileId), expiresAt };
  },
});
