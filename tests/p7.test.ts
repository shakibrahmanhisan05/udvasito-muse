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
import * as adminDirectoryModule from "../convex/admin/directory";
import * as adminFaqModule from "../convex/admin/faq";
import * as adminDataModule from "../convex/admin/data";
import * as adminSummaryModule from "../convex/admin/summary";
import * as adminAiModule from "../convex/admin/ai";
import * as adminUsageModule from "../convex/admin/usage";
import * as adminDemoModule from "../convex/admin/demo";
import * as authModule from "../convex/auth";
import * as publicModule from "../convex/public";
import * as shareModule from "../convex/share";
import * as campaignsModule from "../convex/campaigns";
import * as assistantModule from "../convex/assistant";
import * as slipsModule from "../convex/slips";
import * as remindersModule from "../convex/reminders";
import * as supportModule from "../convex/support";
import * as notificationsModule from "../convex/notifications";
import httpModule from "../convex/http";

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
  "../convex/admin/directory.ts": async () => adminDirectoryModule,
  "../convex/admin/faq.ts": async () => adminFaqModule,
  "../convex/admin/data.ts": async () => adminDataModule,
  "../convex/admin/summary.ts": async () => adminSummaryModule,
  "../convex/admin/ai.ts": async () => adminAiModule,
  "../convex/admin/usage.ts": async () => adminUsageModule,
  "../convex/admin/demo.ts": async () => adminDemoModule,
  "../convex/auth.ts": async () => authModule,
  "../convex/public.ts": async () => publicModule,
  "../convex/share.ts": async () => shareModule,
  "../convex/campaigns.ts": async () => campaignsModule,
  "../convex/assistant.ts": async () => assistantModule,
  "../convex/slips.ts": async () => slipsModule,
  "../convex/reminders.ts": async () => remindersModule,
  "../convex/support.ts": async () => supportModule,
  "../convex/notifications.ts": async () => notificationsModule,
  "../convex/http.ts": async () => ({ default: httpModule }),
};

const seedSettings = makeFunctionReference<"mutation">("seed:seedSettings");
const profilesMe = makeFunctionReference<"query">("profiles:me");
const acceptConsent = makeFunctionReference<"mutation">("consents:accept");
const moderationList = makeFunctionReference<"query">("admin/moderation:list");
const moderationDecide = makeFunctionReference<"mutation">("admin/moderation:decide");
const reportsCreate = makeFunctionReference<"mutation">("reports:create");

// 2026-12-07 12:00 Asia/Dhaka (06:00 UTC), a Monday.
export const T0 = Date.parse("2026-12-07T06:00:00.000Z");
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

let placeSeq = 0;
export async function seedPlaces(t: Test) {
  return await t.run(async (ctx) => {
    placeSeq += 1;
    const divisionId = await ctx.db.insert("places", {
      level: "division", code: `DIV7-${placeSeq}`, nameEn: "Chattogram", nameBn: "চট্টগ্রাম",
      lat: 22.35, lng: 91.8, isMetroThana: false, neighbourIds: [],
    });
    const districtId = await ctx.db.insert("places", {
      level: "district", code: `DIS7-${placeSeq}`, nameEn: "Chattogram", nameBn: "চট্টগ্রাম",
      parentId: divisionId, lat: 22.35, lng: 91.8, isMetroThana: false, neighbourIds: [],
    });
    const upazilaId = await ctx.db.insert("places", {
      level: "upazila", code: `UPA7-${placeSeq}`, nameEn: "Kotwali", nameBn: "কোতোয়ালী",
      parentId: districtId, lat: 22.36, lng: 91.83, isMetroThana: true, neighbourIds: [],
    });
    return { divisionId, districtId, upazilaId };
  });
}
export type Places = Awaited<ReturnType<typeof seedPlaces>>;

let userSeq = 0;
export async function insertProfile(
  t: Test,
  opts: {
    name?: string;
    role?: "member" | "volunteer" | "admin" | "superadmin";
    status?: "active" | "frozen" | "suspended" | "banned";
    isDemo?: boolean;
    phone?: string;
    phoneVerified?: boolean;
    consentVersion?: string;
  } = {},
) {
  userSeq += 1;
  const authUserId = `p7-user-${userSeq}`;
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
      consentVersion: opts.consentVersion ?? "2026-11-28-pilot",
      lastActiveAt: Date.now(),
      isDemo: opts.isDemo ?? false,
    }),
  );
  return { profileId, authUserId, asUser: t.withIdentity({ subject: authUserId }) };
}

export async function insertDonor(
  t: Test,
  places: Places,
  profileId: Id<"profiles">,
  opts: { live?: boolean; isDemo?: boolean } = {},
) {
  return await t.run(async (ctx) =>
    await ctx.db.insert("donorProfiles", {
      profileId,
      bloodGroup: "A+" as never,
      gender: "unspecified",
      divisionId: places.divisionId,
      districtId: places.districtId,
      upazilaId: places.upazilaId,
      travelRange: "district",
      neverDonated: true,
      plateletOptIn: false,
      availability: "available",
      availabilityConfirmedAt: Date.now(),
      eligibleFrom: 0,
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
  opts: { status?: "live" | "covered" | "closed"; isDemo?: boolean } = {},
) {
  return await t.run(async (ctx) =>
    await ctx.db.insert("requests", {
      requesterId,
      source: "form",
      clientId: `client7-${Math.random().toString(36).slice(2)}`,
      bloodGroup: "B+" as never,
      component: "whole_blood",
      isDengue: false,
      unitsNeeded: 2,
      unitsConfirmed: 0,
      divisionId: places.divisionId,
      districtId: places.districtId,
      upazilaId: places.upazilaId,
      approxLat: 22.36,
      approxLng: 91.83,
      neededBy: Date.now() + 6 * HOUR,
      urgency: "today",
      contactPhone: "01712345678",
      contactPhoneVerified: true,
      lang: "en",
      publicSlug: `slug7-${Math.random().toString(36).slice(2, 12)}`,
      status: opts.status ?? "live",
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

async function auditRows(t: Test, action: string) {
  return await t.run(async (ctx) =>
    await ctx.db.query("auditLog").withIndex("by_action", (q) => q.eq("action", action)).collect(),
  );
}
async function notificationsTo(t: Test, profileId: Id<"profiles">, template: string) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("notifications").withIndex("by_recipient", (q) => q.eq("recipientId", profileId)).collect())
      .filter((n) => n.template === template),
  );
}
async function decidedEvents(t: Test) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("events").collect()).filter((e) => e.name === "moderation_decided"),
  );
}

const checkDuplicateRef = makeFunctionReference<"query">("requests:checkDuplicate");
const suggestedPairsRef = makeFunctionReference<"query">("requests:suggestedPairs");
const mergeRef = makeFunctionReference<"mutation">("requests:merge");
const listMineRef = makeFunctionReference<"query">("requests:listMine");

/** Flip one P7 feature switch in the settings table. */
async function setFeature(t: Test, name: string, on: boolean) {
  await t.run(async (ctx) => {
    const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", "features")).unique();
    const current = (row?.value as Record<string, boolean>) ?? {};
    const value = { ...current, [name]: on };
    if (row) await ctx.db.patch(row._id, { value });
    else await ctx.db.insert("settings", { key: "features", value });
  });
}

async function insertHospital(t: Test, places: Places, opts: { isDemo?: boolean } = {}) {
  return await t.run(async (ctx) =>
    await ctx.db.insert("hospitals", {
      nameEn: "Chattogram Medical College Hospital",
      nameBn: "চট্টগ্রাম মেডিকেল কলেজ হাসপাতাল",
      aliases: ["CMCH"],
      searchText: "chattogram medical college hospital cmch",
      type: "hospital",
      divisionId: places.divisionId,
      districtId: places.districtId,
      upazilaId: places.upazilaId,
      lat: 22.359,
      lng: 91.831,
      active: true,
      isDemo: opts.isDemo ?? false,
    }),
  );
}

async function insertResponse(
  t: Test,
  requestId: Id<"requests">,
  donorProfileId: Id<"donorProfiles">,
  donorId: Id<"profiles">,
  state: "notified" | "opened" | "accepted" | "confirmed" | "standby" | "declined" | "withdrew",
  opts: { isDemo?: boolean } = {},
) {
  return await t.run(async (ctx) =>
    await ctx.db.insert("responses", {
      requestId,
      donorProfileId,
      donorId,
      wave: 1,
      state,
      notifiedAt: Date.now(),
      acceptedAt: state === "confirmed" || state === "standby" || state === "accepted" ? Date.now() : undefined,
      confirmedAt: state === "confirmed" ? Date.now() : undefined,
      callMode: "mutual",
      isDemo: opts.isDemo ?? false,
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────
// Slice 1 — F-208 duplicate warning + F-707 merge (duplicateWarning)
// ─────────────────────────────────────────────────────────────────────

describe("P7 slice 1 — duplicate warning (F-208, R12)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  async function setup(t: Test) {
    await t.mutation(seedSettings, {});
    const places = await seedPlaces(t);
    const hospitalId = await insertHospital(t, places);
    const poster = await insertProfile(t, { name: "First Poster" });
    const second = await insertProfile(t, { name: "Second Poster" });
    const existing = await insertRequest(t, places, poster.profileId, {});
    await t.run(async (ctx) => {
      await ctx.db.patch(existing, { hospitalId, bloodGroup: "B+" as never });
    });
    return { places, hospitalId, poster, second, existing };
  }

  it("switch OFF: inert — no match even for an identical open request", async () => {
    const t = newTest();
    const s = await setup(t);
    const out = await s.second.asUser.query(checkDuplicateRef, {
      bloodGroup: "B+" as never, hospitalId: s.hospitalId, upazilaId: s.places.upazilaId,
    });
    expect(out).toEqual({});
  });

  it("switch ON: same group + hospital inside the window → match with slug/hospital/time only", async () => {
    const t = newTest();
    const s = await setup(t);
    await setFeature(t, "duplicateWarning", true);
    const out = (await s.second.asUser.query(checkDuplicateRef, {
      bloodGroup: "B+" as never, hospitalId: s.hospitalId, upazilaId: s.places.upazilaId,
    })) as { match?: { slug: string; hospitalName: string; createdAt: number } };
    expect(out.match).toBeDefined();
    expect(out.match!.hospitalName).toBe("Chattogram Medical College Hospital");
    expect(out.match!.createdAt).toBeGreaterThanOrEqual(T0);
    expect(out.match!.createdAt).toBeLessThan(T0 + 5000);
    expect(Object.keys(out.match!).sort()).toEqual(["createdAt", "hospitalName", "slug"]);
  });

  it("no match: different group, own request, closed request, outside the S-31 window", async () => {
    const t = newTest();
    const s = await setup(t);
    await setFeature(t, "duplicateWarning", true);
    // different group
    expect(await s.second.asUser.query(checkDuplicateRef, {
      bloodGroup: "A+" as never, hospitalId: s.hospitalId, upazilaId: s.places.upazilaId,
    })).toEqual({});
    // the poster's own request never warns the poster
    expect(await s.poster.asUser.query(checkDuplicateRef, {
      bloodGroup: "B+" as never, hospitalId: s.hospitalId, upazilaId: s.places.upazilaId,
    })).toEqual({});
    // closed requests don't count
    await t.run(async (ctx) => {
      await ctx.db.patch(s.existing, { status: "closed" as never, closeReason: "fulfilled" as never });
    });
    expect(await s.second.asUser.query(checkDuplicateRef, {
      bloodGroup: "B+" as never, hospitalId: s.hospitalId, upazilaId: s.places.upazilaId,
    })).toEqual({});
    // outside the 24h window (S-31 default)
    await t.run(async (ctx) => {
      await ctx.db.patch(s.existing, { status: "live" as never, closeReason: undefined });
    });
    vi.setSystemTime(T0 + 25 * HOUR);
    expect(await s.second.asUser.query(checkDuplicateRef, {
      bloodGroup: "B+" as never, hospitalId: s.hospitalId, upazilaId: s.places.upazilaId,
    })).toEqual({});
  });

  it("no hospital picked: same upazila is the match key", async () => {
    const t = newTest();
    const s = await setup(t);
    await setFeature(t, "duplicateWarning", true);
    await t.run(async (ctx) => {
      await ctx.db.patch(s.existing, { hospitalId: undefined });
    });
    const out = (await s.second.asUser.query(checkDuplicateRef, {
      bloodGroup: "B+" as never, upazilaId: s.places.upazilaId, districtId: s.places.districtId,
    })) as { match?: unknown };
    expect(out.match).toBeDefined();
  });

  it("practice isolation: a real request never warns a practice poster and vice versa", async () => {
    const t = newTest();
    const s = await setup(t);
    await setFeature(t, "duplicateWarning", true);
    const demoPoster = await insertProfile(t, { name: "Demo Poster", isDemo: true });
    const out = await demoPoster.asUser.query(checkDuplicateRef, {
      bloodGroup: "B+" as never, hospitalId: s.hospitalId, upazilaId: s.places.upazilaId,
    });
    expect(out).toEqual({});
  });
});

describe("P7 slice 1 — merge duplicates (F-707, V06)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  async function setup(t: Test) {
    await t.mutation(seedSettings, {});
    await setFeature(t, "duplicateWarning", true);
    const places = await seedPlaces(t);
    const hospitalId = await insertHospital(t, places);
    const volunteer = await insertProfile(t, { name: "Vol", role: "volunteer" });
    const member = await insertProfile(t, { name: "Plain Member" });
    const reqA = await insertProfile(t, { name: "Requester A" });
    const reqB = await insertProfile(t, { name: "Requester B" });
    const from = await insertRequest(t, places, reqB.profileId, {});
    const into = await insertRequest(t, places, reqA.profileId, {});
    await t.run(async (ctx) => {
      await ctx.db.patch(from, { hospitalId, unitsNeeded: 2 });
      await ctx.db.patch(into, { hospitalId, unitsNeeded: 2 });
    });
    return { places, hospitalId, volunteer, member, reqA, reqB, from, into };
  }

  async function donorFor(t: Test, places: Places, name: string) {
    const profile = await insertProfile(t, { name });
    const donorId = await insertDonor(t, places, profile.profileId, {});
    return { profile, donorId };
  }

  it("suggestedPairs surfaces the pair for volunteers only; merge refuses members", async () => {
    const t = newTest();
    const s = await setup(t);
    const pairs = (await s.volunteer.asUser.query(suggestedPairsRef, {})) as unknown[];
    expect(pairs).toHaveLength(1);
    expect(await codeOf(s.member.asUser.query(suggestedPairsRef, {}))).toBe("ERR_FORBIDDEN");
    expect(await codeOf(s.member.asUser.mutation(mergeRef, { fromId: s.from, intoId: s.into }))).toBe("ERR_FORBIDDEN");
  });

  it("merge moves responses, keeps the stronger state per donor, closes the duplicate as merged", async () => {
    const t = newTest();
    const s = await setup(t);
    const d1 = await donorFor(t, s.places, "Donor One");
    const d2 = await donorFor(t, s.places, "Donor Two");
    const d3 = await donorFor(t, s.places, "Donor Three");
    // d1 confirmed on the duplicate, only notified on the survivor → confirmed wins.
    await insertResponse(t, s.from, d1.donorId, d1.profile.profileId, "confirmed");
    await insertResponse(t, s.into, d1.donorId, d1.profile.profileId, "notified");
    // d2 standby on the duplicate only → moves.
    await insertResponse(t, s.from, d2.donorId, d2.profile.profileId, "standby");
    // d3 confirmed on the survivor → untouched.
    await insertResponse(t, s.into, d3.donorId, d3.profile.profileId, "confirmed");
    // A reveal recorded against the duplicate follows it.
    await t.run(async (ctx) => {
      await ctx.db.insert("contactReveals", {
        requestId: s.from, viewerId: s.reqB.profileId, subjectId: d1.profile.profileId,
        subjectRole: "donor", reason: "confirmed_slot", expiresAt: T0 + DAY, isDemo: false,
      });
    });

    await s.volunteer.asUser.mutation(mergeRef, { fromId: s.from, intoId: s.into });

    const state = await t.run(async (ctx) => {
      const from = await ctx.db.get(s.from);
      const into = await ctx.db.get(s.into);
      const responses = (await ctx.db.query("responses").collect())
        .map((r) => ({ requestId: r.requestId, donor: r.donorId, state: r.state }));
      const reveals = await ctx.db.query("contactReveals").collect();
      return { from, into, responses, reveals };
    });
    expect(state.from!.status).toBe("closed");
    expect(state.from!.closeReason).toBe("merged");
    expect(state.from!.mergedIntoId).toBe(s.into);
    // d1: exactly one response, on the survivor, confirmed.
    const d1Rows = state.responses.filter((r) => r.donor === d1.profile.profileId);
    expect(d1Rows).toHaveLength(1);
    expect(d1Rows[0]).toMatchObject({ requestId: s.into, state: "confirmed" });
    // d2 moved as standby; d3 still confirmed on the survivor.
    expect(state.responses.find((r) => r.donor === d2.profile.profileId))
      .toMatchObject({ requestId: s.into, state: "standby" });
    expect(state.responses.find((r) => r.donor === d3.profile.profileId))
      .toMatchObject({ requestId: s.into, state: "confirmed" });
    // Survivor: 2 confirmed of 2 needed → covered, unitsConfirmed 2.
    expect(state.into!.unitsConfirmed).toBe(2);
    expect(state.into!.status).toBe("covered");
    // Reveal now points at the survivor.
    expect(state.reveals).toHaveLength(1);
    expect(state.reveals[0].requestId).toBe(s.into);
    // Audit + event written.
    expect(await auditRows(t, "request_merged")).toHaveLength(1);
    // The merged requester's list exposes the survivor's slug.
    const mine = (await s.reqB.asUser.query(listMineRef, {
      status: "closed" as never, paginationOpts: { numItems: 10, cursor: null },
    })) as { page: { closeReason: string | null; mergedSlug: string | null }[] };
    const intoDoc = await t.run(async (ctx) => await ctx.db.get(s.into));
    expect(mine.page[0].closeReason).toBe("merged");
    expect(mine.page[0].mergedSlug).toBe(intoDoc!.publicSlug);
  });

  it("merge caps confirmed at units + S-12: surplus confirmations step back to standby", async () => {
    const t = newTest();
    const s = await setup(t);
    // Survivor needs 2 (cap = 2 + 1 = 3 confirmed). Give it 2 confirmed
    // and the duplicate 2 more confirmed from other donors → 4 > 3.
    const donors = [];
    for (const name of ["D A", "D B", "D C", "D D"]) donors.push(await donorFor(t, s.places, name));
    await insertResponse(t, s.into, donors[0].donorId, donors[0].profile.profileId, "confirmed");
    await insertResponse(t, s.into, donors[1].donorId, donors[1].profile.profileId, "confirmed");
    await insertResponse(t, s.from, donors[2].donorId, donors[2].profile.profileId, "confirmed");
    await insertResponse(t, s.from, donors[3].donorId, donors[3].profile.profileId, "confirmed");
    await s.volunteer.asUser.mutation(mergeRef, { fromId: s.from, intoId: s.into });
    const rows = await t.run(async (ctx) =>
      (await ctx.db.query("responses").withIndex("by_request_state", (q) => q.eq("requestId", s.into)).collect()),
    );
    // by_request_state needs a state too — fall back to a full read:
    const all = await t.run(async (ctx) =>
      (await ctx.db.query("responses").collect()).filter((r) => r.requestId === s.into),
    );
    void rows;
    expect(all.filter((r) => r.state === "confirmed")).toHaveLength(3);
    expect(all.filter((r) => r.state === "standby")).toHaveLength(1);
    const into = await t.run(async (ctx) => await ctx.db.get(s.into));
    expect(into!.unitsConfirmed).toBe(2);
    expect(into!.status).toBe("covered");
  });

  it("merge guards: switch off, same id, closed source, cross-demo", async () => {
    const t = newTest();
    const s = await setup(t);
    expect(await codeOf(s.volunteer.asUser.mutation(mergeRef, { fromId: s.from, intoId: s.from })))
      .toBe("ERR_VALIDATION");
    await setFeature(t, "duplicateWarning", false);
    expect(await codeOf(s.volunteer.asUser.mutation(mergeRef, { fromId: s.from, intoId: s.into })))
      .toBe("ERR_VALIDATION");
    await setFeature(t, "duplicateWarning", true);
    await t.run(async (ctx) => {
      await ctx.db.patch(s.from, { status: "closed" as never, closeReason: "fulfilled" as never });
    });
    expect(await codeOf(s.volunteer.asUser.mutation(mergeRef, { fromId: s.from, intoId: s.into })))
      .toBe("ERR_REQUEST_CLOSED");
    // Cross-demo target is invisible.
    const demoReq = await insertRequest(t, s.places, s.reqA.profileId, { isDemo: true });
    expect(await codeOf(s.volunteer.asUser.mutation(mergeRef, { fromId: demoReq, intoId: s.into })))
      .toBe("ERR_NOT_FOUND");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Slice 2 — F-1002 shared link + F-1005 appeal card (sharedLinks)
// ─────────────────────────────────────────────────────────────────────

const publicViewRef = makeFunctionReference<"query">("requests:publicView");
const sharedBySlugRef = makeFunctionReference<"query">("public:sharedRequestBySlug");
const shareCardRef = makeFunctionReference<"action">("share:shareCard");

describe("P7 slice 2 — shared link + appeal card (F-1002/F-1005)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  async function setup(t: Test) {
    await t.mutation(seedSettings, {});
    const places = await seedPlaces(t);
    const hospitalId = await insertHospital(t, places);
    const owner = await insertProfile(t, { name: "Owner One", phone: "+8801712345678" });
    const other = await insertProfile(t, { name: "Other Two" });
    const reqId = await insertRequest(t, places, owner.profileId, {});
    await t.run(async (ctx) => {
      await ctx.db.patch(reqId, { hospitalId });
    });
    const slug = await t.run(async (ctx) => (await ctx.db.get(reqId))!.publicSlug);
    return { places, hospitalId, owner, other, reqId, slug };
  }

  it("switch OFF: publicView is not-found and shareCard refuses", async () => {
    const t = newTest();
    const s = await setup(t);
    expect(await codeOf(t.query(publicViewRef, { slug: s.slug }))).toBe("ERR_NOT_FOUND");
    expect(await t.query(sharedBySlugRef, { slug: s.slug })).toBeNull();
    expect(
      await codeOf(s.owner.asUser.action(shareCardRef, {
        requestId: s.reqId, lang: "en", includeMyNumber: false,
      })),
    ).toBe("ERR_VALIDATION");
  });

  it("switch ON: the public view is anonymised — exact key set, no people data", async () => {
    const t = newTest();
    const s = await setup(t);
    await setFeature(t, "sharedLinks", true);
    const view = (await t.query(publicViewRef, { slug: s.slug })) as Record<string, unknown>;
    expect(Object.keys(view).sort()).toEqual([
      "areaName", "bloodGroup", "component", "hospitalName", "isDengue",
      "lang", "neededBy", "status", "unitsConfirmed", "unitsNeeded",
    ]);
    expect(view.bloodGroup).toBe("B+");
    expect(view.status).toBe("live");
    const og = (await t.query(sharedBySlugRef, { slug: s.slug })) as Record<string, unknown>;
    expect(Object.keys(og).sort()).toEqual([
      "area", "bloodGroup", "component", "hospitalName", "neededByText",
    ]);
  });

  it("practice requests and unknown slugs never resolve publicly", async () => {
    const t = newTest();
    const s = await setup(t);
    await setFeature(t, "sharedLinks", true);
    const demoOwner = await insertProfile(t, { name: "Demo", isDemo: true });
    const demoReq = await insertRequest(t, s.places, demoOwner.profileId, { isDemo: true });
    const demoSlug = await t.run(async (ctx) => (await ctx.db.get(demoReq))!.publicSlug);
    expect(await codeOf(t.query(publicViewRef, { slug: demoSlug }))).toBe("ERR_NOT_FOUND");
    expect(await codeOf(t.query(publicViewRef, { slug: "nope-nope" }))).toBe("ERR_NOT_FOUND");
    expect(await t.query(sharedBySlugRef, { slug: demoSlug })).toBeNull();
  });

  it("shareCard: template text + fallback image, number only on explicit opt-in", async () => {
    const t = newTest();
    const s = await setup(t);
    await setFeature(t, "sharedLinks", true);

    const plain = (await s.owner.asUser.action(shareCardRef, {
      requestId: s.reqId, lang: "en", includeMyNumber: false,
    })) as { imageUrl: string; text: string; link: string };
    expect(plain.link).toBe(`https://udvasito.vercel.app/r/${s.slug}`);
    // No Cloudinary configured in tests → the honest template fallback.
    expect(plain.imageUrl).toBe("https://udvasito.vercel.app/og-image.png");
    expect(plain.text).toContain("2 bag B+ Whole blood needed at");
    expect(plain.text).toContain(plain.link);
    expect(plain.text).not.toContain("8801712");

    const withNumber = (await s.owner.asUser.action(shareCardRef, {
      requestId: s.reqId, lang: "en", includeMyNumber: true,
    })) as { text: string };
    expect(withNumber.text).toContain("+8801712345678");

    const events = await t.run(async (ctx) =>
      (await ctx.db.query("events").collect()).filter((e) => e.name === "request_shared"),
    );
    expect(events).toHaveLength(2);
  });

  it("shareCard is owner-only", async () => {
    const t = newTest();
    const s = await setup(t);
    await setFeature(t, "sharedLinks", true);
    expect(
      await codeOf(s.other.asUser.action(shareCardRef, {
        requestId: s.reqId, lang: "en", includeMyNumber: false,
      })),
    ).toBe("ERR_NOT_FOUND");
    expect(
      await codeOf(t.action(shareCardRef, {
        requestId: s.reqId, lang: "en", includeMyNumber: false,
      })),
    ).toBe("ERR_UNAUTHENTICATED");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Slice 3 — F-708 campus campaigns (campaignStats)
// ─────────────────────────────────────────────────────────────────────

const campaignsListRef = makeFunctionReference<"query">("campaigns:list");
const campaignsStatsRef = makeFunctionReference<"query">("campaigns:stats");
const campaignsCreateRef = makeFunctionReference<"mutation">("campaigns:create");
const campaignsSetActiveRef = makeFunctionReference<"mutation">("campaigns:setActive");

describe("P7 slice 3 — campus campaigns (F-708, V07)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  async function setup(t: Test) {
    await t.mutation(seedSettings, {});
    const admin = await insertProfile(t, { name: "Admin", role: "admin" });
    const volunteer = await insertProfile(t, { name: "Vol", role: "volunteer" });
    const member = await insertProfile(t, { name: "Member" });
    return { admin, volunteer, member };
  }

  it("switch OFF: lists are empty and creation refuses", async () => {
    const t = newTest();
    const s = await setup(t);
    expect(await s.volunteer.asUser.query(campaignsListRef, {})).toEqual([]);
    expect(await s.admin.asUser.query(campaignsStatsRef, {})).toEqual([]);
    expect(
      await codeOf(s.admin.asUser.mutation(campaignsCreateRef, { code: "cu-1", name: "CU Drive" })),
    ).toBe("ERR_VALIDATION");
  });

  it("roles: members cannot list or create; volunteers list; admins manage", async () => {
    const t = newTest();
    const s = await setup(t);
    await setFeature(t, "campaignStats", true);
    expect(await codeOf(s.member.asUser.query(campaignsListRef, {}))).toBe("ERR_FORBIDDEN");
    expect(
      await codeOf(s.member.asUser.mutation(campaignsCreateRef, { code: "cu-1", name: "CU Drive" })),
    ).toBe("ERR_FORBIDDEN");
    expect(
      await codeOf(s.volunteer.asUser.mutation(campaignsCreateRef, { code: "cu-1", name: "CU Drive" })),
    ).toBe("ERR_FORBIDDEN");
    expect(
      await codeOf(s.volunteer.asUser.query(campaignsStatsRef, {})),
    ).toBe("ERR_FORBIDDEN");

    await s.admin.asUser.mutation(campaignsCreateRef, {
      code: "CU-Drive-1", name: "University of Chittagong Drive", institution: "CU",
    });
    const list = (await s.volunteer.asUser.query(campaignsListRef, {})) as { code: string; active: boolean }[];
    expect(list).toHaveLength(1);
    expect(list[0].code).toBe("cu-drive-1"); // normalised lower-case
    expect(list[0].active).toBe(true);

    // Duplicate + malformed codes refuse.
    expect(
      await codeOf(s.admin.asUser.mutation(campaignsCreateRef, { code: "cu-drive-1", name: "Again" })),
    ).toBe("ERR_VALIDATION");
    expect(
      await codeOf(s.admin.asUser.mutation(campaignsCreateRef, { code: "Bad Code!", name: "Nope" })),
    ).toBe("ERR_VALIDATION");
    expect(await auditRows(t, "campaign_created")).toHaveLength(1);
  });

  it("stats count real sign-ups per campaign; pausing stops new attribution visibility", async () => {
    const t = newTest();
    const s = await setup(t);
    await setFeature(t, "campaignStats", true);
    await s.admin.asUser.mutation(campaignsCreateRef, { code: "cu-1", name: "CU Drive" });
    const joiner = await insertProfile(t, { name: "Joiner" });
    const demoJoiner = await insertProfile(t, { name: "Demo Joiner", isDemo: true });
    await t.run(async (ctx) => {
      await ctx.db.patch(joiner.profileId, { campaignCode: "cu-1" });
      await ctx.db.patch(demoJoiner.profileId, { campaignCode: "cu-1" });
    });
    const stats = (await s.admin.asUser.query(campaignsStatsRef, {})) as {
      code: string; signups: number; donorsLive: number; active: boolean;
    }[];
    expect(stats).toHaveLength(1);
    expect(stats[0].signups).toBe(1); // practice sign-ups never count
    expect(stats[0].donorsLive).toBe(0);

    await s.admin.asUser.mutation(campaignsSetActiveRef, { code: "cu-1", active: false });
    const after = (await s.admin.asUser.query(campaignsStatsRef, {})) as { active: boolean }[];
    expect(after[0].active).toBe(false);
    expect(await auditRows(t, "campaign_toggled")).toHaveLength(1);
    expect(
      await codeOf(s.admin.asUser.mutation(campaignsSetActiveRef, { code: "nope", active: true })),
    ).toBe("ERR_NOT_FOUND");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Slice 6 — F-604 FAQ assistant (assistant)
// ─────────────────────────────────────────────────────────────────────

const faqListRef = makeFunctionReference<"query">("assistant:faqList");
const assistantAskRef = makeFunctionReference<"action">("assistant:ask");

async function insertFaq(
  t: Test,
  opts: { status: "draft" | "approved"; questionEn?: string; answerEn?: string },
) {
  return await t.run(async (ctx) =>
    await ctx.db.insert("faqEntries", {
      questionEn: opts.questionEn ?? "How old do I need to be to donate blood?",
      questionBn: "রক্ত দিতে হলে আমার বয়স কত হতে হবে?",
      answerEn: opts.answerEn ?? "Donors need to be 18 to 65 years old.",
      answerBn: "রক্তদাতার বয়স ১৮ থেকে ৬৫ বছরের মধ্যে হতে হবে।",
      tags: ["eligibility", "age"],
      status: opts.status,
      approvedBy: opts.status === "approved" ? undefined : undefined,
      approvedAt: opts.status === "approved" ? Date.now() : undefined,
    }),
  );
}

describe("P7 slice 6 — FAQ assistant (F-604, D10)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  async function setup(t: Test) {
    await t.mutation(seedSettings, {});
    const member = await insertProfile(t, { name: "Asker" });
    return { member };
  }

  it("switch OFF: faqList is empty and ask refuses", async () => {
    const t = newTest();
    const s = await setup(t);
    await insertFaq(t, { status: "approved" });
    expect(await t.query(faqListRef, { lang: "en" })).toEqual([]);
    expect(
      await codeOf(s.member.asUser.action(assistantAskRef, {
        question: "How old do I need to be?", lang: "en",
      })),
    ).toBe("ERR_VALIDATION");
  });

  it("all-draft FAQ (today's real state): faqList empty, every question is an honest nomatch", async () => {
    const t = newTest();
    const s = await setup(t);
    await setFeature(t, "assistant", true);
    await insertFaq(t, { status: "draft" });
    expect(await t.query(faqListRef, { lang: "en" })).toEqual([]);
    const out = (await s.member.asUser.action(assistantAskRef, {
      question: "How old do I need to be to donate blood?", lang: "en",
    })) as { mode: string };
    expect(out.mode).toBe("nomatch");
  });

  it("approved entries: faqList serves them (with search); rules match answers verbatim", async () => {
    const t = newTest();
    const s = await setup(t);
    await setFeature(t, "assistant", true);
    const id = await insertFaq(t, { status: "approved" });
    await insertFaq(t, { status: "draft", questionEn: "Draft question about weight?" });

    const list = (await t.query(faqListRef, { lang: "en" })) as { id: string; question: string }[];
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
    expect(await t.query(faqListRef, { lang: "en", search: "old" })).toHaveLength(1);
    expect(await t.query(faqListRef, { lang: "en", search: "weight" })).toHaveLength(0);

    const out = (await s.member.asUser.action(assistantAskRef, {
      question: "How old do I need to be to donate blood?", lang: "en",
    })) as { mode: string; answer?: string; faqId?: string };
    expect(out.mode).toBe("faq");
    expect(out.answer).toBe("Donors need to be 18 to 65 years old.");
    expect(out.faqId).toBe(id);

    const bn = (await s.member.asUser.action(assistantAskRef, {
      question: "রক্ত দিতে হলে আমার বয়স কত হতে হবে?", lang: "bn",
    })) as { mode: string; answer?: string };
    expect(bn.mode).toBe("faq");
    expect(bn.answer).toContain("১৮");
  });

  it("personal health with no FAQ answer deflects to doctor; VAL-21 enforced", async () => {
    const t = newTest();
    const s = await setup(t);
    await setFeature(t, "assistant", true);
    await insertFaq(t, { status: "approved" });
    const out = (await s.member.asUser.action(assistantAskRef, {
      question: "I have diabetes and my haemoglobin is low, should I donate today?",
      lang: "en",
    })) as { mode: string };
    expect(out.mode).toBe("doctor");
    expect(
      await codeOf(s.member.asUser.action(assistantAskRef, { question: "hi", lang: "en" })),
    ).toBe("ERR_VALIDATION");
    expect(
      await codeOf(t.action(assistantAskRef, { question: "How old to donate?", lang: "en" })),
    ).toBe("ERR_UNAUTHENTICATED");
  });

  it("S-29 daily limit: after the cap, mode is limit (and limit answers don't consume quota)", async () => {
    const t = newTest();
    const s = await setup(t);
    await setFeature(t, "assistant", true);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("settings")
        .withIndex("by_key", (q) => q.eq("key", "assistantQuestionsPerDay"))
        .unique();
      await ctx.db.patch(row!._id, { value: 2 });
    });
    const ask = () =>
      s.member.asUser.action(assistantAskRef, {
        question: "What is the meaning of life?", lang: "en",
      }) as Promise<{ mode: string; limit?: number }>;
    expect((await ask()).mode).toBe("nomatch");
    expect((await ask()).mode).toBe("nomatch");
    const third = await ask();
    expect(third.mode).toBe("limit");
    expect(third.limit).toBe(2);
    expect((await ask()).mode).toBe("limit");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Slice 7 — F-211 volunteer posts from a public post (volunteerPost)
// ─────────────────────────────────────────────────────────────────────

const requestsCreateRef = makeFunctionReference<"mutation">("requests:create");
const claimAsFamilyRef = makeFunctionReference<"mutation">("requests:claimAsFamily");
const claimableByMeRef = makeFunctionReference<"query">("requests:claimableByMe");

describe("P7 slice 7 — volunteer post + family claim (F-211, V04)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  function createArgs(places: Places, hospitalId: Id<"hospitals">, contactPhone: string) {
    return {
      clientId: `vp-${Math.random().toString(36).slice(2)}`,
      bloodGroup: "B+" as never,
      component: "whole_blood" as never,
      isDengue: false,
      unitsNeeded: 2,
      hospitalId,
      divisionId: places.divisionId,
      districtId: places.districtId,
      upazilaId: places.upazilaId,
      neededBy: T0 + 6 * HOUR,
      contactPhone,
      source: "volunteer_paste" as never,
      aiAssisted: false,
      lang: "en" as never,
    };
  }

  async function setup(t: Test) {
    await t.mutation(seedSettings, {});
    const places = await seedPlaces(t);
    const hospitalId = await insertHospital(t, places);
    const volunteer = await insertProfile(t, { name: "Vol", role: "volunteer" });
    const member = await insertProfile(t, { name: "Member" });
    return { places, hospitalId, volunteer, member };
  }

  it("gates: switch off refuses; a member cannot post as a volunteer", async () => {
    const t = newTest();
    const s = await setup(t);
    expect(
      await codeOf(s.volunteer.asUser.mutation(requestsCreateRef,
        createArgs(s.places, s.hospitalId, "01812345678"))),
    ).toBe("ERR_VALIDATION");
    await setFeature(t, "volunteerPost", true);
    expect(
      await codeOf(s.member.asUser.mutation(requestsCreateRef,
        createArgs(s.places, s.hospitalId, "01812345678"))),
    ).toBe("ERR_FORBIDDEN");
  });

  it("volunteer post: provenance set, contact unverified, label data flows", async () => {
    const t = newTest();
    const s = await setup(t);
    await setFeature(t, "volunteerPost", true);
    const { requestId } = (await s.volunteer.asUser.mutation(requestsCreateRef,
      createArgs(s.places, s.hospitalId, "01812345678"))) as { requestId: Id<"requests"> };
    const doc = await t.run(async (ctx) => await ctx.db.get(requestId));
    expect(doc?.source).toBe("volunteer_paste");
    expect(doc?.createdByVolunteerId).toBe(s.volunteer.profileId);
    expect(doc?.contactPhoneVerified).toBe(false);
    expect(doc?.contactPhone).toBe("+8801812345678");
    const mine = (await s.volunteer.asUser.query(listMineRef, {
      status: "active", paginationOpts: { numItems: 10, cursor: null },
    })) as { page: { postedByVolunteer: boolean }[] };
    expect(mine.page[0].postedByVolunteer).toBe(true);
  });

  it("regression: hospital-only create (no place ids, as SCR-M02 sends) succeeds", async () => {
    const t = newTest();
    const s = await setup(t);
    const args = createArgs(s.places, s.hospitalId, "01712345678") as Record<string, unknown>;
    delete args.divisionId;
    delete args.districtId;
    delete args.upazilaId;
    args.source = "form";
    const out = (await s.member.asUser.mutation(requestsCreateRef, args as never)) as {
      requestId: Id<"requests">;
    };
    const doc = await t.run(async (ctx) => await ctx.db.get(out.requestId));
    expect(doc?.upazilaId).toBe(s.places.upazilaId); // resolved from the hospital
    // And the no-hospital/no-place path still refuses cleanly.
    const bad = { ...args, hospitalId: undefined, clientId: "vp-bad" };
    expect(await codeOf(s.member.asUser.mutation(requestsCreateRef, bad as never)))
      .toBe("ERR_VALIDATION");
  });

  it("family claim: verified contact number takes ownership; others cannot", async () => {
    const t = newTest();
    const s = await setup(t);
    await setFeature(t, "volunteerPost", true);
    const { requestId } = (await s.volunteer.asUser.mutation(requestsCreateRef,
      createArgs(s.places, s.hospitalId, "01812345678"))) as { requestId: Id<"requests"> };
    const family = await insertProfile(t, { name: "Family", phone: "01812345678" });
    const stranger = await insertProfile(t, { name: "Stranger", phone: "01912345678" });
    const unverified = await insertProfile(t, {
      name: "Unverified", phone: "01812345678", phoneVerified: false,
    });

    const claimable = (await family.asUser.query(claimableByMeRef, {})) as { requestId: string }[];
    expect(claimable.map((c) => c.requestId)).toEqual([requestId]);
    expect(await stranger.asUser.query(claimableByMeRef, {})).toEqual([]);
    expect(await codeOf(stranger.asUser.mutation(claimAsFamilyRef, { requestId })))
      .toBe("ERR_FORBIDDEN");
    expect(await codeOf(unverified.asUser.mutation(claimAsFamilyRef, { requestId })))
      .toBe("ERR_FORBIDDEN");

    await family.asUser.mutation(claimAsFamilyRef, { requestId });
    const doc = await t.run(async (ctx) => await ctx.db.get(requestId));
    expect(doc?.requesterId).toBe(family.profileId);
    expect(doc?.contactPhoneVerified).toBe(true);
    expect(doc?.createdByVolunteerId).toBe(s.volunteer.profileId); // provenance kept
    expect(await auditRows(t, "request_claimed_by_family")).toHaveLength(1);
    expect(await family.asUser.query(claimableByMeRef, {})).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Slice 8 — F-209/F-706 slip photos + checks (slips)
// ─────────────────────────────────────────────────────────────────────

const genSlipUrlRef = makeFunctionReference<"mutation">("requests:generateSlipUploadUrl");
const attachSlipRef = makeFunctionReference<"mutation">("requests:attachSlip");
const slipsQueueRef = makeFunctionReference<"query">("slips:queue");
const slipsReviewRef = makeFunctionReference<"mutation">("slips:review");
const authorizeSlipViewRef = makeFunctionReference<"mutation">("slips:authorizeView");

describe("P7 slice 8 — slips (F-209/F-706)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  async function setup(t: Test) {
    await t.mutation(seedSettings, {});
    const places = await seedPlaces(t);
    const owner = await insertProfile(t, { name: "Owner" });
    const other = await insertProfile(t, { name: "Other" });
    const volunteer = await insertProfile(t, { name: "Vol", role: "volunteer" });
    const reqId = await insertRequest(t, places, owner.profileId, {});
    const fileId = await t.run(async (ctx) =>
      await ctx.storage.store(new Blob(["fake-jpeg"], { type: "image/jpeg" })),
    );
    return { places, owner, other, volunteer, reqId, fileId };
  }

  it("switch OFF: upload URL, queue and review are all inert", async () => {
    const t = newTest();
    const s = await setup(t);
    expect(await codeOf(s.owner.asUser.mutation(genSlipUrlRef, { requestId: s.reqId })))
      .toBe("ERR_VALIDATION");
    expect(await s.volunteer.asUser.query(slipsQueueRef, {})).toEqual([]);
    expect(
      await codeOf(s.volunteer.asUser.mutation(slipsReviewRef, {
        requestId: s.reqId, decision: "approve",
      })),
    ).toBe("ERR_VALIDATION");
  });

  it("attach is owner-only and lands in the volunteer queue as pending", async () => {
    const t = newTest();
    const s = await setup(t);
    await setFeature(t, "slips", true);
    expect(
      await codeOf(s.other.asUser.mutation(attachSlipRef, {
        requestId: s.reqId, storageId: s.fileId,
      })),
    ).toBe("ERR_FORBIDDEN");
    const url = (await s.owner.asUser.mutation(genSlipUrlRef, { requestId: s.reqId })) as {
      uploadUrl: string;
    };
    expect(url.uploadUrl).toContain("http");
    await s.owner.asUser.mutation(attachSlipRef, { requestId: s.reqId, storageId: s.fileId });
    const doc = await t.run(async (ctx) => await ctx.db.get(s.reqId));
    expect(doc?.slipStatus).toBe("pending");
    expect(doc?.slipFileId).toBe(s.fileId);
    const queue = (await s.volunteer.asUser.query(slipsQueueRef, {})) as { requestId: string }[];
    expect(queue.map((q) => q.requestId)).toEqual([s.reqId]);
    expect(await codeOf(s.owner.asUser.query(slipsQueueRef, {}))).toBe("ERR_FORBIDDEN");
  });

  it("review: reject needs a VAL-18 reason; approve sets the verified badge; both audited", async () => {
    const t = newTest();
    const s = await setup(t);
    await setFeature(t, "slips", true);
    await s.owner.asUser.mutation(attachSlipRef, { requestId: s.reqId, storageId: s.fileId });
    expect(
      await codeOf(s.volunteer.asUser.mutation(slipsReviewRef, {
        requestId: s.reqId, decision: "reject",
      })),
    ).toBe("ERR_VALIDATION");
    await s.volunteer.asUser.mutation(slipsReviewRef, {
      requestId: s.reqId, decision: "reject", reason: "Photo is unreadable",
    });
    let doc = await t.run(async (ctx) => await ctx.db.get(s.reqId));
    expect(doc?.slipStatus).toBe("rejected");
    expect(doc?.verifiedBadge).toBe(false);
    // A rejected slip can be replaced and re-checked.
    await s.owner.asUser.mutation(attachSlipRef, { requestId: s.reqId, storageId: s.fileId });
    await s.volunteer.asUser.mutation(slipsReviewRef, {
      requestId: s.reqId, decision: "approve",
    });
    doc = await t.run(async (ctx) => await ctx.db.get(s.reqId));
    expect(doc?.slipStatus).toBe("approved");
    expect(doc?.verifiedBadge).toBe(true);
    expect(doc?.slipReviewedBy).toBe(s.volunteer.profileId);
    expect(await auditRows(t, "slip_reviewed")).toHaveLength(2);
    expect(await s.volunteer.asUser.query(slipsQueueRef, {})).toEqual([]);
  });

  it("viewing: only owner/staff, every view audited; the HTTP route demands a token", async () => {
    const t = newTest();
    const s = await setup(t);
    await setFeature(t, "slips", true);
    await s.owner.asUser.mutation(attachSlipRef, { requestId: s.reqId, storageId: s.fileId });

    const asOwner = await t.mutation(authorizeSlipViewRef, {
      subject: s.owner.authUserId, requestId: s.reqId,
    });
    expect(asOwner?.fileId).toBe(s.fileId);
    const asVolunteer = await t.mutation(authorizeSlipViewRef, {
      subject: s.volunteer.authUserId, requestId: s.reqId,
    });
    expect(asVolunteer?.fileId).toBe(s.fileId);
    const asStranger = await t.mutation(authorizeSlipViewRef, {
      subject: s.other.authUserId, requestId: s.reqId,
    });
    expect(asStranger).toBeNull();
    expect(await auditRows(t, "slip_viewed")).toHaveLength(2);

    const res = await t.fetch(`/slip/${s.reqId}`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Slice 9 — retention batch: F-210 repeat, F-506 history, F-505
// reminders, F-105 edit profile gate, F-308 alert-limit gate
// ─────────────────────────────────────────────────────────────────────

const updateProfileRef = makeFunctionReference<"mutation">("profiles:updateProfile");
const updateSettingsRef = makeFunctionReference<"mutation">("donors:updateSettings");
const historyRef = makeFunctionReference<"query">("donors:history");
const repeatRef = makeFunctionReference<"mutation">("requests:repeat");
const remindersDailyRef = makeFunctionReference<"mutation">("reminders:daily");

type DonorOpts = {
  eligibleFrom?: number;
  availabilityConfirmedAt?: number;
  availability?: string;
};

async function insertDonorRow(
  t: Test,
  places: Places,
  profileId: string,
  opts: DonorOpts = {},
) {
  return await t.run(async (ctx) =>
    await ctx.db.insert("donorProfiles", {
      profileId: profileId as never,
      bloodGroup: "B+",
      gender: "male",
      divisionId: places.divisionId as never,
      districtId: places.districtId as never,
      upazilaId: places.upazilaId as never,
      travelRange: "district",
      neverDonated: true,
      plateletOptIn: false,
      availability: (opts.availability ?? "available") as never,
      availabilityConfirmedAt: opts.availabilityConfirmedAt ?? T0,
      eligibleFrom: opts.eligibleFrom ?? 0,
      eligibleFromPlatelets: 0,
      callMode: "mutual",
      volunteersMayCall: false,
      verifiedRequestsOnly: false,
      alertCapPerDay: 3,
      quietStart: "22:00",
      quietEnd: "07:00",
      urgentOverride: true,
      hidden: false,
      live: true,
      selfCheckAt: T0,
      healthConsentVersion: "2026-11-28-pilot",
      noShowAt: [],
      isDemo: false,
    }),
  );
}

describe("P7 slice 9 — retention batch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  it("F-105: updateProfile is inert while editProfile is off; phone change unverifies when on", async () => {
    const t = newTest();
    await t.mutation(seedSettings, {});
    const user = await insertProfile(t, { name: "Before" });
    expect(await codeOf(user.asUser.mutation(updateProfileRef, { name: "After" })))
      .toBe("ERR_VALIDATION");
    await setFeature(t, "editProfile", true);
    await user.asUser.mutation(updateProfileRef, { name: "After" });
    let profile = await t.run(async (ctx) => await ctx.db.get(user.profileId));
    expect(profile?.name).toBe("After");
    await user.asUser.mutation(updateProfileRef, { phone: "01899999999" });
    profile = await t.run(async (ctx) => await ctx.db.get(user.profileId));
    expect(profile?.phone).toBe("+8801899999999");
    expect(profile?.phoneVerified).toBe(false);
  });

  it("F-308: limit fields refused while alertLimits is off; core fields still save", async () => {
    const t = newTest();
    await t.mutation(seedSettings, {});
    const places = await seedPlaces(t);
    const user = await insertProfile(t, { name: "Donor" });
    const donorId = await insertDonorRow(t, places, user.profileId);
    expect(await codeOf(user.asUser.mutation(updateSettingsRef, { alertCapPerDay: 5 })))
      .toBe("ERR_VALIDATION");
    await user.asUser.mutation(updateSettingsRef, { plateletOptIn: true });
    let donor = await t.run(async (ctx) => await ctx.db.get(donorId));
    expect(donor?.plateletOptIn).toBe(true);
    await setFeature(t, "alertLimits", true);
    await user.asUser.mutation(updateSettingsRef, { alertCapPerDay: 5, quietStart: "23:00" });
    donor = await t.run(async (ctx) => await ctx.db.get(donorId));
    expect(donor?.alertCapPerDay).toBe(5);
    expect(donor?.quietStart).toBe("23:00");
  });

  it("F-506: history lists only donor-confirmed donations, with badges + next eligible date", async () => {
    const t = newTest();
    await t.mutation(seedSettings, {});
    const places = await seedPlaces(t);
    const donorUser = await insertProfile(t, { name: "Donor" });
    const donorRowId = await insertDonorRow(t, places, donorUser.profileId, {
      eligibleFrom: T0 + 10 * 86_400_000,
    });
    const owner = await insertProfile(t, { name: "Owner" });
    const reqId = await insertRequest(t, places, owner.profileId, {});
    const otherReqId = await insertRequest(t, places, owner.profileId, {});
    await t.run(async (ctx) => {
      await ctx.db.patch(reqId as never, { placeText: "Test Hospital" });
    });
    const donatedResponse = await insertResponse(
      t, reqId, donorRowId, donorUser.profileId, "confirmed",
    );
    const refusedResponse = await insertResponse(
      t, otherReqId, donorRowId, donorUser.profileId, "confirmed",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(donatedResponse as never, {
        outcomeDonor: "donated", outcomeDonorAt: T0 - 86_400_000,
      });
      await ctx.db.patch(refusedResponse as never, {
        outcomeDonor: "did_not_donate", outcomeDonorAt: T0 - 86_400_000,
      });
    });

    expect(await donorUser.asUser.query(historyRef, {})).toMatchObject({ total: 0 });
    await setFeature(t, "donorHistory", true);
    const history = (await donorUser.asUser.query(historyRef, {})) as {
      total: number;
      badges: number[];
      nextEligibleAt?: number;
      donations: { group: string; hospitalName: string }[];
    };
    expect(history.total).toBe(1);
    expect(history.badges).toEqual([1]);
    expect(history.nextEligibleAt).toBe(T0 + 10 * 86_400_000);
    expect(history.donations[0].group).toBe("B+");
    expect(history.donations[0].hospitalName).toBe("Test Hospital");
  });

  it("F-210: repeat copies a closed request with adjusted date/units; guards hold", async () => {
    const t = newTest();
    await t.mutation(seedSettings, {});
    const places = await seedPlaces(t);
    const owner = await insertProfile(t, { name: "Owner" });
    const stranger = await insertProfile(t, { name: "Stranger" });
    const closedId = await insertRequest(t, places, owner.profileId, { status: "closed" });
    const openId = await insertRequest(t, places, owner.profileId, {});
    await t.run(async (ctx) => {
      await ctx.db.patch(closedId as never, { placeText: "Test Hospital area" });
      await ctx.db.patch(openId as never, { placeText: "Test Hospital area" });
    });

    const args = { neededBy: T0 + 24 * 3_600_000, unitsNeeded: 3 };
    expect(await codeOf(owner.asUser.mutation(repeatRef, { fromId: closedId, ...args })))
      .toBe("ERR_VALIDATION"); // switch off
    await setFeature(t, "repeatRequest", true);
    expect(await codeOf(stranger.asUser.mutation(repeatRef, { fromId: closedId, ...args })))
      .toBe("ERR_FORBIDDEN");
    expect(await codeOf(owner.asUser.mutation(repeatRef, { fromId: openId, ...args })))
      .toBe("ERR_VALIDATION"); // not closed

    const out = (await owner.asUser.mutation(repeatRef, { fromId: closedId, ...args })) as {
      requestId: Id<"requests">;
    };
    const copy = await t.run(async (ctx) => await ctx.db.get(out.requestId));
    expect(copy?.status).toBe("live");
    expect(copy?.unitsNeeded).toBe(3);
    expect(copy?.neededBy).toBe(T0 + 24 * 3_600_000);
    expect(copy?.bloodGroup).toBe("B+");
    expect(copy?.divisionId).toBe(places.divisionId);
    expect(copy?.requesterId).toBe(owner.profileId);
  });

  it("F-505: reminders send NTF-11/NTF-12 once each, and nothing while off", async () => {
    const t = newTest();
    await t.mutation(seedSettings, {});
    const places = await seedPlaces(t);
    // Donor A: cooldown ended an hour ago.
    const a = await insertProfile(t, { name: "A" });
    await insertDonorRow(t, places, a.profileId, { eligibleFrom: T0 - 3_600_000 });
    // Donor B: availability last confirmed 100 days ago (S-28 = 90).
    const b = await insertProfile(t, { name: "B" });
    await insertDonorRow(t, places, b.profileId, {
      eligibleFrom: 0,
      availabilityConfirmedAt: T0 - 100 * 86_400_000,
    });

    const off = (await t.mutation(remindersDailyRef, {})) as { skipped?: string };
    expect(off.skipped).toBe("feature_off");
    await setFeature(t, "reminders", true);
    const first = (await t.mutation(remindersDailyRef, {})) as {
      eligibleAgain: number;
      nudges: number;
    };
    expect(first).toEqual({ eligibleAgain: 1, nudges: 1 });
    const second = (await t.mutation(remindersDailyRef, {})) as {
      eligibleAgain: number;
      nudges: number;
    };
    expect(second).toEqual({ eligibleAgain: 0, nudges: 0 });
    const notes = await t.run(async (ctx) => await ctx.db.query("notifications").collect());
    expect(notes.map((n) => n.template).sort()).toEqual(["NTF-11", "NTF-12"]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Slice 10 — admin batch: F-904 settings editing, F-906 directory,
// F-907 FAQ UI, F-905 import/export, F-908 weekly summary,
// F-307 email copies, F-1006 install-prompt gating (client-side)
// ─────────────────────────────────────────────────────────────────────

const settingsUpdateRef = makeFunctionReference<"mutation">("admin/settings:update");
const directoryListRef = makeFunctionReference<"query">("admin/directory:list");
const directoryUpsertRef = makeFunctionReference<"mutation">("admin/directory:upsert");
const adminFaqListRef = makeFunctionReference<"query">("admin/faq:list");
const faqSaveRef = makeFunctionReference<"mutation">("admin/faq:save");
const faqSetStatusRef = makeFunctionReference<"mutation">("admin/faq:setStatus");
const importDonorsRef = makeFunctionReference<"mutation">("admin/data:importDonors");
const exportDataRef = makeFunctionReference<"mutation">("admin/data:exportData");
const summaryCurrentRef = makeFunctionReference<"query">("admin/summary:current");
const summaryNarrateRef = makeFunctionReference<"action">("admin/summary:narrate");

describe("P7 slice 10 — admin batch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  it("F-904: settings update validates VAL-19, refuses minAge + non-admins, audits", async () => {
    const t = newTest();
    await t.mutation(seedSettings, {});
    const admin = await insertProfile(t, { name: "Admin", role: "admin" });
    const member = await insertProfile(t, { name: "Member" });

    // Switch off → inert; member → forbidden regardless.
    expect(
      await codeOf(admin.asUser.mutation(settingsUpdateRef, {
        key: "extraConfirmedSlots", value: 2, reason: "Pilot tuning",
      })),
    ).toBe("ERR_VALIDATION");
    await setFeature(t, "settingsEdit", true);
    expect(
      await codeOf(member.asUser.mutation(settingsUpdateRef, {
        key: "extraConfirmedSlots", value: 2, reason: "Pilot tuning",
      })),
    ).toBe("ERR_FORBIDDEN");

    // VAL-19: extraConfirmedSlots range is [0, 3] in SETTING_DEFS.
    expect(
      await codeOf(admin.asUser.mutation(settingsUpdateRef, {
        key: "extraConfirmedSlots", value: 99, reason: "Pilot tuning",
      })),
    ).toBe("ERR_VALIDATION");
    // S-01 is fixed.
    expect(
      await codeOf(admin.asUser.mutation(settingsUpdateRef, {
        key: "minAge", value: 16, reason: "Lower the age",
      })),
    ).toBe("ERR_VALIDATION");
    // Reason is required.
    expect(
      await codeOf(admin.asUser.mutation(settingsUpdateRef, {
        key: "extraConfirmedSlots", value: 2, reason: "x",
      })),
    ).toBe("ERR_VALIDATION");

    await admin.asUser.mutation(settingsUpdateRef, {
      key: "extraConfirmedSlots", value: 2, reason: "Pilot tuning",
    });
    const row = await t.run(async (ctx) =>
      await ctx.db
        .query("settings")
        .withIndex("by_key", (q) => q.eq("key", "extraConfirmedSlots"))
        .unique(),
    );
    expect(row?.value).toBe(2);
    expect(await auditRows(t, "setting_changed")).toHaveLength(1);

    // Feature-flag objects: known boolean subkeys only.
    expect(
      await codeOf(admin.asUser.mutation(settingsUpdateRef, {
        key: "features", value: { nope: true }, reason: "Typo guard",
      })),
    ).toBe("ERR_VALIDATION");
    const flags = (await t.run(async (ctx) =>
      await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", "features")).unique(),
    ))?.value as Record<string, boolean>;
    await admin.asUser.mutation(settingsUpdateRef, {
      key: "features",
      value: { ...flags, slips: true },
      reason: "Enable slips for QA",
    });
    const after = (await t.run(async (ctx) =>
      await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", "features")).unique(),
    ))?.value as Record<string, boolean>;
    expect(after.slips).toBe(true);
    expect(after.assistant).toBe(false);
  });

  it("F-904/S3-F1: object/array settings are shape-validated, nothing stored on failure", async () => {
    const t = newTest();
    await t.mutation(seedSettings, {});
    const admin = await insertProfile(t, { name: "Admin", role: "admin" });
    await setFeature(t, "settingsEdit", true);

    const stored = async (key: string) =>
      await t.run(async (ctx) =>
        await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", key)).unique(),
      );
    const attempt = (key: string, value: unknown) =>
      codeOf(admin.asUser.mutation(settingsUpdateRef, { key, value, reason: "Shape validation" }));

    // The P7 independent review's three probes — all previously accepted.
    expect(await attempt("noShowPenalty", "garbage")).toBe("ERR_VALIDATION");
    expect(await attempt("waveSizes", 42)).toBe("ERR_VALIDATION");
    expect(await attempt("quietHours", true)).toBe("ERR_VALIDATION");

    // Nested wrong types and wrong-typed array elements.
    expect(await attempt("noShowPenalty", { count: "two", days: 90 })).toBe("ERR_VALIDATION");
    expect(
      await attempt("ai.limits", { liteDaily: "500", liteRpm: 15, flashDaily: 20 }),
    ).toBe("ERR_VALIDATION");
    expect(await attempt("waveSizes", [10, "25", 50])).toBe("ERR_VALIDATION");
    expect(await attempt("pilotDistrictIds", [123])).toBe("ERR_VALIDATION");
    expect(
      await attempt("verification", {
        telegram: "yes", whatsapp: false, inPerson: true, telegramBot: "", whatsappNumber: "",
      }),
    ).toBe("ERR_VALIDATION");

    // Missing field, extra field, unknown key.
    expect(await attempt("noShowPenalty", { count: 2 })).toBe("ERR_VALIDATION");
    expect(await attempt("noShowPenalty", { count: 2, days: 90, extra: 1 })).toBe("ERR_VALIDATION");
    expect(await attempt("notARealSetting", 1)).toBe("ERR_VALIDATION");

    // §5.2 per-field ranges and the S-21 HH:mm format.
    expect(await attempt("noShowPenalty", { count: 99, days: 90 })).toBe("ERR_VALIDATION");
    expect(await attempt("noShowPenalty", { count: 2, days: 10 })).toBe("ERR_VALIDATION");
    expect(await attempt("waveSizes", [0, 25, 50])).toBe("ERR_VALIDATION");
    expect(await attempt("waveIntervalMin", { now: 0, today: 15, later: 30 })).toBe(
      "ERR_VALIDATION",
    );
    expect(await attempt("quietHours", { start: "25:00", end: "07:00" })).toBe("ERR_VALIDATION");

    // No refused attempt wrote anything or produced an audit row.
    expect((await stored("noShowPenalty"))?.value).toEqual({ count: 2, days: 90 });
    expect((await stored("waveSizes"))?.value).toEqual([10, 25, 50]);
    expect((await stored("quietHours"))?.value).toEqual({ start: "00:00", end: "07:00" });
    expect(await auditRows(t, "setting_changed")).toHaveLength(0);

    // Valid object/array updates succeed, are stored and audited as before.
    await admin.asUser.mutation(settingsUpdateRef, {
      key: "noShowPenalty", value: { count: 3, days: 60 }, reason: "Pilot tuning",
    });
    expect((await stored("noShowPenalty"))?.value).toEqual({ count: 3, days: 60 });
    await admin.asUser.mutation(settingsUpdateRef, {
      key: "waveSizes", value: [5, 15], reason: "Smaller pilot waves",
    });
    expect((await stored("waveSizes"))?.value).toEqual([5, 15]);
    await admin.asUser.mutation(settingsUpdateRef, {
      key: "pilotDistrictIds", value: ["district-1"], reason: "Pilot district",
    });
    expect((await stored("pilotDistrictIds"))?.value).toEqual(["district-1"]);
    await admin.asUser.mutation(settingsUpdateRef, {
      key: "quietHours", value: { start: "23:30", end: "06:45" }, reason: "Pilot hours",
    });
    expect((await stored("quietHours"))?.value).toEqual({ start: "23:30", end: "06:45" });
    expect(await auditRows(t, "setting_changed")).toHaveLength(4);

    // A refused attempt after a valid write leaves the stored value intact.
    expect(await attempt("noShowPenalty", "garbage")).toBe("ERR_VALIDATION");
    expect((await stored("noShowPenalty"))?.value).toEqual({ count: 3, days: 60 });
    expect(await auditRows(t, "setting_changed")).toHaveLength(4);
  });

  it("F-906: directory upsert validates phone/place and rebuilds search text", async () => {
    const t = newTest();
    await t.mutation(seedSettings, {});
    const places = await seedPlaces(t);
    const admin = await insertProfile(t, { name: "Admin", role: "admin" });
    const base = {
      nameEn: "New Clinic",
      nameBn: "নতুন ক্লিনিক",
      type: "clinic" as const,
      divisionId: places.divisionId,
      districtId: places.districtId,
      upazilaId: places.upazilaId,
      lat: 22.36,
      lng: 91.83,
      active: true,
    };
    expect(await admin.asUser.query(directoryListRef, {})).toEqual([]);
    expect(await codeOf(admin.asUser.mutation(directoryUpsertRef, base))).toBe("ERR_VALIDATION");
    await setFeature(t, "directoryUi", true);
    expect(
      await codeOf(admin.asUser.mutation(directoryUpsertRef, {
        ...base, bloodBankPhone: "123",
      })),
    ).toBe("ERR_VALIDATION");
    const out = (await admin.asUser.mutation(directoryUpsertRef, {
      ...base, bloodBankPhone: "0312551234",
    })) as { hospitalId: Id<"hospitals"> };
    const list = (await admin.asUser.query(directoryListRef, { search: "clinic" })) as {
      nameEn: string;
    }[];
    expect(list.map((h) => h.nameEn)).toEqual(["New Clinic"]);
    const doc = await t.run(async (ctx) => await ctx.db.get(out.hospitalId));
    expect(doc?.searchText).toContain("new clinic");
    expect(await auditRows(t, "directory_created")).toHaveLength(1);
  });

  it("F-907: FAQ approval needs both languages (VAL-24) and records approver + date; the assistant then answers", async () => {
    const t = newTest();
    await t.mutation(seedSettings, {});
    const admin = await insertProfile(t, { name: "Admin", role: "admin" });
    await setFeature(t, "faqUi", true);
    await setFeature(t, "assistant", true);

    const saved = (await admin.asUser.mutation(faqSaveRef, {
      questionEn: "Who can donate?",
      questionBn: "",
      answerEn: "Adults over 50 kg.",
      answerBn: "",
      tags: ["eligibility"],
    })) as { faqId: Id<"faqEntries"> };
    expect(
      await codeOf(admin.asUser.mutation(faqSetStatusRef, {
        faqId: saved.faqId, status: "approved",
      })),
    ).toBe("ERR_VALIDATION");
    await admin.asUser.mutation(faqSaveRef, {
      faqId: saved.faqId,
      questionEn: "Who can donate?",
      questionBn: "কে রক্ত দিতে পারবেন?",
      answerEn: "Adults over 50 kg.",
      answerBn: "৫০ কেজির বেশি ওজনের প্রাপ্তবয়স্করা।",
      tags: ["eligibility"],
    });
    await admin.asUser.mutation(faqSetStatusRef, { faqId: saved.faqId, status: "approved" });
    const entry = await t.run(async (ctx) => await ctx.db.get(saved.faqId));
    expect(entry?.status).toBe("approved");
    expect(entry?.approvedBy).toBe(admin.profileId);
    expect(entry?.approvedAt).toBeGreaterThanOrEqual(T0);

    const faqList = (await t.query(faqListRef, { lang: "en" })) as { question: string }[];
    expect(faqList).toHaveLength(1);

    // Editing an approved entry returns it to draft.
    await admin.asUser.mutation(faqSaveRef, {
      faqId: saved.faqId,
      questionEn: "Who can donate blood?",
      questionBn: "কে রক্ত দিতে পারবেন?",
      answerEn: "Adults over 50 kg.",
      answerBn: "৫০ কেজির বেশি ওজনের প্রাপ্তবয়স্করা।",
      tags: ["eligibility"],
    });
    const after = await t.run(async (ctx) => await ctx.db.get(saved.faqId));
    expect(after?.status).toBe("draft");
    expect(after?.approvedBy).toBeUndefined();
  });

  it("F-905: import creates invitations only with a per-row report; exports honour role + rate limit", async () => {
    const t = newTest();
    await t.mutation(seedSettings, {});
    const admin = await insertProfile(t, { name: "Admin", role: "admin" });
    const superadmin = await insertProfile(t, { name: "Super", role: "superadmin" });
    const csv = [
      "name,phone,bloodGroup,district,upazila,lastDonationDate,consentEvidence",
      "Rahim Uddin,01711111111,B+,Chattogram,Kotwali,2026-01-01,Paper form signed",
      "Bad Phone,123,B+,Chattogram,Kotwali,,Paper form signed",
      "No Consent,01722222222,O-,Chattogram,Kotwali,,",
      "Rahim Uddin,01711111111,B+,Chattogram,Kotwali,2026-01-01,Paper form signed",
    ].join("\n");

    expect(await codeOf(admin.asUser.mutation(importDonorsRef, { csv }))).toBe("ERR_VALIDATION");
    await setFeature(t, "dataImportExport", true);
    const report = (await admin.asUser.mutation(importDonorsRef, { csv })) as {
      created: number;
      skipped: number;
      invalid: { row: number; reason: string }[];
    };
    expect(report.created).toBe(1);
    expect(report.skipped).toBe(1); // the duplicate row
    expect(report.invalid.map((r) => r.reason).sort()).toEqual(["consentEvidence", "phone"]);
    const invites = await t.run(async (ctx) => await ctx.db.query("invitations").collect());
    expect(invites).toHaveLength(1);
    expect(invites[0].status).toBe("pending");
    // Nobody became a donor from the import.
    expect(await t.run(async (ctx) => await ctx.db.query("donorProfiles").collect()))
      .toHaveLength(0);

    // Anonymised export works for any admin and carries aggregates only.
    const anon = (await admin.asUser.mutation(exportDataRef, { kind: "anon_stats" })) as {
      url: string | null;
    };
    expect(anon.url).toContain("http");
    // Personal export: admin refused, super-admin allowed, 3/day cap.
    expect(await codeOf(admin.asUser.mutation(exportDataRef, { kind: "personal_data" })))
      .toBe("ERR_FORBIDDEN");
    for (let i = 0; i < 3; i++) {
      await superadmin.asUser.mutation(exportDataRef, { kind: "personal_data" });
    }
    expect(await codeOf(superadmin.asUser.mutation(exportDataRef, { kind: "personal_data" })))
      .toBe("ERR_RATE_LIMITED");
    expect(await auditRows(t, "data_exported")).toHaveLength(4);
  });

  it("F-908: weekly summary is aggregates-only, gated, and narrates deterministically without a key", async () => {
    const t = newTest();
    await t.mutation(seedSettings, {});
    const places = await seedPlaces(t);
    const admin = await insertProfile(t, { name: "Admin", role: "admin" });
    const member = await insertProfile(t, { name: "Member" });
    await insertRequest(t, places, member.profileId, {});

    expect(await admin.asUser.query(summaryCurrentRef, {})).toBeNull();
    await setFeature(t, "weeklySummary", true);
    vi.setSystemTime(T0 + 60_000);
    const current = (await admin.asUser.query(summaryCurrentRef, {})) as {
      aggregates: { requestsCreated: number; newMembers: number };
      paragraph: string;
    };
    expect(current.aggregates.requestsCreated).toBe(1);
    expect(current.aggregates.newMembers).toBe(2);
    expect(current.paragraph).toContain("1 new requests");
    const narrated = (await admin.asUser.action(summaryNarrateRef, {})) as {
      paragraph: string;
      aiUsed: boolean;
    };
    expect(narrated.aiUsed).toBe(false); // no GEMINI_API_KEY in tests
    expect(narrated.paragraph).toBe(current.paragraph);
    expect(await codeOf(member.asUser.query(summaryCurrentRef, {}))).toBe("ERR_FORBIDDEN");
  });

  it("F-307: email copies queue only for opted-in donors, only while emailAlerts is on", async () => {
    const t = newTest();
    await t.mutation(seedSettings, {});
    const places = await seedPlaces(t);
    const donorUser = await insertProfile(t, { name: "Donor" });
    const donorRowId = await insertDonorRow(t, places, donorUser.profileId);

    // Opt-in itself is gated.
    expect(
      await codeOf(donorUser.asUser.mutation(updateSettingsRef, { emailCopyOptIn: true })),
    ).toBe("ERR_VALIDATION");
    await setFeature(t, "emailAlerts", true);
    await donorUser.asUser.mutation(updateSettingsRef, { emailCopyOptIn: true });
    const donor = await t.run(async (ctx) => await ctx.db.get(donorRowId));
    expect(donor?.emailCopyOptIn).toBe(true);

    const { notifyUser } = await import("../convex/_lib/notify");
    const profile = await t.run(async (ctx) => await ctx.db.get(donorUser.profileId));
    await t.run(async (ctx) => {
      await notifyUser(ctx as never, {
        recipient: profile!,
        template: "NTF-01",
        params: { group: "B+", hospital: "Test Hospital" },
        url: "/alerts",
        channelId: "urgent-requests",
      });
    });
    const notes = await t.run(async (ctx) => await ctx.db.query("notifications").collect());
    const emailRows = notes.filter((n) => n.channel === "email");
    expect(emailRows).toHaveLength(1);
    expect(emailRows[0].status).toBe("queued");
    expect(emailRows[0].template).toBe("NTF-01");
  });
});
