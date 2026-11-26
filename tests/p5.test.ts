import { beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerPush } from "@convex-dev/expo-push-notifications/test";
import schema from "../convex/schema";
import type { Id } from "../convex/schemaTypes";
import * as seedModule from "../convex/seed";
import * as profilesModule from "../convex/profiles";
import * as consentsModule from "../convex/consents";
import * as donorsModule from "../convex/donors";
import * as requestsModule from "../convex/requests";
import * as matchingModule from "../convex/matching";
import * as responsesModule from "../convex/responses";
import * as lifecycleModule from "../convex/lifecycle";
import * as reportsModule from "../convex/reports";
import * as blocksModule from "../convex/blocks";
import * as phoneVerificationModule from "../convex/phoneVerification";
import * as volunteersModule from "../convex/volunteers";
import * as adminPeopleModule from "../convex/admin/people";
import * as retentionModule from "../convex/retention";
import * as hospitalsModule from "../convex/hospitals";
import * as pushModule from "../convex/push";
import * as intakeModule from "../convex/intake";
import * as pushWebModule from "../convex/pushWeb";
import * as statsModule from "../convex/stats";
import * as adminModerationModule from "../convex/admin/moderation";
import * as adminAuditModule from "../convex/admin/audit";
import * as adminSettingsModule from "../convex/admin/settings";
import * as adminAiModule from "../convex/admin/ai";
import * as adminUsageModule from "../convex/admin/usage";
import * as adminDemoModule from "../convex/admin/demo";
import * as authModule from "../convex/auth";
import httpModule from "../convex/http";
import { laDayKey } from "../convex/rules/stats";

const modules = {
  "../convex/_generated/api.ts": async () => ({}),
  "../convex/seed.ts": async () => seedModule,
  "../convex/profiles.ts": async () => profilesModule,
  "../convex/consents.ts": async () => consentsModule,
  "../convex/donors.ts": async () => donorsModule,
  "../convex/requests.ts": async () => requestsModule,
  "../convex/matching.ts": async () => matchingModule,
  "../convex/responses.ts": async () => responsesModule,
  "../convex/lifecycle.ts": async () => lifecycleModule,
  "../convex/reports.ts": async () => reportsModule,
  "../convex/blocks.ts": async () => blocksModule,
  "../convex/phoneVerification.ts": async () => phoneVerificationModule,
  "../convex/volunteers.ts": async () => volunteersModule,
  "../convex/admin/people.ts": async () => adminPeopleModule,
  "../convex/retention.ts": async () => retentionModule,
  "../convex/hospitals.ts": async () => hospitalsModule,
  "../convex/push.ts": async () => pushModule,
  "../convex/intake.ts": async () => intakeModule,
  "../convex/pushWeb.ts": async () => pushWebModule,
  "../convex/stats.ts": async () => statsModule,
  "../convex/admin/moderation.ts": async () => adminModerationModule,
  "../convex/admin/audit.ts": async () => adminAuditModule,
  "../convex/admin/settings.ts": async () => adminSettingsModule,
  "../convex/admin/ai.ts": async () => adminAiModule,
  "../convex/admin/usage.ts": async () => adminUsageModule,
  "../convex/admin/demo.ts": async () => adminDemoModule,
  "../convex/auth.ts": async () => authModule,
  "../convex/http.ts": async () => ({ default: httpModule }),
};

const seedSettings = makeFunctionReference<"mutation">("seed:seedSettings");
const computeSnapshots = makeFunctionReference<"mutation">("stats:computeSnapshots");
const getPublicSnapshot = makeFunctionReference<"query">("stats:getPublicSnapshot");
const dashboard = makeFunctionReference<"query">("stats:dashboard");
const recomputeStats = makeFunctionReference<"mutation">("stats:recomputeStats");

// 2026-12-05 12:00 Asia/Dhaka (06:00 UTC), a Saturday.
export const T0 = Date.parse("2026-12-05T06:00:00.000Z");
export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export function newTest() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  registerPush(t);
  return t;
}
export type Test = ReturnType<typeof newTest>;

export async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "NO_THROW";
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code ?? String(e);
  }
}

/** Run fn with the fake clock set to ts (row _creationTime follows it). */
export async function at<T>(ts: number, fn: () => Promise<T>): Promise<T> {
  vi.setSystemTime(ts);
  return await fn();
}

let placeSeq = 0;
/** Insert the minimal place chain (division/district/upazila) once. */
export async function seedPlaces(t: Test) {
  return await t.run(async (ctx) => {
    placeSeq += 1;
    const divisionId = await ctx.db.insert("places", {
      level: "division", code: `DIV-${placeSeq}`, nameEn: "Chattogram", nameBn: "চট্টগ্রাম",
      lat: 22.35, lng: 91.8, isMetroThana: false, neighbourIds: [],
    });
    const districtId = await ctx.db.insert("places", {
      level: "district", code: `DIS-${placeSeq}`, nameEn: "Chattogram", nameBn: "চট্টগ্রাম",
      parentId: divisionId, lat: 22.35, lng: 91.8, isMetroThana: false, neighbourIds: [],
    });
    const upazilaId = await ctx.db.insert("places", {
      level: "upazila", code: `UPA-${placeSeq}`, nameEn: "Kotwali", nameBn: "কোতোয়ালী",
      parentId: districtId, lat: 22.36, lng: 91.83, isMetroThana: true, neighbourIds: [],
    });
    return { divisionId, districtId, upazilaId };
  });
}

export type Places = Awaited<ReturnType<typeof seedPlaces>>;

let userSeq = 0;
/** Insert a profile row directly (bypasses onboarding) and return ids. */
export async function insertProfile(
  t: Test,
  opts: {
    name?: string;
    role?: "member" | "volunteer" | "admin" | "superadmin";
    status?: "active" | "frozen" | "suspended" | "banned";
    isDemo?: boolean;
    phone?: string;
    phoneVerified?: boolean;
    campaignCode?: string;
    practiceId?: string;
    authUserId?: string;
  } = {},
) {
  userSeq += 1;
  const authUserId = opts.authUserId ?? `p5-user-${userSeq}`;
  const profileId = await t.run(async (ctx) =>
    await ctx.db.insert("profiles", {
      authUserId,
      name: opts.name ?? `Person ${userSeq}`,
      firstName: (opts.name ?? `Person ${userSeq}`).split(" ")[0],
      dateOfBirth: "1995-05-01",
      language: "en",
      role: opts.role ?? "member",
      phone: opts.phone ?? "01712345678",
      phoneVerified: opts.phoneVerified ?? true,
      status: opts.status ?? "active",
      consentVersion: "2026-11-28-pilot",
      lastActiveAt: Date.now(),
      campaignCode: opts.campaignCode,
      practiceId: opts.practiceId,
      isDemo: opts.isDemo ?? false,
    }),
  );
  return { profileId, authUserId, asUser: t.withIdentity({ subject: authUserId }) };
}

export async function insertDonor(
  t: Test,
  places: Places,
  profileId: Id<"profiles">,
  opts: {
    bloodGroup?: string;
    live?: boolean;
    availability?: "available" | "paused" | "unavailable";
    eligibleFrom?: number;
    availabilityConfirmedAt?: number;
    isDemo?: boolean;
  } = {},
) {
  return await t.run(async (ctx) =>
    await ctx.db.insert("donorProfiles", {
      profileId,
      bloodGroup: (opts.bloodGroup ?? "A+") as never,
      gender: "unspecified",
      divisionId: places.divisionId,
      districtId: places.districtId,
      upazilaId: places.upazilaId,
      travelRange: "district",
      neverDonated: true,
      plateletOptIn: false,
      availability: opts.availability ?? "available",
      availabilityConfirmedAt: opts.availabilityConfirmedAt ?? Date.now(),
      eligibleFrom: opts.eligibleFrom ?? 0,
      eligibleFromPlatelets: 0,
      callMode: "mutual",
      volunteersMayCall: false,
      verifiedRequestsOnly: false,
      alertCapPerDay: 3,
      quietStart: "00:00",
      quietEnd: "07:00",
      urgentOverride: false,
      hidden: false,
      live: opts.live ?? true,
      selfCheckAt: Date.now(),
      healthConsentVersion: "2026-11-28-pilot",
      noShowAt: [],
      isDemo: opts.isDemo ?? false,
    }),
  );
}

export async function insertRequest(
  t: Test,
  places: Places,
  requesterId: Id<"profiles">,
  opts: {
    status?: "live" | "covered" | "closed";
    closeReason?: "fulfilled" | "not_needed" | "expired" | "removed" | "merged";
    unitsConfirmed?: number;
    urgency?: "now" | "today" | "later";
    bloodGroup?: string;
    isDemo?: boolean;
    clientId?: string;
  } = {},
) {
  return await t.run(async (ctx) =>
    await ctx.db.insert("requests", {
      requesterId,
      source: "form",
      clientId: opts.clientId ?? `client-${Math.random().toString(36).slice(2)}`,
      bloodGroup: (opts.bloodGroup ?? "B+") as never,
      component: "whole_blood",
      isDengue: false,
      unitsNeeded: 2,
      unitsConfirmed: opts.unitsConfirmed ?? 0,
      divisionId: places.divisionId,
      districtId: places.districtId,
      upazilaId: places.upazilaId,
      approxLat: 22.36,
      approxLng: 91.83,
      neededBy: Date.now() + 6 * HOUR,
      urgency: opts.urgency ?? "today",
      contactPhone: "01712345678",
      contactPhoneVerified: true,
      lang: "en",
      publicSlug: `slug-${Math.random().toString(36).slice(2, 12)}`,
      status: opts.status ?? "live",
      closeReason: opts.closeReason,
      closedAt: opts.status === "closed" ? Date.now() : undefined,
      wave: 1,
      volunteerShownIds: [],
      fallbackShown: false,
      zeroEligibleAtPublish: false,
      verifiedBadge: false,
      slipStatus: "none",
      revealsFrozen: false,
      hiddenByModerator: false,
      aiAssisted: false,
      isDemo: opts.isDemo ?? false,
    }),
  );
}

export async function insertResponse(
  t: Test,
  requestId: Id<"requests">,
  donorId: Id<"profiles">,
  donorProfileId: Id<"donorProfiles">,
  opts: {
    wave?: number;
    state?: string;
    notifiedAt: number;
    openedAt?: number;
    acceptedAt?: number;
    outcomeDonor?: "donated" | "did_not_donate" | "not_yet";
    outcomeDonorAt?: number;
    outcomeRequesterAt?: number;
    isDemo?: boolean;
  },
) {
  return await t.run(async (ctx) =>
    await ctx.db.insert("responses", {
      requestId,
      donorProfileId,
      donorId,
      wave: opts.wave ?? 1,
      state: (opts.state ?? "notified") as never,
      notifiedAt: opts.notifiedAt,
      openedAt: opts.openedAt,
      acceptedAt: opts.acceptedAt,
      callMode: "mutual",
      outcomeDonor: opts.outcomeDonor,
      outcomeDonorAt: opts.outcomeDonorAt,
      outcomeRequesterAt: opts.outcomeRequesterAt,
      isDemo: opts.isDemo ?? false,
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────
// Slice 1 — stats snapshots (F-901 backend) + public stats data.
// The fixture below is designed so every expected number can be
// counted by hand from this file alone; the assertions use literals,
// never the aggregation code under test.
// ─────────────────────────────────────────────────────────────────────

describe("P5 slice 1 — dashboard numbers equal a hand count (Phase DoD)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  async function buildFixture(t: Test) {
    // NOTE: convex-test keeps _creationTime monotonic (like production),
    // so the fixture is built in strictly chronological order — the
    // clock only ever moves forward, starting 40 days before T0.
    vi.setSystemTime(T0 - 40 * DAY);
    await t.mutation(seedSettings, {});
    const places = await seedPlaces(t);
    // Point the AI quota assertions at a named lite model.
    await t.run(async (ctx) => {
      const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", "ai.models")).unique();
      await ctx.db.patch(row!._id, { value: { lite: "test-lite", flash: "test-flash" } });
    });

    // All profiles first (their own creation times feed no metric).
    const d1 = await insertProfile(t, { name: "Donor One" });
    const d2 = await insertProfile(t, { name: "Donor Two", campaignCode: "CU-2026" });
    const d3 = await insertProfile(t, { name: "Donor Three", campaignCode: "CU-2026" });
    const d4 = await insertProfile(t, { name: "Donor Four" });
    await insertProfile(t, { name: "Member Campaign", campaignCode: "CU-2026" });
    const dp = await insertProfile(t, { name: "Practice Donor", isDemo: true });
    const requester = await insertProfile(t, { name: "Requester" });
    const v1 = await insertProfile(t, { name: "Vol One", role: "volunteer" });
    const v2 = await insertProfile(t, { name: "Vol Two", role: "volunteer" });

    // Donor rows + requests in chronological order of _creationTime.
    await insertDonor(t, places, d1.profileId, {
      bloodGroup: "A+", live: true, availability: "available",
      eligibleFrom: 0, availabilityConfirmedAt: T0 - 10 * DAY,
    }); // created T0-40d → outside the 30-day registration window
    await insertDonor(t, places, dp.profileId, {
      bloodGroup: "A+", live: true, availability: "available", eligibleFrom: 0, isDemo: true,
    }); // practice — invisible below
    await at(T0 - 5 * DAY, async () => {
      await insertDonor(t, places, d2.profileId, {
        bloodGroup: "A+", live: true, availability: "available",
        eligibleFrom: T0 + 10 * DAY, // in cooldown → not available now
        availabilityConfirmedAt: T0 - 1 * DAY,
      });
      await insertDonor(t, places, d3.profileId, {
        bloodGroup: "O-", live: true, availability: "paused",
        eligibleFrom: 0, availabilityConfirmedAt: T0 - 100 * DAY, // stale
      });
    });
    const r5 = await at(T0 - 4 * DAY, async () =>
      await insertRequest(t, places, requester.profileId, { status: "closed", closeReason: "expired", urgency: "later" }));
    const r4 = await at(T0 - 3 * DAY, async () =>
      await insertRequest(t, places, requester.profileId, { status: "closed", closeReason: "fulfilled", urgency: "now" }));
    await at(T0 - 2 * DAY, async () =>
      await insertDonor(t, places, d4.profileId, {
        bloodGroup: "B+", live: false, availability: "available",
        eligibleFrom: 0, availabilityConfirmedAt: T0 - 1 * DAY,
      }));

    // Volunteers: V1 on duty now (since 10:00 Dhaka today); V2 covered
    // Dec 4, 08:00–12:00 Dhaka via duty events, now off duty.
    const vpIds = await t.run(async (ctx) => {
      const vp1 = await ctx.db.insert("volunteerProfiles", {
        profileId: v1.profileId, status: "approved", upazilaIds: [], districtIds: [],
        motivation: "help", numberDisplayConsentAt: T0 - DAY, onDuty: true,
        onDutySince: T0 - 2 * HOUR, activeClaims: 0, isDemo: false,
      });
      const vp2 = await ctx.db.insert("volunteerProfiles", {
        profileId: v2.profileId, status: "approved", upazilaIds: [], districtIds: [],
        motivation: "help", numberDisplayConsentAt: T0 - DAY, onDuty: false,
        activeClaims: 0, isDemo: false,
      });
      return { vp1, vp2 };
    });
    const dec4 = (h: number) => Date.parse("2026-12-04T00:00:00.000Z") + (h - 6) * HOUR; // Dhaka hour → UTC ms
    await at(dec4(8), async () =>
      await t.run(async (ctx) => {
        await ctx.db.insert("events", {
          name: "volunteer_duty_changed", actorRole: "volunteer",
          props: { onDuty: true, vpId: vpIds.vp2 }, isDemo: false,
        });
      }));
    await at(dec4(12), async () =>
      await t.run(async (ctx) => {
        await ctx.db.insert("events", {
          name: "volunteer_duty_changed", actorRole: "volunteer",
          props: { onDuty: false, vpId: vpIds.vp2 }, isDemo: false,
        });
      }));

    const r3 = await at(T0 - 2 * HOUR, async () =>
      await insertRequest(t, places, requester.profileId, { status: "covered", unitsConfirmed: 1, urgency: "now" }));
    const r1 = await at(T0 - 20 * MIN, async () =>
      await insertRequest(t, places, requester.profileId, { status: "live", urgency: "today" }));
    // r2: second live request (counted in openRequests; never referenced).
    await at(T0 - 5 * MIN, async () =>
      await insertRequest(t, places, requester.profileId, { status: "live", urgency: "today" }));
    const rPractice = await at(T0 - 4 * MIN, async () =>
      await insertRequest(t, places, dp.profileId, { status: "live", isDemo: true }));

    const donorProfileOf = async (profileId: Id<"profiles">) =>
      await t.run(async (ctx) =>
        (await ctx.db.query("donorProfiles").withIndex("by_profile", (q) => q.eq("profileId", profileId)).unique())!._id);
    const d1Donor = await donorProfileOf(d1.profileId);
    const d2Donor = await donorProfileOf(d2.profileId);
    const dpDonor = await donorProfileOf(dp.profileId);

    await insertResponse(t, r5, d1.profileId, d1Donor, { wave: 2, notifiedAt: T0 - 4 * DAY + 120_000 });
    await insertResponse(t, r4, d1.profileId, d1Donor, {
      wave: 1, notifiedAt: T0 - 3 * DAY + 45_000, openedAt: T0 - 3 * DAY + 60_000,
      acceptedAt: T0 - 3 * DAY + 300_000, outcomeDonor: "donated",
      outcomeDonorAt: T0 - 2 * DAY, state: "confirmed",
    });
    await insertResponse(t, r3, d2.profileId, d2Donor, {
      wave: 1, notifiedAt: T0 - 2 * HOUR + 30_000, openedAt: T0 - 2 * HOUR + 40_000,
      acceptedAt: T0 - 2 * HOUR + 600_000, outcomeDonor: "donated",
      outcomeDonorAt: T0 - 1 * HOUR, outcomeRequesterAt: T0 - 1 * HOUR, state: "confirmed",
    });
    await insertResponse(t, r1, d1.profileId, d1Donor, { wave: 1, notifiedAt: T0 - 20 * MIN + 60_000 });
    await insertResponse(t, rPractice, dp.profileId, dpDonor, { wave: 1, notifiedAt: T0 - 60_000, isDemo: true });

    // Contact reveals on R3 + R4 (real) — contact_shared stage.
    await t.run(async (ctx) => {
      for (const requestId of [r3, r4]) {
        await ctx.db.insert("contactReveals", {
          requestId, viewerId: requester.profileId, subjectId: d1.profileId,
          subjectRole: "donor", reason: "confirmed_slot", expiresAt: T0 + DAY, isDemo: false,
        });
      }
    });

    // Moderation: 2 open real, 1 decided real, 1 open practice.
    // AI quota for the LA day containing T0: lite 40, flash 5.
    // Today's activity for the usage counters: 2 sent + 1 failed
    // notifications, 3 AI calls (all real).
    vi.setSystemTime(T0);
    await t.run(async (ctx) => {
      const mk = async (status: "open" | "decided", isDemo: boolean) =>
        await ctx.db.insert("moderationItems", {
          type: "report", kind: "fake", severity: "high", status, isDemo,
        });
      await mk("open", false);
      await mk("open", false);
      await mk("decided", false);
      await mk("open", true);
      await ctx.db.insert("aiQuota", { day: laDayKey(T0), model: "test-lite", count: 40 });
      await ctx.db.insert("aiQuota", { day: laDayKey(T0), model: "test-flash", count: 5 });
      for (const status of ["sent", "sent", "failed"] as const) {
        await ctx.db.insert("notifications", {
          recipientId: requester.profileId, template: "NTF-01", channel: "inapp",
          status, isDemo: false,
        });
      }
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert("aiCalls", {
          feature: "intake", model: "test-lite", ok: true,
          inputRedacted: "x", output: "{}", latencyMs: 10, isDemo: false,
        });
      }
    });
    return { places, requester };
  }

  it("admin snapshot equals the hand count, practice excluded", async () => {
    const t = newTest();
    await buildFixture(t);
    const admin = await insertProfile(t, { name: "Admin", role: "admin" });
    await t.mutation(computeSnapshots, {});
    const snap = await admin.asUser.query(dashboard, {});
    expect(snap).not.toBeNull();
    const d = snap!.data as Record<string, never>;

    expect(d["liveNow"]).toEqual({
      openRequests: 2, coveredRequests: 1, waitingOver15Min: 1, volunteersOnDuty: 1,
    });
    expect(d["bloodPool"]).toEqual({
      "A+": { live: 2, availableNow: 1 },
      "A-": { live: 0, availableNow: 0 },
      "B+": { live: 0, availableNow: 0 },
      "B-": { live: 0, availableNow: 0 },
      "AB+": { live: 0, availableNow: 0 },
      "AB-": { live: 0, availableNow: 0 },
      "O+": { live: 0, availableNow: 0 },
      "O-": { live: 1, availableNow: 0 },
    });
    expect(d["donorsLive"]).toBe(3);
    // First-wave deltas: 30s, 45s, 60s, 120s → median (45+60)/2 s.
    // First-accept deltas ("now" only): 300s, 600s → median 450s.
    for (const window of ["last7Days", "last30Days"] as const) {
      const speed = (d["speed"] as Record<string, { medianFirstWaveMs: number; medianFirstAcceptMs: number }>)[window];
      expect(speed.medianFirstWaveMs).toBe(52_500);
      expect(speed.medianFirstAcceptMs).toBe(450_000);
    }
    expect(d["funnel"]).toEqual({
      published: 5, donorsNotified: 4, alertOpened: 2, donorAccepted: 2,
      contactShared: 2, reportedByRequester: 1, confirmedByDonor: 2,
      confirmationResponseRate: 1, donationsConfirmedRequests: 2,
    });
    const participation = d["participation"] as Record<string, never>;
    expect(participation["donorsLive"]).toBe(3);
    expect(participation["newDonors30Days"]).toBe(3);
    expect(participation["campaignSignups"]).toEqual([{ code: "CU-2026", count: 3 }]);
    expect(participation["availabilityFreshnessPct"]).toBe(75);
    const regs = participation["registrationsByDay"] as { day: string; count: number }[];
    expect(regs).toHaveLength(30);
    expect(regs.reduce((s, r) => s + r.count, 0)).toBe(3);
    expect(regs.find((r) => r.day === "2026-11-30")?.count).toBe(2); // T0-5d, Dhaka
    expect(regs.find((r) => r.day === "2026-12-03")?.count).toBe(1); // T0-2d, Dhaka

    const coverage = d["volunteerCoverage"] as { byHour: number[]; gapHours: number[]; uncoveredSlots: number };
    const expectedByHour = new Array<number>(24).fill(0);
    expectedByHour[8] = 1; expectedByHour[9] = 1; // Dec 4, V2
    expectedByHour[10] = 2; expectedByHour[11] = 2; // Dec 4 V2 + Dec 5 V1
    expectedByHour[12] = 1; // Dec 5: V1 is still on duty as hour 12 begins
    expect(coverage.byHour).toEqual(expectedByHour);
    expect(coverage.gapHours).toEqual(
      Array.from({ length: 24 }, (_, h) => h).filter((h) => ![8, 9, 10, 11, 12].includes(h)),
    );
    expect(coverage.uncoveredSlots).toBe(168 - 7);

    const alerts = d["alerts"] as Record<string, never>;
    expect(alerts["openModerationItems"]).toBe(2);
    expect(alerts["ai"]).toMatchObject({
      callsToday: 45, liteCallsToday: 40, liteDailyLimit: 500,
      liteUsagePct: 8, fallback80Active: false,
    });
  });

  it("public snapshot equals the hand count, practice excluded", async () => {
    const t = newTest();
    await buildFixture(t);
    await t.mutation(computeSnapshots, {});
    const pub = await t.query(getPublicSnapshot, {});
    const { updatedAt, ...rest } = pub!.data as Record<string, unknown>;
    expect(rest).toEqual({
      donorsByGroup: {
        "A+": 2, "A-": 0, "B+": 0, "B-": 0, "AB+": 0, "AB-": 0, "O+": 0, "O-": 1,
      },
      donorsLive: 3,
      requestsHelped: 1,
      donationsConfirmed: 2,
    });
    expect(updatedAt as number).toBeGreaterThanOrEqual(T0);
  });

  it("usage counters for today are refreshed by the same pass", async () => {
    const t = newTest();
    await buildFixture(t);
    await t.mutation(computeSnapshots, {});
    const rows = await t.run(async (ctx) => await ctx.db.query("usageCounters").collect());
    const get = (service: string, metric: string) =>
      rows.find((r) => r.service === service && r.metric === metric)?.value;
    expect(get("requests", "published")).toBe(3); // R1, R2, R3 created Dec 5 (Dhaka)
    expect(get("notifications", "sent")).toBe(2);
    expect(get("ai", "calls")).toBe(3);
  });

  it("dashboard is null before the first computation; recompute schedules one", async () => {
    const t = newTest();
    await t.mutation(seedSettings, {});
    const admin = await insertProfile(t, { name: "Admin", role: "admin" });
    expect(await admin.asUser.query(dashboard, {})).toBeNull();
    await admin.asUser.mutation(recomputeStats, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await admin.asUser.query(dashboard, {})).not.toBeNull();
  });

  it("dashboard + recompute refuse members and volunteers (negative)", async () => {
    const t = newTest();
    await t.mutation(seedSettings, {});
    const member = await insertProfile(t, { name: "Member" });
    const volunteer = await insertProfile(t, { name: "Vol", role: "volunteer" });
    expect(await codeOf(member.asUser.query(dashboard, {}))).toBe("ERR_FORBIDDEN");
    expect(await codeOf(volunteer.asUser.query(dashboard, {}))).toBe("ERR_FORBIDDEN");
    expect(await codeOf(member.asUser.mutation(recomputeStats, {}))).toBe("ERR_FORBIDDEN");
    expect(await codeOf(volunteer.asUser.mutation(recomputeStats, {}))).toBe("ERR_FORBIDDEN");
  });
});

const moderationList = makeFunctionReference<"query">("admin/moderation:list");
const moderationGet = makeFunctionReference<"query">("admin/moderation:get");
const moderationDecide = makeFunctionReference<"mutation">("admin/moderation:decide");
const reportsCreate = makeFunctionReference<"mutation">("reports:create");

// ─────────────────────────────────────────────────────────────────────
// Slice 2 — moderation queue + decisions (F-803). Phase DoD: every
// decision writes an audit row AND a notification to the affected
// person — asserted for all six decisions.
// ─────────────────────────────────────────────────────────────────────

describe("P5 slice 2 — moderation decisions (F-803)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  async function setup(t: Test) {
    await t.mutation(seedSettings, {});
    const places = await seedPlaces(t);
    const admin = await insertProfile(t, { name: "Admin", role: "admin" });
    const subject = await insertProfile(t, { name: "Subject Person" });
    const reporter = await insertProfile(t, { name: "Reporter" });
    return { places, admin, subject, reporter };
  }

  async function insertItem(
    t: Test,
    opts: {
      subjectId?: Id<"profiles">;
      requestId?: Id<"requests">;
      kind?: string;
      type?: "report" | "flag";
      severity?: "high" | "medium" | "low";
      isDemo?: boolean;
    } = {},
  ) {
    return await t.run(async (ctx) =>
      await ctx.db.insert("moderationItems", {
        type: opts.type ?? "report",
        kind: (opts.kind ?? "harassment") as never,
        subjectId: opts.subjectId,
        requestId: opts.requestId,
        severity: opts.severity ?? "medium",
        status: "open",
        isDemo: opts.isDemo ?? false,
      }),
    );
  }

  async function auditCount(t: Test, action: string) {
    return await t.run(async (ctx) =>
      (await ctx.db.query("auditLog").withIndex("by_action", (q) => q.eq("action", action)).collect()).length,
    );
  }
  async function notificationsTo(t: Test, profileId: Id<"profiles">, template: string) {
    return await t.run(async (ctx) =>
      (await ctx.db.query("notifications").withIndex("by_recipient", (q) => q.eq("recipientId", profileId)).collect())
        .filter((n) => n.template === template),
    );
  }

  it("report → auto-freeze → admin restore closes the loop (audit + NTF-14)", async () => {
    const t = newTest();
    const { admin, subject, reporter } = await setup(t);
    // A "money" report freezes the subject immediately (PRD §5.8, P2).
    const out = await reporter.asUser.mutation(reportsCreate, {
      subjectId: subject.profileId, reason: "money" as const, block: false,
    });
    expect(out.autoAction).toBe("account_frozen");
    const frozen = await t.run(async (ctx) => await ctx.db.get(subject.profileId));
    expect(frozen!.status).toBe("frozen");

    const queue = await admin.asUser.query(moderationList, { status: "open" });
    expect(queue).toHaveLength(1);
    expect(queue[0].kind).toBe("money");
    expect(queue[0].autoAction).toBe("account_frozen");
    expect(queue[0].subjectName).toBe("Subject Person");
    // No phone number anywhere in the queue payload.
    expect(JSON.stringify(queue)).not.toContain("01712345678");

    const auditsBefore = await auditCount(t, "moderation_decided");
    await admin.asUser.mutation(moderationDecide, {
      itemId: queue[0].itemId, decision: "restore" as const,
      reason: "Verified with the hospital — genuine emergency, no money asked.",
    });
    const restored = await t.run(async (ctx) => await ctx.db.get(subject.profileId));
    expect(restored!.status).toBe("active");
    expect(await auditCount(t, "moderation_decided")).toBe(auditsBefore + 1);
    const notes = await notificationsTo(t, subject.profileId, "NTF-14");
    expect(notes.length).toBeGreaterThanOrEqual(1);
    const after = await admin.asUser.query(moderationList, { status: "decided" });
    expect(after).toHaveLength(1);
    expect(after[0].decision).toBe("restore");
  });

  it("every decision writes audit + notifies the subject (DoD matrix)", async () => {
    const t = newTest();
    const { admin, subject } = await setup(t);
    const decisions = [
      { decision: "dismiss" as const },
      { decision: "warn" as const },
      { decision: "suspend" as const, suspendDays: 7 },
      { decision: "ban" as const },
      { decision: "restore" as const },
    ];
    for (const d of decisions) {
      // Reset the subject to active before each decision.
      await t.run(async (ctx) => await ctx.db.patch(subject.profileId, { status: "active", statusUntil: undefined }));
      const itemId = await insertItem(t, { subjectId: subject.profileId });
      const auditsBefore = await auditCount(t, "moderation_decided");
      const notesBefore = (await notificationsTo(t, subject.profileId, "NTF-14")).length;
      await admin.asUser.mutation(moderationDecide, {
        itemId, ...d, reason: "Reviewed the evidence and the account history.",
      });
      expect(await auditCount(t, "moderation_decided")).toBe(auditsBefore + 1);
      expect((await notificationsTo(t, subject.profileId, "NTF-14")).length).toBe(notesBefore + 1);
      const item = await t.run(async (ctx) => await ctx.db.get(itemId));
      expect(item!.status).toBe("decided");
      expect(item!.decision).toBe(d.decision);
      expect(item!.decidedBy).toBe(admin.profileId);
    }
    // Suspend set a 7-day window; ban after it won in its own round.
    const finalProfile = await t.run(async (ctx) => await ctx.db.get(subject.profileId));
    expect(finalProfile!.status).toBe("active"); // last decision was restore
  });

  it("suspend sets statusUntil = now + days and takes the donor offline", async () => {
    const t = newTest();
    const { places, admin, subject } = await setup(t);
    const donorId = await insertDonor(t, places, subject.profileId, { live: true });
    const itemId = await insertItem(t, { subjectId: subject.profileId });
    await admin.asUser.mutation(moderationDecide, {
      itemId, decision: "suspend" as const, suspendDays: 7,
      reason: "Repeated no-shows after confirmation.",
    });
    const profile = await t.run(async (ctx) => await ctx.db.get(subject.profileId));
    expect(profile!.status).toBe("suspended");
    // Backend clock is monotonic (≥ the fake T0 by a few ms) — window check.
    expect(profile!.statusUntil).toBeGreaterThanOrEqual(T0 + 7 * DAY);
    expect(profile!.statusUntil).toBeLessThanOrEqual(T0 + 7 * DAY + 5_000);
    const donor = await t.run(async (ctx) => await ctx.db.get(donorId));
    expect(donor!.live).toBe(false);
  });

  it("hide_request hides + closes the request and notifies the requester", async () => {
    const t = newTest();
    const { places, admin, subject, reporter } = await setup(t);
    const requestId = await insertRequest(t, places, subject.profileId, { status: "live" });
    const itemId = await insertItem(t, { subjectId: subject.profileId, requestId, kind: "fake" });
    await admin.asUser.mutation(moderationDecide, {
      itemId, decision: "hide_request" as const,
      reason: "Duplicate of a request already covered elsewhere.",
    });
    const request = await t.run(async (ctx) => await ctx.db.get(requestId));
    expect(request!.hiddenByModerator).toBe(true);
    expect(request!.status).toBe("closed");
    expect(request!.closeReason).toBe("removed");
    expect((await notificationsTo(t, subject.profileId, "NTF-14")).length).toBe(1);
    // The detail view shows the request without any phone number.
    const detail = await admin.asUser.query(moderationGet, { itemId });
    expect(detail.request?.status).toBe("closed");
    expect(JSON.stringify(detail)).not.toContain("01712345678");
    expect(detail.subjectHistory?.reportsAbout).toBe(0);
    void reporter;
  });

  it("validation: reason required, suspend needs 1–30 days, decided items are final", async () => {
    const t = newTest();
    const { admin, subject } = await setup(t);
    const itemId = await insertItem(t, { subjectId: subject.profileId });
    expect(await codeOf(admin.asUser.mutation(moderationDecide, {
      itemId, decision: "warn" as const, reason: "no",
    }))).toBe("ERR_VALIDATION");
    expect(await codeOf(admin.asUser.mutation(moderationDecide, {
      itemId, decision: "suspend" as const, reason: "A proper reason for this.",
    }))).toBe("ERR_VALIDATION");
    expect(await codeOf(admin.asUser.mutation(moderationDecide, {
      itemId, decision: "suspend" as const, suspendDays: 31, reason: "A proper reason for this.",
    }))).toBe("ERR_VALIDATION");
    await admin.asUser.mutation(moderationDecide, {
      itemId, decision: "warn" as const, reason: "First warning for the fake request.",
    });
    expect(await codeOf(admin.asUser.mutation(moderationDecide, {
      itemId, decision: "warn" as const, reason: "Trying to decide it twice over.",
    }))).toBe("ERR_VALIDATION");
  });

  it("negative: members/volunteers are refused; practice items are invisible to real admins", async () => {
    const t = newTest();
    const { admin, subject, reporter } = await setup(t);
    const itemId = await insertItem(t, { subjectId: subject.profileId });
    const practiceItemId = await insertItem(t, { subjectId: subject.profileId, isDemo: true });
    expect(await codeOf(reporter.asUser.query(moderationList, { status: "open" }))).toBe("ERR_FORBIDDEN");
    expect(await codeOf(reporter.asUser.query(moderationGet, { itemId }))).toBe("ERR_FORBIDDEN");
    expect(await codeOf(reporter.asUser.mutation(moderationDecide, {
      itemId, decision: "warn" as const, reason: "A member cannot decide this.",
    }))).toBe("ERR_FORBIDDEN");
    const queue = await admin.asUser.query(moderationList, { status: "all" });
    expect(queue.map((q: { itemId: unknown }) => q.itemId)).toEqual([itemId]);
    expect(await codeOf(admin.asUser.query(moderationGet, { itemId: practiceItemId }))).toBe("ERR_NOT_FOUND");
    expect(await codeOf(admin.asUser.mutation(moderationDecide, {
      itemId: practiceItemId, decision: "warn" as const, reason: "Crossing the practice wall.",
    }))).toBe("ERR_NOT_FOUND");
  });

  it("queue ordering: open first by severity then age", async () => {
    const t = newTest();
    const { admin, subject } = await setup(t);
    const low = await insertItem(t, { subjectId: subject.profileId, severity: "low", kind: "other" });
    const high = await insertItem(t, { subjectId: subject.profileId, severity: "high", kind: "money" });
    const medium = await insertItem(t, { subjectId: subject.profileId, severity: "medium", kind: "harassment" });
    const queue = await admin.asUser.query(moderationList, { status: "open" });
    expect(queue.map((q: { itemId: unknown }) => q.itemId)).toEqual([high, medium, low]);
  });
});

const auditList = makeFunctionReference<"query">("admin/audit:list");
const settingsList = makeFunctionReference<"query">("admin/settings:list");
const peopleSetStatus = makeFunctionReference<"mutation">("admin/people:setStatus");

// ─────────────────────────────────────────────────────────────────────
// Slice 3 — audit viewer (F-804) + settings read-only (F-904 core).
// ─────────────────────────────────────────────────────────────────────

describe("P5 slice 3 — audit viewer + read-only settings", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  async function seedAudit(t: Test) {
    await t.mutation(seedSettings, {});
    const admin = await insertProfile(t, { name: "Admin A", role: "admin" });
    const other = await insertProfile(t, { name: "Admin B", role: "admin" });
    const member = await insertProfile(t, { name: "Member" });
    const practiceAdmin = await insertProfile(t, { name: "Practice Admin", role: "admin", isDemo: true });
    // Real audit rows from a real admin action (status_changed ×1).
    await admin.asUser.mutation(peopleSetStatus, {
      profileId: member.profileId, status: "frozen" as const,
      reason: "Suspicious sign-up pattern under review.",
    });
    // Direct rows for filter/pagination coverage.
    await t.run(async (ctx) => {
      const rows = [
        { actorId: admin.profileId, actorRole: "admin", action: "role_changed", targetType: "profiles", targetId: member.profileId, reason: "r1" },
        { actorId: other.profileId, actorRole: "admin", action: "role_changed", targetType: "profiles", targetId: member.profileId, reason: "r2" },
        { actorId: other.profileId, actorRole: "admin", action: "setting_changed", targetType: "settings", targetId: "donorAlertCapPerDay", reason: "r3" },
        { actorRole: "system", action: "account_frozen_auto", targetType: "profiles", targetId: member.profileId, reason: "report:money" },
        { actorId: practiceAdmin.profileId, actorRole: "admin", action: "role_changed", targetType: "profiles", targetId: member.profileId, reason: "practice row" },
      ];
      for (const row of rows) await ctx.db.insert("auditLog", row);
    });
    return { admin, other, member, practiceAdmin };
  }

  it("lists newest first with actor names; system rows included", async () => {
    const t = newTest();
    const { admin } = await seedAudit(t);
    const res = await admin.asUser.query(auditList, { paginationOpts: { numItems: 50, cursor: null } });
    // 5 visible rows (the practice admin's row is behind the wall).
    expect(res.page).toHaveLength(5);
    expect(res.page.map((r: { action: string }) => r.action)).toContain("status_changed");
    expect(res.page.map((r: { action: string }) => r.action)).toContain("account_frozen_auto");
    const roleRow = res.page.find((r: { reason: string | null }) => r.reason === "r1") as { actorName: string };
    expect(roleRow.actorName).toBe("Admin A");
    expect(JSON.stringify(res)).not.toContain("01712345678");
  });

  it("filters by action, actor and date range", async () => {
    const t = newTest();
    const { admin, other } = await seedAudit(t);
    const byAction = await admin.asUser.query(auditList, {
      action: "role_changed", paginationOpts: { numItems: 50, cursor: null },
    });
    expect(byAction.page).toHaveLength(2); // practice row hidden
    const byActor = await admin.asUser.query(auditList, {
      actorId: other.profileId, paginationOpts: { numItems: 50, cursor: null },
    });
    expect(byActor.page).toHaveLength(2);
    const future = await admin.asUser.query(auditList, {
      from: T0 + DAY, paginationOpts: { numItems: 50, cursor: null },
    });
    expect(future.page).toHaveLength(0);
    const upToNow = await admin.asUser.query(auditList, {
      to: T0 + DAY, paginationOpts: { numItems: 50, cursor: null },
    });
    expect(upToNow.page).toHaveLength(5);
  });

  it("paginates with cursors", async () => {
    const t = newTest();
    const { admin } = await seedAudit(t);
    const first = await admin.asUser.query(auditList, { paginationOpts: { numItems: 2, cursor: null } });
    expect(first.page).toHaveLength(2);
    expect(first.isDone).toBe(false);
    const second = await admin.asUser.query(auditList, {
      paginationOpts: { numItems: 2, cursor: first.continueCursor },
    });
    expect(second.page).toHaveLength(2);
    const ids = new Set([...first.page, ...second.page].map((r: { auditId: unknown }) => r.auditId));
    expect(ids.size).toBe(4);
  });

  it("audit viewer is read-only and admin-only (negative)", async () => {
    const t = newTest();
    await seedAudit(t);
    // A fresh member (seedAudit's member is frozen by the status action,
    // which would surface ERR_FROZEN before the role check).
    const fresh = await insertProfile(t, { name: "Fresh Member" });
    expect(await codeOf(fresh.asUser.query(auditList, { paginationOpts: { numItems: 5, cursor: null } })))
      .toBe("ERR_FORBIDDEN");
    // The audit module exports no mutation at all — nothing to call
    // to edit history. (admin/settings gained `update` in P7: F-904's
    // if-time part, switch-gated + audited — see tests/p7.test.ts.)
    expect(Object.keys(adminAuditModule)).toEqual(["list"]);
    expect(Object.keys(adminSettingsModule).sort()).toEqual(["list", "update"]);
  });

  it("settings list shows every def with value, range and ref; stored overrides win", async () => {
    const t = newTest();
    await t.mutation(seedSettings, {});
    const admin = await insertProfile(t, { name: "Admin", role: "admin" });
    const member = await insertProfile(t, { name: "Member" });
    const rows = await admin.asUser.query(settingsList, {}) as {
      key: string; value: unknown; range: [number, number] | null; ref: string; fixed: boolean;
    }[];
    expect(rows.length).toBeGreaterThanOrEqual(61);
    const cap = rows.find((r) => r.key === "donorAlertCapPerDay");
    expect(cap).toMatchObject({ value: 3, range: [1, 10], ref: "S-20" });
    const minAge = rows.find((r) => r.key === "minAge");
    expect(minAge).toMatchObject({ value: 18, fixed: true });
    // A stored row (as a future settings editor would write) is reflected.
    await t.run(async (ctx) => {
      const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", "donorAlertCapPerDay")).unique();
      await ctx.db.patch(row!._id, { value: 5 });
    });
    const after = await admin.asUser.query(settingsList, {}) as { key: string; value: unknown; isDefault: boolean }[];
    expect(after.find((r) => r.key === "donorAlertCapPerDay")).toMatchObject({ value: 5, isDefault: false });
    expect(await codeOf(member.asUser.query(settingsList, {}))).toBe("ERR_FORBIDDEN");
  });
});

const aiStatus = makeFunctionReference<"query">("admin/ai:status");
const aiSetFeature = makeFunctionReference<"mutation">("admin/ai:setFeature");
const aiLog = makeFunctionReference<"query">("admin/ai:log");
const usageGet = makeFunctionReference<"query">("admin/usage:get");
const usageSetManual = makeFunctionReference<"mutation">("admin/usage:setManualEntry");

// ─────────────────────────────────────────────────────────────────────
// Slice 4 — AI controls & log (F-902) + usage monitor (F-911).
// ─────────────────────────────────────────────────────────────────────

describe("P5 slice 4 — AI controls, log and usage monitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  async function setupAi(t: Test) {
    // One call on the PREVIOUS LA day must not count (T0 = 06:00Z is
    // 22:00 LA on Dec 4; 30h earlier is Dec 3 LA). It is inserted
    // FIRST: the convex-test backend clock is monotonic, so the
    // fixture is built in chronological order.
    vi.setSystemTime(T0 - 30 * HOUR);
    await t.run(async (ctx) => {
      await ctx.db.insert("aiCalls", { feature: "intake" as const, model: "gemini-lite-x", ok: true, inputRedacted: "old", output: "{}", latencyMs: 10, isDemo: false });
    });
    vi.setSystemTime(T0);
    await t.mutation(seedSettings, {});
    const admin = await insertProfile(t, { name: "Admin", role: "admin" });
    const member = await insertProfile(t, { name: "Member" });
    // Configure model names (as the human setup does) so calls match.
    await t.run(async (ctx) => {
      const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", "ai.models")).unique();
      await ctx.db.patch(row!._id, { value: { lite: "gemini-lite-x", flash: "gemini-flash-x" } });
      const calls = [
        { feature: "intake" as const, model: "gemini-lite-x", ok: true, inputRedacted: "need a+ blood at cmc", output: "{}", latencyMs: 10, isDemo: false },
        { feature: "intake" as const, model: "gemini-lite-x", ok: true, inputRedacted: "need o- at urology", output: "{}", latencyMs: 10, isDemo: false },
        { feature: "intake" as const, model: "gemini-lite-x", ok: false, errorKind: "quota_exceeded", inputRedacted: "need b+", output: "", latencyMs: 10, isDemo: false },
        { feature: "summary" as const, model: "gemini-lite-x", ok: true, inputRedacted: "summarise", output: "ok", latencyMs: 10, isDemo: false },
      ];
      for (const call of calls) await ctx.db.insert("aiCalls", call);
    });
    return { admin, member };
  }

  it("status: per-feature counts, failures, last error, quota usage", async () => {
    const t = newTest();
    const { admin } = await setupAi(t);
    const status = await admin.asUser.query(aiStatus, {}) as {
      features: { feature: string; enabled: boolean; callsToday: number; failuresToday: number; lastError: string | null }[];
      usage: { lite: { calls: number; limit: number; pct: number } };
      fallback80Active: boolean; unconfigured: boolean; retentionDays: number;
    };
    const intake = status.features.find((f) => f.feature === "intake");
    expect(intake).toMatchObject({ enabled: true, callsToday: 3, failuresToday: 1, lastError: "quota_exceeded" });
    expect(status.usage.lite).toMatchObject({ calls: 4, limit: 500 });
    expect(status.fallback80Active).toBe(false);
    expect(status.unconfigured).toBe(false);
    expect(status.retentionDays).toBe(30);
  });

  it("setFeature flips the same settings object P4 reads, with audit", async () => {
    const t = newTest();
    const { admin, member } = await setupAi(t);
    await admin.asUser.mutation(aiSetFeature, { feature: "intake", enabled: false });
    const status = await admin.asUser.query(aiStatus, {}) as { features: { feature: string; enabled: boolean }[] };
    expect(status.features.find((f) => f.feature === "intake")!.enabled).toBe(false);
    expect(status.features.find((f) => f.feature === "summary")!.enabled).toBe(true);
    const audits = await t.run(async (ctx) =>
      await ctx.db.query("auditLog").withIndex("by_action", (q) => q.eq("action", "ai_feature_changed")).collect());
    expect(audits).toHaveLength(1);
    expect(await codeOf(admin.asUser.mutation(aiSetFeature, { feature: "nope", enabled: true }))).toBe("ERR_VALIDATION");
    expect(await codeOf(member.asUser.mutation(aiSetFeature, { feature: "intake", enabled: true }))).toBe("ERR_FORBIDDEN");
    expect(await codeOf(member.asUser.query(aiStatus, {}))).toBe("ERR_FORBIDDEN");
  });

  it("log shows redacted previews, newest first, truncated at 200 chars", async () => {
    const t = newTest();
    const { admin, member } = await setupAi(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("aiCalls", {
        feature: "intake", model: "gemini-lite-x", ok: true,
        inputRedacted: "x".repeat(250), output: "y".repeat(250), latencyMs: 10, isDemo: false,
      });
    });
    const res = await admin.asUser.query(aiLog, { paginationOpts: { numItems: 2, cursor: null } }) as {
      page: { inputPreview: string; outputPreview: string | null }[]; isDone: boolean;
    };
    expect(res.page[0].inputPreview).toHaveLength(200);
    expect(res.page[0].outputPreview).toHaveLength(200);
    expect(res.isDone).toBe(false);
    expect(await codeOf(member.asUser.query(aiLog, { paginationOpts: { numItems: 2, cursor: null } }))).toBe("ERR_FORBIDDEN");
  });

  it("usage monitor: measured rows, S-30 warning bands, manual entries", async () => {
    const t = newTest();
    const { admin, member } = await setupAi(t);
    // A slip file of known size in storage.
    const slipId = await t.run(async (ctx) => await ctx.storage.store(new Blob(["1234567890"])));
    const places = await seedPlaces(t);
    const requester = await insertProfile(t, { name: "Requester" });
    const requestId = await insertRequest(t, places, requester.profileId, {});
    await t.run(async (ctx) => await ctx.db.patch(requestId, { slipFileId: slipId }));

    const before = await admin.asUser.query(usageGet, {}) as {
      rows: { service: string; used: number | null; status: string | null; source: string; dashboardUrl: string | null }[];
      warnPct: number; criticalPct: number; degradationOrder: string[]; corePathProtected: boolean;
    };
    expect(before.warnPct).toBe(70);
    expect(before.criticalPct).toBe(90);
    expect(before.corePathProtected).toBe(true);
    expect(before.degradationOrder).toEqual(["ai-extras", "images", "non-essential-pages"]);
    const byService = Object.fromEntries(before.rows.map((r) => [r.service, r]));
    expect(byService["gemini-lite"]).toMatchObject({ used: 4, status: "ok", source: "measured" });
    expect(byService["slip-storage"].used).toBe(10);
    expect(byService["eas-updates"]).toMatchObject({ used: null, source: "dashboard" });
    expect(byService["eas-updates"].dashboardUrl).toBe("https://expo.dev");

    // Manual entries: EAS at 85% → warn; Convex at 95% → critical.
    await admin.asUser.mutation(usageSetManual, { service: "eas", metric: "mau", value: 850 });
    await admin.asUser.mutation(usageSetManual, { service: "convex", metric: "functionCalls", value: 950_000 });
    const after = await admin.asUser.query(usageGet, {}) as {
      rows: { service: string; used: number | null; status: string | null; source: string }[];
    };
    const afterBy = Object.fromEntries(after.rows.map((r) => [r.service, r]));
    expect(afterBy["eas-updates"]).toMatchObject({ used: 850, status: "warn", source: "manual" });
    expect(afterBy["convex-functions"]).toMatchObject({ used: 950_000, status: "critical", source: "manual" });
    const audits = await t.run(async (ctx) =>
      await ctx.db.query("auditLog").withIndex("by_action", (q) => q.eq("action", "usage_manual_entry")).collect());
    expect(audits).toHaveLength(2);
    expect(await codeOf(member.asUser.query(usageGet, {}))).toBe("ERR_FORBIDDEN");
    expect(await codeOf(member.asUser.mutation(usageSetManual, { service: "eas", metric: "mau", value: 1 })))
      .toBe("ERR_FORBIDDEN");
    expect(await codeOf(admin.asUser.mutation(usageSetManual, { service: "eas", metric: "mau", value: -5 })))
      .toBe("ERR_VALIDATION");
  });
});

const demoStatus = makeFunctionReference<"query">("admin/demo:status");
const demoSetEnabled = makeFunctionReference<"mutation">("admin/demo:setEnabled");
const demoReset = makeFunctionReference<"mutation">("admin/demo:reset");
const demoPrepare = makeFunctionReference<"mutation">("admin/demo:preparePracticeAccount");
const demoLink = makeFunctionReference<"mutation">("admin/demo:linkPracticeAccount");
const demoGateCheck = makeFunctionReference<"query">("admin/demo:gateCheck");
const demoGateAttempt = makeFunctionReference<"mutation">("admin/demo:gateAttempt");
const demoGateSuccess = makeFunctionReference<"mutation">("admin/demo:gateSuccess");
const demoCreateAccount = makeFunctionReference<"action">("admin/demo:createAccount");
const onCreateAuthUser = makeFunctionReference<"mutation">("auth:onCreateAuthUser");
const requestsCreate = makeFunctionReference<"mutation">("requests:create");

// ─────────────────────────────────────────────────────────────────────
// Slice 5 — practice area (F-912, D-R4). Phase DoD: practice data
// never leaks into real numbers/matching; reset deletes ONLY
// practice rows; the sign-in gate locks after 5 attempts.
// ─────────────────────────────────────────────────────────────────────

describe("P5 slice 5 — practice area backend (F-912)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  async function setup(t: Test) {
    await t.mutation(seedSettings, {});
    const places = await seedPlaces(t);
    const superadmin = await insertProfile(t, { name: "Super Admin", role: "superadmin" });
    const admin = await insertProfile(t, { name: "Admin", role: "admin" });
    const member = await insertProfile(t, { name: "Member" });
    return { places, superadmin, admin, member };
  }

  it("prepare creates accounts + practice hospital; status lists them", async () => {
    const t = newTest();
    const { superadmin, admin, member } = await setup(t);
    const a = await t.mutation(demoPrepare, {
      actorId: superadmin.profileId, name: "Judge One", role: "member" as const, donorGroup: "A+",
    }) as { profileId: Id<"profiles">; practiceId: string };
    const b = await t.mutation(demoPrepare, {
      actorId: superadmin.profileId, name: "Judge Two", role: "volunteer" as const,
    }) as { profileId: Id<"profiles">; practiceId: string };
    expect(a.practiceId).toBe("P-01");
    expect(b.practiceId).toBe("P-02");

    const status = await admin.asUser.query(demoStatus, {}) as {
      enabled: boolean;
      accounts: { practiceId: string; donorGroup: string | null; phoneStatus: string; role: string }[];
      hospital: { nameEn: string } | null;
      funnel: { published: number };
    };
    expect(status.enabled).toBe(false);
    expect(status.accounts.map((x) => x.practiceId)).toEqual(["P-01", "P-02"]);
    expect(status.accounts[0]).toMatchObject({ donorGroup: "A+", phoneStatus: "not_signed_in", role: "member" });
    expect(status.accounts[1].donorGroup).toBeNull();
    expect(status.hospital?.nameEn).toBe("UDVASITO Practice Hospital");
    expect(status.funnel.published).toBe(0);

    const hospital = await t.run(async (ctx) =>
      (await ctx.db.query("hospitals").collect()).find((h) => h.isDemo));
    expect(hospital).toBeDefined();
    // Starter donor row exists but is NOT live (no verified phone yet).
    const donor = await t.run(async (ctx) =>
      await ctx.db.query("donorProfiles").withIndex("by_profile", (q) => q.eq("profileId", a.profileId)).unique());
    expect(donor).toMatchObject({ bloodGroup: "A+", live: false, isDemo: true });

    const audits = await t.run(async (ctx) =>
      await ctx.db.query("auditLog").withIndex("by_action", (q) => q.eq("action", "demo_account_created")).collect());
    expect(audits).toHaveLength(2);
    // Only a superadmin may prepare accounts; members can't even view.
    expect(await codeOf(t.mutation(demoPrepare, {
      actorId: admin.profileId, name: "Nope Nope", role: "member" as const,
    }))).toBe("ERR_FORBIDDEN");
    expect(await codeOf(member.asUser.query(demoStatus, {}))).toBe("ERR_FORBIDDEN");
    expect(await codeOf(member.asUser.mutation(demoSetEnabled, { enabled: true }))).toBe("ERR_FORBIDDEN");
    expect(await codeOf(member.asUser.mutation(demoReset, {}))).toBe("ERR_FORBIDDEN");
  });

  it("the 11th practice account is refused (max 10, SCR-A09)", async () => {
    const t = newTest();
    const { superadmin } = await setup(t);
    for (let i = 1; i <= 10; i++) {
      await t.mutation(demoPrepare, {
        actorId: superadmin.profileId, name: `Person ${i}`, role: "member" as const,
      });
    }
    expect(await codeOf(t.mutation(demoPrepare, {
      actorId: superadmin.profileId, name: "Person Eleven", role: "member" as const,
    }))).toBe("ERR_VALIDATION");
  });

  it("onCreateAuthUser links a prepared profile; other emails are untouched", async () => {
    const t = newTest();
    const { superadmin } = await setup(t);
    const a = await t.mutation(demoPrepare, {
      actorId: superadmin.profileId, name: "Link Me", role: "member" as const,
    }) as { profileId: Id<"profiles">; practiceId: string };
    await t.mutation(onCreateAuthUser, { doc: { _id: "auth-user-1", email: "someone@gmail.com" } });
    let profile = await t.run(async (ctx) => await ctx.db.get(a.profileId));
    expect(profile!.authUserId).toBe("practice:P-01");
    await t.mutation(onCreateAuthUser, { doc: { _id: "auth-user-9", email: "p-01@practice.udvasito.invalid" } });
    profile = await t.run(async (ctx) => await ctx.db.get(a.profileId));
    expect(profile!.authUserId).toBe("auth-user-9");
    // The action-side link is idempotent with the hook link.
    await t.mutation(demoLink, { profileId: a.profileId, authUserId: "auth-user-9" });
    profile = await t.run(async (ctx) => await ctx.db.get(a.profileId));
    expect(profile!.authUserId).toBe("auth-user-9");
  });

  it("sign-in gate: disabled area, 5 attempts lock, success resets (D-R4)", async () => {
    const t = newTest();
    const { superadmin, admin } = await setup(t);
    await t.mutation(demoPrepare, {
      actorId: superadmin.profileId, name: "Gate Keeper", role: "member" as const,
    });
    type Gate = { exists: boolean; enabled: boolean; locked: boolean; attempts: number };
    let gate = (await t.query(demoGateCheck, { practiceId: "P-01" })) as Gate;
    expect(gate).toMatchObject({ exists: true, enabled: false, locked: false });
    gate = (await t.query(demoGateCheck, { practiceId: "P-09" })) as Gate;
    expect(gate.exists).toBe(false);

    await admin.asUser.mutation(demoSetEnabled, { enabled: true });
    gate = (await t.query(demoGateCheck, { practiceId: "P-01" })) as Gate;
    expect(gate).toMatchObject({ enabled: true, locked: false });
    for (let i = 0; i < 4; i++) await t.mutation(demoGateAttempt, { practiceId: "P-01" });
    gate = (await t.query(demoGateCheck, { practiceId: "P-01" })) as Gate;
    expect(gate).toMatchObject({ locked: false, attempts: 4 });
    await t.mutation(demoGateAttempt, { practiceId: "P-01" });
    gate = (await t.query(demoGateCheck, { practiceId: "P-01" })) as Gate;
    expect(gate.locked).toBe(true);
    // A success (the right PIN got through before the lock, or an admin
    // reset) clears the counter.
    await t.mutation(demoGateSuccess, { practiceId: "P-01" });
    gate = (await t.query(demoGateCheck, { practiceId: "P-01" })) as Gate;
    expect(gate).toMatchObject({ locked: false, attempts: 0 });
    // Disabling is audited as a setting change.
    await admin.asUser.mutation(demoSetEnabled, { enabled: false });
    const audits = await t.run(async (ctx) =>
      await ctx.db.query("auditLog").withIndex("by_action", (q) => q.eq("action", "setting_changed")).collect());
    expect(audits.filter((x) => x.targetId === "demoAreaEnabled")).toHaveLength(2);
  });

  it("reset deletes ONLY practice rows; accounts and hospital survive (DoD)", async () => {
    const t = newTest();
    const { places, superadmin, admin } = await setup(t);
    const a = await t.mutation(demoPrepare, {
      actorId: superadmin.profileId, name: "Reset Person", role: "member" as const,
    }) as { profileId: Id<"profiles"> };
    const real = await insertProfile(t, { name: "Real Person" });
    const practiceRequest = await insertRequest(t, places, a.profileId, { isDemo: true });
    const realRequest = await insertRequest(t, places, real.profileId, {});
    const aDonor = await insertDonor(t, places, a.profileId, { isDemo: true });
    const realDonorRow = await insertDonor(t, places, real.profileId, {});
    await insertResponse(t, practiceRequest, a.profileId, aDonor, { notifiedAt: T0, isDemo: true });
    await insertResponse(t, realRequest, real.profileId, realDonorRow, { notifiedAt: T0 });
    await t.run(async (ctx) => {
      await ctx.db.insert("notifications", {
        recipientId: a.profileId, template: "NTF-01", channel: "inapp", status: "sent", isDemo: true,
      });
      await ctx.db.insert("notifications", {
        recipientId: real.profileId, template: "NTF-01", channel: "inapp", status: "sent", isDemo: false,
      });
      await ctx.db.insert("contactReveals", {
        requestId: practiceRequest, viewerId: a.profileId, subjectId: a.profileId,
        subjectRole: "donor", reason: "confirmed_slot", expiresAt: T0 + HOUR, isDemo: true,
      });
      await ctx.db.insert("contactReveals", {
        requestId: realRequest, viewerId: real.profileId, subjectId: real.profileId,
        subjectRole: "donor", reason: "confirmed_slot", expiresAt: T0 + HOUR, isDemo: false,
      });
      await ctx.db.insert("events", { name: "request_created", requestId: practiceRequest, isDemo: true });
      await ctx.db.insert("events", { name: "request_created", requestId: realRequest, isDemo: false });
    });

    const counts = await admin.asUser.mutation(demoReset, {}) as Record<string, number>;
    expect(counts).toEqual({ requests: 1, responses: 1, notifications: 1, contactReveals: 1, events: 1 });
    const remaining = await t.run(async (ctx) => ({
      requests: await ctx.db.query("requests").collect(),
      profiles: await ctx.db.query("profiles").collect(),
      hospitals: await ctx.db.query("hospitals").collect(),
    }));
    expect(remaining.requests.map((r) => r._id)).toEqual([realRequest]);
    expect(remaining.profiles.some((p) => p._id === a.profileId)).toBe(true); // account kept
    expect(remaining.hospitals.some((h) => h.isDemo)).toBe(true); // hospital kept
    const audits = await t.run(async (ctx) =>
      await ctx.db.query("auditLog").withIndex("by_action", (q) => q.eq("action", "demo_reset")).collect());
    expect(audits).toHaveLength(1);
  });

  it("end-to-end isolation: practice request matches ONLY practice donors (DoD)", async () => {
    const t = newTest();
    const { places, superadmin, admin } = await setup(t);
    const requesterPrep = await t.mutation(demoPrepare, {
      actorId: superadmin.profileId, name: "Practice Requester", role: "member" as const,
    }) as { profileId: Id<"profiles"> };
    const donorPrep = await t.mutation(demoPrepare, {
      actorId: superadmin.profileId, name: "Practice Donor", role: "member" as const, donorGroup: "A+",
    }) as { profileId: Id<"profiles"> };
    await t.mutation(demoLink, { profileId: requesterPrep.profileId, authUserId: "auth-practice-requester" });
    await t.mutation(demoLink, { profileId: donorPrep.profileId, authUserId: "auth-practice-donor" });
    // Simulate completed onboarding + phone verification (the practice
    // member signed in with a REAL phone): profile patched, donor live.
    await t.run(async (ctx) => {
      await ctx.db.patch(requesterPrep.profileId, { phone: "+8801712345678", phoneVerified: true });
      await ctx.db.patch(donorPrep.profileId, { phone: "+8801812345678", phoneVerified: true });
      const donor = await ctx.db.query("donorProfiles").withIndex("by_profile", (q) => q.eq("profileId", donorPrep.profileId)).unique();
      await ctx.db.patch(donor!._id, { live: true });
    });
    // A real live donor in the same district must never be matched.
    const realDonorProfile = await insertProfile(t, { name: "Real Donor" });
    await insertDonor(t, places, realDonorProfile.profileId, { bloodGroup: "A+", live: true });

    const status = await admin.asUser.query(demoStatus, {}) as { hospital: { hospitalId: Id<"hospitals"> } | null };
    const asRequester = t.withIdentity({ subject: "auth-practice-requester" });
    const created = await asRequester.mutation(requestsCreate, {
      clientId: "practice-req-1",
      bloodGroup: "A+" as const,
      component: "whole_blood" as const,
      isDengue: false,
      unitsNeeded: 1,
      hospitalId: status.hospital!.hospitalId,
      divisionId: places.divisionId,
      districtId: places.districtId,
      upazilaId: places.upazilaId,
      neededBy: T0 + HOUR,
      contactPhone: "01712345678",
      source: "form" as const,
      aiAssisted: false,
      lang: "en" as const,
    }) as { requestId: Id<"requests"> };
    // convex-test fires a scheduled job only once the fake clock moves
    // past its due time — advance 1 ms so the runAfter(0) matching
    // start becomes due (same pattern as tests/p2.test.ts advance()).
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();

    const responses = await t.run(async (ctx) =>
      await ctx.db.query("responses").withIndex("by_request_state", (q) => q.eq("requestId", created.requestId)).collect());
    expect(responses.length).toBeGreaterThanOrEqual(1);
    expect(responses.every((r) => r.isDemo)).toBe(true);
    expect(responses.map((r) => r.donorId)).toContain(donorPrep.profileId);
    expect(responses.map((r) => r.donorId)).not.toContain(realDonorProfile.profileId);

    // Real numbers never see it; the practice funnel does.
    await t.mutation(computeSnapshots, {});
    const pub = await t.query(getPublicSnapshot, {}) as { data: { donorsLive: number; requestsHelped: number } } | null;
    expect(pub?.data.donorsLive).toBe(1); // only the real donor — the live practice donor is excluded
    expect(pub?.data.requestsHelped).toBe(0);
    const snap = await admin.asUser.query(dashboard, {}) as { data: { funnel: { published: number } } } | null;
    expect(snap?.data.funnel.published).toBe(0);
    const demoAfter = await admin.asUser.query(demoStatus, {}) as { funnel: { published: number } };
    expect(demoAfter.funnel.published).toBe(1);

    // The wall also holds the other way: a real member cannot use the
    // practice hospital, and the practice requester cannot use a real one.
    const realHospital = await t.run(async (ctx) =>
      await ctx.db.insert("hospitals", {
        nameEn: "Real Hospital", nameBn: "Real", aliases: [], searchText: "real hospital",
        type: "hospital", divisionId: places.divisionId, districtId: places.districtId,
        upazilaId: places.upazilaId, lat: 22.35, lng: 91.8, active: true, isDemo: false,
      }));
    const realMember = await insertProfile(t, { name: "Real Member" });
    expect(await codeOf(realMember.asUser.mutation(requestsCreate, {
      clientId: "real-req-x", bloodGroup: "A+" as const, component: "whole_blood" as const,
      isDengue: false, unitsNeeded: 1, hospitalId: status.hospital!.hospitalId,
      divisionId: places.divisionId, districtId: places.districtId, upazilaId: places.upazilaId,
      neededBy: T0 + HOUR, contactPhone: "01712345678", source: "form" as const,
      aiAssisted: false, lang: "en" as const,
    }))).toBe("ERR_NOT_FOUND");
    expect(await codeOf(asRequester.mutation(requestsCreate, {
      clientId: "practice-req-2", bloodGroup: "A+" as const, component: "whole_blood" as const,
      isDengue: false, unitsNeeded: 1, hospitalId: realHospital,
      divisionId: places.divisionId, districtId: places.districtId, upazilaId: places.upazilaId,
      neededBy: T0 + HOUR, contactPhone: "01712345678", source: "form" as const,
      aiAssisted: false, lang: "en" as const,
    }))).toBe("ERR_NOT_FOUND");
  });

  it("createAccount action: superadmin-only, honest failure without email env", async () => {
    const t = newTest();
    const { admin, superadmin } = await setup(t);
    // An admin (not superadmin) is refused before anything else.
    expect(await codeOf(admin.asUser.action(demoCreateAccount, {
      name: "Nope", role: "member" as const,
    }))).toBe("ERR_FORBIDDEN");
    // A superadmin gets the honest ERR_METHOD_DISABLED while
    // BETTER_AUTH_EMAIL_ENABLED is unset in this environment — the
    // Better Auth user lifecycle itself is a human-step verification
    // (the component is not registered in the test harness).
    expect(await codeOf(superadmin.asUser.action(demoCreateAccount, {
      name: "Judge", role: "member" as const,
    }))).toBe("ERR_METHOD_DISABLED");
    // Nothing was prepared by the refused attempts.
    const practice = await t.run(async (ctx) =>
      await ctx.db.query("profiles").filter((q) => q.eq(q.field("isDemo"), true)).collect());
    expect(practice).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Slice 7 — GET /public/stats (specs §6.5): anonymised aggregates,
// practice excluded, Cache-Control: public, max-age=300.
// ─────────────────────────────────────────────────────────────────────

describe("P5 slice 7 — GET /public/stats", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  it("serves the §6.5 shape with the cache header; practice excluded; self-heals before the first cron run", async () => {
    const t = newTest();
    await t.mutation(seedSettings, {});
    const places = await seedPlaces(t);
    const realDonor = await insertProfile(t, { name: "Real Donor" });
    await insertDonor(t, places, realDonor.profileId, { bloodGroup: "A+", live: true });
    const practiceDonor = await insertProfile(t, { name: "Practice Donor", isDemo: true });
    await insertDonor(t, places, practiceDonor.profileId, { bloodGroup: "A+", live: true, isDemo: true });
    const helped = await insertProfile(t, { name: "Helped Requester" });
    await insertRequest(t, places, helped.profileId, { status: "closed", closeReason: "fulfilled" });
    await insertRequest(t, places, practiceDonor.profileId, { status: "closed", closeReason: "fulfilled", isDemo: true });

    // No compute has run yet — the endpoint computes once, then serves.
    const res = await t.fetch("/public/stats");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const body = await res.json() as {
      donorsByGroup: Record<string, number>; donorsLive: number;
      requestsHelped: number; donationsConfirmed: number; updatedAt: number;
    };
    expect(body.donorsLive).toBe(1);
    expect(body.donorsByGroup["A+"]).toBe(1);
    expect(body.requestsHelped).toBe(1); // the practice "helped" request is excluded
    expect(body.donationsConfirmed).toBe(0);
    expect(body.updatedAt).toBeGreaterThanOrEqual(T0);
    // Exactly the §6.5 keys — nothing else leaks.
    expect(Object.keys(body).sort()).toEqual([
      "donationsConfirmed", "donorsByGroup", "donorsLive", "requestsHelped", "updatedAt",
    ]);

    // Second hit serves the stored snapshot with identical numbers.
    const again = await t.fetch("/public/stats");
    const againBody = await again.json() as typeof body;
    expect(againBody.donorsLive).toBe(1);
    expect(againBody.requestsHelped).toBe(1);
  });
});
