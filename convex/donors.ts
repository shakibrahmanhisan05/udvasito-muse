import { v } from "convex/values";
import { memberMutationV, memberQueryV } from "./_lib/auth";
import { fail } from "./_lib/errors";
import { getRulesSettings, getSetting } from "./_lib/settings";
import { recordEvent } from "./_lib/events";
import { computeDonorLive, refreshDonorLive } from "./_lib/donorLive";
import { computeEligibility } from "./rules/eligibility";
import { validateDonorForm } from "./rules/validation";
import { bloodGroup, callMode, component } from "./schema";

/**
 * Donor setup (specs §6.3, F-601/D01, SCR-D02) — 4 steps on the client,
 * one upsert here. Eligibility dates are derived by the pure rules
 * (specs §5.4) and `live` by _lib/donorLive; neither is ever edited by hand.
 */

const gender = v.union(
  v.literal("male"), v.literal("female"), v.literal("other"), v.literal("unspecified"),
);

export const upsert = memberMutationV({
  args: {
    bloodGroup: v.union(bloodGroup, v.literal("unknown")),
    gender,
    divisionId: v.id("places"),
    districtId: v.id("places"),
    upazilaId: v.id("places"),
    areaText: v.optional(v.string()),
    institution: v.optional(v.string()),
    travelRange: v.union(v.literal("thana"), v.literal("district")),
    neverDonated: v.boolean(),
    lastDonationDate: v.optional(v.string()),
    lastDonationType: v.optional(component),
    plateletOptIn: v.boolean(),
    callMode,
    checklist: v.object({
      weight: v.boolean(),
      health: v.boolean(),
      screening: v.boolean(),
    }),
    healthConsentVersion: v.string(),
  },
  handler: async (ctx, args) => {
    const check = validateDonorForm(
      {
        bloodGroup: args.bloodGroup,
        gender: args.gender,
        divisionId: args.divisionId,
        districtId: args.districtId,
        upazilaId: args.upazilaId,
        areaText: args.areaText,
        institution: args.institution,
        neverDonated: args.neverDonated,
        lastDonationDate: args.lastDonationDate,
        lastDonationType: args.lastDonationType,
        checklist: args.checklist,
        healthConsentVersion: args.healthConsentVersion,
      },
      Date.now(),
    );
    if (!check.ok) fail("ERR_VALIDATION", {}, check.field);

    // Place hierarchy must be consistent (division → district → upazila).
    const [division, district, upazila] = await Promise.all([
      ctx.db.get(args.divisionId),
      ctx.db.get(args.districtId),
      ctx.db.get(args.upazilaId),
    ]);
    if (
      !division || !district || !upazila ||
      district!.parentId !== division!._id ||
      upazila!.parentId !== district!._id
    ) {
      fail("ERR_VALIDATION", {}, "place");
    }

    const settings = await getRulesSettings(ctx);
    const { eligibleFrom, eligibleFromPlatelets } = computeEligibility(
      {
        gender: args.gender,
        neverDonated: args.neverDonated,
        lastDonationDate: args.lastDonationDate,
        lastDonationType: args.lastDonationType,
      },
      settings,
    );

    const existing = await ctx.db
      .query("donorProfiles")
      .withIndex("by_profile", (q) => q.eq("profileId", ctx.profile._id))
      .unique();

    await ctx.db.insert("consents", {
      profileId: ctx.profile._id,
      kind: "donor_health_contact",
      version: args.healthConsentVersion,
      lang: ctx.profile.language,
      acceptedAt: Date.now(),
    });

    const alertCapPerDay = await getSetting<number>(ctx, "donorAlertCapPerDay");
    const quietHours = await getSetting<{ start: string; end: string }>(ctx, "quietHours");
    const fields = {
      bloodGroup: args.bloodGroup,
      gender: args.gender,
      divisionId: args.divisionId,
      districtId: args.districtId,
      upazilaId: args.upazilaId,
      areaText: args.areaText,
      institution: args.institution,
      travelRange: args.travelRange,
      neverDonated: args.neverDonated,
      lastDonationDate: args.neverDonated ? undefined : args.lastDonationDate,
      lastDonationType: args.neverDonated ? undefined : args.lastDonationType,
      plateletOptIn: args.plateletOptIn,
      eligibleFrom,
      eligibleFromPlatelets,
      callMode: args.callMode,
      selfCheckAt: Date.now(),
      healthConsentVersion: args.healthConsentVersion,
    };

    let donorId;
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      donorId = existing._id;
    } else {
      donorId = await ctx.db.insert("donorProfiles", {
        profileId: ctx.profile._id,
        ...fields,
        availability: "available",
        availabilityConfirmedAt: Date.now(),
        volunteersMayCall: false,
        verifiedRequestsOnly: false,
        alertCapPerDay,
        quietStart: quietHours.start,
        quietEnd: quietHours.end,
        urgentOverride: false,
        hidden: false,
        live: false,
        noShowAt: [],
        isDemo: ctx.profile.isDemo,
      });
    }
    const donor = await ctx.db.get(donorId);
    const wasLive = existing?.live ?? false;
    const result = await refreshDonorLive(ctx, ctx.profile, donor!);
    if (result.live && !wasLive) {
      await recordEvent(ctx, "donor_profile_live", {
        actorRole: ctx.profile.role,
        isDemo: ctx.profile.isDemo,
      });
    }
    return result;
  },
});

/** donors.getMine (specs §6.3) — own donor profile + derived state. */
export const getMine = memberQueryV({  args: {},
  handler: async (ctx) => {
    const donor = await ctx.db
      .query("donorProfiles")
      .withIndex("by_profile", (q) => q.eq("profileId", ctx.profile._id))
      .unique();
    if (!donor) return { donor: null, live: false, notLiveReasons: [] as string[] };
    const { live, notLiveReasons } = await computeDonorLive(ctx, ctx.profile, donor);
    return {
      donor,
      eligibleFrom: donor.eligibleFrom,
      eligibleFromPlatelets: donor.eligibleFromPlatelets,
      live,
      notLiveReasons,
    };
  },
});

const availabilityArg = v.union(
  v.literal("available"), v.literal("paused"), v.literal("unavailable"),
);

const DAY_MS = 86_400_000;

/**
 * donors.setAvailability (specs §6.3, F-602): pause 1 week / 1 month /
 * until a date (VAL-20: the date must be 1–180 days out), mark not
 * available, or come back. Paused donors are skipped by matching; the
 * hourly sweep flips an elapsed pause back to available (NTF-13).
 */
export const setAvailability = memberMutationV({
  args: { availability: availabilityArg, pausedUntil: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const donor = await ctx.db
      .query("donorProfiles")
      .withIndex("by_profile", (q) => q.eq("profileId", ctx.profile._id))
      .unique();
    if (!donor) fail("ERR_NOT_FOUND");
    const now = Date.now();
    if (args.availability === "paused") {
      if (
        args.pausedUntil === undefined ||
        args.pausedUntil < now + DAY_MS ||
        args.pausedUntil > now + 180 * DAY_MS
      ) {
        fail("ERR_VALIDATION", {}, "pausedUntil");
      }
    }
    await ctx.db.patch(donor._id, {
      availability: args.availability,
      pausedUntil: args.availability === "paused" ? args.pausedUntil : undefined,
      availabilityConfirmedAt: now,
    });
    await recordEvent(ctx, "availability_changed", {
      actorRole: ctx.profile.role,
      props: { state: args.availability },
      isDemo: ctx.profile.isDemo,
    });
    return null;
  },
});

/** donors.confirmStillAvailable (specs §6.3) — the S-28 nudge answer. */
export const confirmStillAvailable = memberMutationV({
  args: {},
  handler: async (ctx) => {
    const donor = await ctx.db
      .query("donorProfiles")
      .withIndex("by_profile", (q) => q.eq("profileId", ctx.profile._id))
      .unique();
    if (!donor) fail("ERR_NOT_FOUND");
    await ctx.db.patch(donor._id, { availabilityConfirmedAt: Date.now() });
    return null;
  },
});
