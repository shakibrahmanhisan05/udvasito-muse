import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerPush } from "@convex-dev/expo-push-notifications/test";
import schema from "../convex/schema";
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
import { recordContactReveal } from "../convex/_lib/visibility";

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
};

const seedSettings = makeFunctionReference<"mutation">("seed:seedSettings");
const completeOnboarding = makeFunctionReference<"mutation">("profiles:completeOnboarding");
const donorsUpsert = makeFunctionReference<"mutation">("donors:upsert");
const donorsGetMine = makeFunctionReference<"query">("donors:getMine");
const donorsSetAvailability = makeFunctionReference<"mutation">("donors:setAvailability");
const requestsCreate = makeFunctionReference<"mutation">("requests:create");
const requestsGetForOwner = makeFunctionReference<"query">("requests:getForOwner");
const requestsClose = makeFunctionReference<"mutation">("requests:close");
const requestsUpdate = makeFunctionReference<"mutation">("requests:update");
const requestsReopen = makeFunctionReference<"mutation">("requests:reopen");
const requestsMarkNR = makeFunctionReference<"mutation">("requests:markDonorNotResponding");
const responsesAccept = makeFunctionReference<"mutation">("responses:accept");
const responsesWithdraw = makeFunctionReference<"mutation">("responses:withdraw");
const responsesAnswerSC = makeFunctionReference<"mutation">("responses:answerStillComing");
const responsesRecordOutcome = makeFunctionReference<"mutation">("responses:recordOutcome");
const responsesInbox = makeFunctionReference<"query">("responses:inbox");
const reportsCreate = makeFunctionReference<"mutation">("reports:create");
const blocksCreate = makeFunctionReference<"mutation">("blocks:create");
const hourlySweep = makeFunctionReference<"mutation">("lifecycle:hourlySweep");

const CONSENT_VERSION = "2026-11-28-pilot";
// 2026-11-29 12:00 Asia/Dhaka (06:00 UTC) — safely outside quiet hours.
const T0 = Date.parse("2026-11-29T06:00:00.000Z");
const MIN = 60_000;
const HOUR = 3_600_000;
let seq = 0;

function newTest() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  registerPush(t);
  return t;
}

type Test = ReturnType<typeof newTest>;

async function advance(t: Test, ms: number) {
  // convex-test only fires a scheduled job once the fake clock moves past
  // its due time, so a 0 ms advance would never run runAfter(0) jobs.
  vi.advanceTimersByTime(ms + 1);
  await t.finishInProgressScheduledFunctions();
}

async function seedAll(t: Test) {
  await t.mutation(seedSettings, {});
}

async function seedPlaces(t: Test) {
  return await t.run(async (ctx) => {
    const divisionId = await ctx.db.insert("places", {
      level: "division", code: "DIV-T", nameEn: "Chattogram", nameBn: "চট্টগ্রাম",
      lat: 22.7, lng: 91.7, isMetroThana: false, neighbourIds: [],
    });
    const districtId = await ctx.db.insert("places", {
      level: "district", code: "DIS-T", nameEn: "Chattogram", nameBn: "চট্টগ্রাম",
      parentId: divisionId, lat: 22.335, lng: 91.834, isMetroThana: false, neighbourIds: [],
    });
    const upazilaId = await ctx.db.insert("places", {
      level: "upazila", code: "UP-T1", nameEn: "Panchlaish", nameBn: "পাঁচলাইশ",
      parentId: districtId, lat: 22.373, lng: 91.829, isMetroThana: true, neighbourIds: [],
    });
    const upazila2Id = await ctx.db.insert("places", {
      level: "upazila", code: "UP-T2", nameEn: "Kotwali", nameBn: "কোতোয়ালী",
      parentId: districtId, lat: 22.343, lng: 91.832, isMetroThana: true, neighbourIds: [upazilaId],
    });
    await ctx.db.patch(upazilaId, { neighbourIds: [upazila2Id] });
    return { divisionId, districtId, upazilaId, upazila2Id };
  });
}

async function makeUser(t: Test, opts: { name?: string; phone?: string } = {}) {
  seq += 1;
  const subject = `user-${seq}`;
  const asUser = t.withIdentity({ subject, name: opts.name ?? "Test User" });
  await asUser.mutation(completeOnboarding, {
    name: opts.name ?? "Test User",
    dateOfBirth: "1995-05-01",
    phone: opts.phone ?? "01712345678",
    language: "en" as const,
    consentVersion: CONSENT_VERSION,
    consentAcceptedAt: Date.now(),
  });
  return { asUser, subject };
}

async function profileIdOf(t: Test, subject: string) {
  return await t.run(async (ctx) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", subject))
      .unique();
    return profile!._id;
  });
}

async function setPhoneVerified(t: Test, subject: string) {
  await t.run(async (ctx) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", subject))
      .unique();
    await ctx.db.patch(profile!._id, { phoneVerified: true, phoneVerifiedVia: "telegram" });
  });
}

async function patchDonor(t: Test, subject: string, patch: Record<string, unknown>) {
  await t.run(async (ctx) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", subject))
      .unique();
    const donor = await ctx.db
      .query("donorProfiles")
      .withIndex("by_profile", (q) => q.eq("profileId", profile!._id))
      .unique();
    await ctx.db.patch(donor!._id, patch as never);
  });
}

async function patchSetting(t: Test, key: string, value: unknown) {
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (row) await ctx.db.patch(row._id, { value });
    else await ctx.db.insert("settings", { key, value });
  });
}

async function makeDonor(
  t: Test,
  places: Awaited<ReturnType<typeof seedPlaces>>,
  opts: {
    group?: string; platelets?: boolean; upazilaId?: string;
    lastDonationDate?: string; lastDonationType?: "whole_blood" | "platelets";
  } = {},
) {
  const { asUser, subject } = await makeUser(t);
  await setPhoneVerified(t, subject);
  const res = await asUser.mutation(donorsUpsert, {
    bloodGroup: (opts.group ?? "B+") as never,
    gender: "male" as const,
    divisionId: places.divisionId as never,
    districtId: places.districtId as never,
    upazilaId: (opts.upazilaId ?? places.upazilaId) as never,
    travelRange: "district" as const,
    neverDonated: !opts.lastDonationDate,
    lastDonationDate: opts.lastDonationDate,
    lastDonationType: opts.lastDonationType,
    plateletOptIn: opts.platelets ?? false,
    callMode: "mutual" as const,
    checklist: { weight: true, health: true, screening: true },
    healthConsentVersion: CONSENT_VERSION,
  });
  expect(res.live).toBe(true);
  return { asUser, subject };
}

async function makeRequest(
  t: Test,
  asRequester: ReturnType<Test["withIdentity"]>,
  places: Awaited<ReturnType<typeof seedPlaces>>,
  opts: {
    group?: string; units?: number; component?: "whole_blood" | "platelets";
    neededBy?: number; isDengue?: boolean;
  } = {},
) {
  return await asRequester.mutation(requestsCreate, {
    clientId: `client-${Math.random().toString(36).slice(2)}`,
    bloodGroup: (opts.group ?? "B+") as never,
    component: opts.component ?? "whole_blood",
    isDengue: opts.isDengue ?? false,
    unitsNeeded: opts.units ?? 1,
    divisionId: places.divisionId as never,
    districtId: places.districtId as never,
    upazilaId: places.upazilaId as never,
    placeText: "Test Hospital Area",
    neededBy: opts.neededBy ?? Date.now() + 3 * HOUR,
    contactPhone: "01712345678",
    source: "form" as const,
    aiAssisted: false,
    lang: "en" as const,
  });
}

async function responsesOf(t: Test, requestId: string) {
  return await t.run(async (ctx) => {
    return await ctx.db
      .query("responses")
      .withIndex("by_request_state", (q) => q.eq("requestId", requestId as never))
      .collect();
  });
}

type RequestView = {
  status: string;
  escalatedAt?: number;
  revealsFrozen: boolean;
  unitsConfirmed: number;
  unitsNeeded: number;
  wave: number;
  closedAt?: number;
  closeReason?: string;
};

async function requestOf(t: Test, requestId: string): Promise<RequestView | null> {
  return await t.run(async (ctx) => {
    const doc = await ctx.db.get(requestId as never);
    return doc as unknown as RequestView | null;
  });
}

async function notificationsOf(t: Test, subject: string, template?: string) {
  const profileId = await profileIdOf(t, subject);
  return await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_recipient", (q) => q.eq("recipientId", profileId))
      .collect();
    return template ? rows.filter((r) => r.template === template) : rows;
  });
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "NO_THROW";
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code ?? String(e);
  }
}

async function responseOf(t: Test, requestId: string, subject: string) {
  const profileId = await profileIdOf(t, subject);
  const rows = await responsesOf(t, requestId);
  return rows.find((r) => r.donorId === profileId);
}

async function acceptAs(
  donor: { asUser: ReturnType<Test["withIdentity"]> },
  requestId: string,
  clientId: string,
) {
  return await donor.asUser.mutation(responsesAccept, {
    requestId: requestId as never,
    clientId,
    selfCheck: true,
    callMode: "mutual" as const,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Waves 2–3 (F-302) ───────────────────────────────────────────────
describe("waves (F-302)", () => {
  it("waves 1→2→3 fire at S-09 intervals for 'now'; the final wave adds compatible groups, labelled", async () => {
    const t = newTest();
    await seedAll(t);
    await patchSetting(t, "waveSizes", [2, 2, 2]);
    const places = await seedPlaces(t);
    const requester = await makeUser(t);
    await makeDonor(t, places, { group: "B+" });
    await makeDonor(t, places, { group: "B+" });
    await makeDonor(t, places, { group: "B+" });
    const compat = await makeDonor(t, places, { group: "O+" }); // compatible with B+
    await makeDonor(t, places, { group: "A+" }); // incompatible — never

    const { requestId } = await makeRequest(t, requester.asUser, places, {
      neededBy: Date.now() + HOUR, // urgency "now" → 5-minute intervals
    });
    await advance(t, 0); // startRequest → wave 1
    let responses = await responsesOf(t, requestId);
    expect(responses).toHaveLength(2);
    expect(responses.every((r) => r.wave === 1)).toBe(true);

    await advance(t, 4 * MIN); // too early for wave 2
    expect(await responsesOf(t, requestId)).toHaveLength(2);
    await advance(t, 1 * MIN); // wave 2 at +5 min: one exact donor remains
    responses = await responsesOf(t, requestId);
    expect(responses).toHaveLength(3);
    expect(responses.filter((r) => r.wave === 2)).toHaveLength(1);

    await advance(t, 5 * MIN); // wave 3 (final): compatible O+ joins
    responses = await responsesOf(t, requestId);
    expect(responses).toHaveLength(4);
    const compatResponse = responses.find((r) => r.wave === 3);
    expect(compatResponse).toBeDefined();
    const compatInbox = await compat.asUser.query(responsesInbox, {});
    const item = compatInbox.needsAnswer.find(
      (i: { requestId: string; compatibleGroup?: boolean }) => i.requestId === requestId,
    );
    expect(item?.compatibleGroup).toBe(true);
    // The wave_sent event records how many compatible donors were alerted.
    const events = await t.run(async (ctx) => await ctx.db.query("events").collect());
    const wave3 = events.find((e) => e.name === "wave_sent" && (e.props as { n: number }).n === 3);
    expect((wave3?.props as { compatible: number }).compatible).toBe(1);
  });

  it("the next wave shrinks by opened-but-unanswered donors", async () => {
    const t = newTest();
    await seedAll(t);
    await patchSetting(t, "waveSizes", [2, 3, 3]);
    const places = await seedPlaces(t);
    const requester = await makeUser(t);
    const opener = await makeDonor(t, places, {});
    await makeDonor(t, places, {});
    await makeDonor(t, places, {});
    await makeDonor(t, places, {});
    await makeDonor(t, places, {});

    const { requestId } = await makeRequest(t, requester.asUser, places, {
      neededBy: Date.now() + HOUR,
    });
    await advance(t, 0);
    expect(await responsesOf(t, requestId)).toHaveLength(2);
    // One wave-1 donor opens the alert but does not answer.
    const markOpened = makeFunctionReference<"mutation">("responses:markOpened");
    await opener.asUser.mutation(markOpened, { requestId: requestId as never });
    await advance(t, 5 * MIN); // wave 2 size = 3 − 1 opened = 2
    const responses = await responsesOf(t, requestId);
    expect(responses).toHaveLength(4);
    expect(responses.filter((r) => r.wave === 2)).toHaveLength(2);
  });

  it("escalate fires one interval after the final wave and notifies admins (F-704 hook)", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const admin = await makeUser(t, { name: "Admin One" });
    await t.run(async (ctx) => {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_authUserId", (q) => q.eq("authUserId", admin.subject))
        .unique();
      await ctx.db.patch(profile!._id, { role: "admin" });
    });
    const requester = await makeUser(t);
    // No donors at all for AB-.
    const { requestId } = await makeRequest(t, requester.asUser, places, {
      group: "AB-",
      neededBy: Date.now() + HOUR,
    });
    await advance(t, 0); // wave 1 (nobody)
    await advance(t, 5 * MIN); // wave 2
    await advance(t, 5 * MIN); // wave 3
    expect((await requestOf(t, requestId))?.escalatedAt).toBeUndefined();
    await advance(t, 5 * MIN); // escalate
    const request = await requestOf(t, requestId);
    expect(request?.escalatedAt).toBeDefined();
    expect(await notificationsOf(t, admin.subject, "NTF-07")).toHaveLength(1);
    await advance(t, 30 * MIN); // never twice
    expect(await notificationsOf(t, admin.subject, "NTF-07")).toHaveLength(1);
  });
});

// ─── Filters (F-301) ─────────────────────────────────────────────────
describe("matching filters (F-301)", () => {
  it("quiet hours hold (S-21); an opted-in donor is alerted for a 'now' request", async () => {
    vi.setSystemTime(Date.parse("2026-11-28T21:00:00.000Z")); // 03:00 in Dhaka
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const quiet = await makeDonor(t, places, {});
    const override = await makeDonor(t, places, {});
    await patchDonor(t, override.subject, { urgentOverride: true });
    const requester = await makeUser(t);

    // "later" request during quiet hours: nobody is alerted.
    const later = await makeRequest(t, requester.asUser, places, {
      neededBy: Date.now() + 3 * 24 * HOUR,
    });
    await advance(t, 0);
    expect(await responsesOf(t, later.requestId)).toHaveLength(0);

    // "now" request: only the opted-in donor is alerted.
    const requester2 = await makeUser(t);
    const now = await makeRequest(t, requester2.asUser, places, {
      neededBy: Date.now() + HOUR,
    });
    await advance(t, 0);
    const responses = await responsesOf(t, now.requestId);
    expect(responses).toHaveLength(1);
    const quietResponses = await t.run(async (ctx) => {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_authUserId", (q) => q.eq("authUserId", quiet.subject))
        .unique();
      return await ctx.db
        .query("responses")
        .withIndex("by_donor_state", (q) => q.eq("donorId", profile!._id))
        .collect();
    });
    expect(quietResponses).toHaveLength(0);
  });

  it("the daily alert cap holds (S-20)", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const donor = await makeDonor(t, places, {});
    await patchDonor(t, donor.subject, { alertCapPerDay: 1 });
    const r1 = await makeUser(t);
    const r2 = await makeUser(t);

    const first = await makeRequest(t, r1.asUser, places, {});
    await advance(t, 0);
    expect(await responsesOf(t, first.requestId)).toHaveLength(1);

    const second = await makeRequest(t, r2.asUser, places, {});
    await advance(t, 0);
    expect(await responsesOf(t, second.requestId)).toHaveLength(0);
  });

  it("'verified requests only' donors skip unverified requesters", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const donor = await makeDonor(t, places, {});
    await patchDonor(t, donor.subject, { verifiedRequestsOnly: true });

    const unverified = await makeUser(t); // phone not verified
    const reqA = await makeRequest(t, unverified.asUser, places, {});
    await advance(t, 0);
    expect(await responsesOf(t, reqA.requestId)).toHaveLength(0);

    const verified = await makeUser(t);
    await setPhoneVerified(t, verified.subject);
    const reqB = await makeRequest(t, verified.asUser, places, {});
    await advance(t, 0);
    expect(await responsesOf(t, reqB.requestId)).toHaveLength(1);
  });

  it("platelet requests reach only platelet-opt-in donors with the exact group, 14-day rule (F-204)", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const optedIn = await makeDonor(t, places, { group: "B+", platelets: true });
    await makeDonor(t, places, { group: "B+", platelets: false });
    await makeDonor(t, places, { group: "B-", platelets: true });
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * HOUR).toISOString().slice(0, 10);
    await makeDonor(t, places, {
      group: "B+", platelets: true,
      lastDonationDate: tenDaysAgo, lastDonationType: "platelets",
    });
    const requester = await makeUser(t);
    const { requestId } = await makeRequest(t, requester.asUser, places, {
      component: "platelets",
      isDengue: true,
    });
    await advance(t, 0);
    const responses = await responsesOf(t, requestId);
    expect(responses).toHaveLength(1);
    const donorProfile = await t.run(async (ctx) =>
      await ctx.db.get(responses[0].donorProfileId),
    );
    const owner = await t.run(async (ctx) => await ctx.db.get(donorProfile!.profileId));
    const optedInId = await profileIdOf(t, optedIn.subject);
    expect(owner!._id).toBe(optedInId);
  });
});

// ─── Still coming (F-405) ────────────────────────────────────────────
describe("still coming (F-405)", () => {
  // S-12: the first units+1 acceptors are confirmed, so with 1 unit the
  // first TWO donors are confirmed and the third is the standby.
  async function setupConfirmed(t: Test) {
    await seedAll(t);
    const places = await seedPlaces(t);
    const requester = await makeUser(t);
    const d1 = await makeDonor(t, places, {});
    const d2 = await makeDonor(t, places, {});
    const d3 = await makeDonor(t, places, {});
    const { requestId } = await makeRequest(t, requester.asUser, places, {
      neededBy: Date.now() + HOUR, // urgency "now": S-15 = 10 min
    });
    await advance(t, 0);
    await acceptAs(d1, requestId, "sc-a1");
    await acceptAs(d2, requestId, "sc-a2");
    await acceptAs(d3, requestId, "sc-a3"); // standby
    expect((await responseOf(t, requestId, d3.subject))?.state).toBe("standby");
    return { places, requester, d1, d2, d3, requestId };
  }

  it("timeout promotes the first standby; the original donor stays confirmed", async () => {
    const t = newTest();
    const { d1, d3, requestId } = await setupConfirmed(t);
    await advance(t, 10 * MIN); // still-coming check fires (S-15)
    const asked = await responseOf(t, requestId, d1.subject);
    expect(asked?.stillComingAskedAt).toBeDefined();
    expect(await notificationsOf(t, d1.subject, "NTF-08")).toHaveLength(1);

    await advance(t, 5 * MIN); // answer window S-16 expires in silence
    const r1 = await responseOf(t, requestId, d1.subject);
    const r3 = await responseOf(t, requestId, d3.subject);
    expect(r1?.state).toBe("confirmed"); // original stays
    expect(r3?.state).toBe("confirmed"); // standby promoted in addition
    expect(await notificationsOf(t, d3.subject, "NTF-16")).toHaveLength(1);
  });

  it("'can't make it' runs the withdraw flow and promotes the standby", async () => {
    const t = newTest();
    const { d1, d3, requestId } = await setupConfirmed(t);
    await advance(t, 10 * MIN);
    const asked = await responseOf(t, requestId, d1.subject);
    await d1.asUser.mutation(responsesAnswerSC, {
      responseId: asked!._id as never,
      answer: "cant" as const,
    });
    expect((await responseOf(t, requestId, d1.subject))?.state).toBe("withdrew");
    expect((await responseOf(t, requestId, d3.subject))?.state).toBe("confirmed");
  });

  it("'yes' answers leave the confirmed donors in place and nobody is promoted", async () => {
    const t = newTest();
    const { d1, d2, d3, requestId } = await setupConfirmed(t);
    await advance(t, 10 * MIN);
    for (const d of [d1, d2]) {
      const asked = await responseOf(t, requestId, d.subject);
      await d.asUser.mutation(responsesAnswerSC, {
        responseId: asked!._id as never,
        answer: "yes" as const,
      });
    }
    await advance(t, 5 * MIN);
    expect((await responseOf(t, requestId, d1.subject))?.state).toBe("confirmed");
    expect((await responseOf(t, requestId, d3.subject))?.state).toBe("standby");
  });
});

// ─── Withdraw + not responding (F-405/F-406) ─────────────────────────
describe("withdraw and not-responding (F-405/F-406)", () => {
  it("withdraw promotes the standby at once", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const requester = await makeUser(t);
    const d1 = await makeDonor(t, places, {});
    const d2 = await makeDonor(t, places, {});
    const d3 = await makeDonor(t, places, {});
    const { requestId } = await makeRequest(t, requester.asUser, places, {});
    await advance(t, 0);
    await acceptAs(d1, requestId, "w-a1");
    await acceptAs(d2, requestId, "w-a2"); // second confirmed slot (S-12)
    await acceptAs(d3, requestId, "w-a3"); // standby
    const mine = await responseOf(t, requestId, d1.subject);
    await d1.asUser.mutation(responsesWithdraw, { responseId: mine!._id as never });
    expect((await responseOf(t, requestId, d1.subject))?.state).toBe("withdrew");
    expect((await responseOf(t, requestId, d3.subject))?.state).toBe("confirmed");
    const request = await requestOf(t, requestId);
    expect(request?.unitsConfirmed).toBe(1);
    expect(request?.status).toBe("covered");
  });

  it("withdraw with no standby runs the next wave at once", async () => {
    const t = newTest();
    await seedAll(t);
    await patchSetting(t, "waveSizes", [1, 2, 2]);
    const places = await seedPlaces(t);
    const requester = await makeUser(t);
    const d1 = await makeDonor(t, places, {});
    await makeDonor(t, places, {});
    await makeDonor(t, places, {});
    const { requestId } = await makeRequest(t, requester.asUser, places, {
      neededBy: Date.now() + HOUR,
    });
    await advance(t, 0);
    expect(await responsesOf(t, requestId)).toHaveLength(1); // wave 1 = 1 donor
    await acceptAs(d1, requestId, "w-b1");
    const mine = await responseOf(t, requestId, d1.subject);
    await d1.asUser.mutation(responsesWithdraw, { responseId: mine!._id as never });
    // No clock advance: the next wave already ran.
    const responses = await responsesOf(t, requestId);
    expect(responses).toHaveLength(3);
    expect(responses.filter((r) => r.wave === 2)).toHaveLength(2);
    expect((await requestOf(t, requestId))?.status).toBe("live");
  });

  it("requester marks a donor not responding: standby confirmed, no-show recorded (F-406)", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const requester = await makeUser(t);
    const d1 = await makeDonor(t, places, {});
    const d2 = await makeDonor(t, places, {});
    const d3 = await makeDonor(t, places, {});
    const { requestId } = await makeRequest(t, requester.asUser, places, {});
    await advance(t, 0);
    await acceptAs(d1, requestId, "nr-a1");
    await acceptAs(d2, requestId, "nr-a2");
    await acceptAs(d3, requestId, "nr-a3"); // standby
    const mine = await responseOf(t, requestId, d1.subject);
    await requester.asUser.mutation(requestsMarkNR, {
      requestId: requestId as never,
      responseId: mine!._id as never,
    });
    expect((await responseOf(t, requestId, d1.subject))?.state).toBe("not_responding");
    expect((await responseOf(t, requestId, d3.subject))?.state).toBe("confirmed");
    const donorDoc = await t.run(async (ctx) => {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_authUserId", (q) => q.eq("authUserId", d1.subject))
        .unique();
      return await ctx.db
        .query("donorProfiles")
        .withIndex("by_profile", (q) => q.eq("profileId", profile!._id))
        .unique();
    });
    expect(donorDoc?.noShowAt).toHaveLength(1);
  });
});

// ─── Lifecycle: update / reopen / auto-close (F-501) ─────────────────
describe("request lifecycle (F-501)", () => {
  it("need-more while covered promotes the standby into the new S-12 slot and stays covered", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const requester = await makeUser(t);
    const d1 = await makeDonor(t, places, {});
    const d2 = await makeDonor(t, places, {});
    const d3 = await makeDonor(t, places, {});
    const { requestId } = await makeRequest(t, requester.asUser, places, { units: 1 });
    await advance(t, 0);
    await acceptAs(d1, requestId, "u-a1");
    await acceptAs(d2, requestId, "u-a2");
    await acceptAs(d3, requestId, "u-a3"); // standby
    expect((await requestOf(t, requestId))?.status).toBe("covered");
    await requester.asUser.mutation(requestsUpdate, {
      requestId: requestId as never,
      unitsNeeded: 2,
    });
    const request = await requestOf(t, requestId);
    expect(request?.unitsConfirmed).toBe(2);
    expect(request?.status).toBe("covered");
    expect((await responseOf(t, requestId, d3.subject))?.state).toBe("confirmed");
  });

  it("reopen within S-34 re-runs matching for not-yet-notified donors; after the window it refuses", async () => {
    const t = newTest();
    await seedAll(t);
    await patchSetting(t, "waveSizes", [1, 1, 1]);
    const places = await seedPlaces(t);
    const requester = await makeUser(t);
    await makeDonor(t, places, {});
    await makeDonor(t, places, {});
    const { requestId } = await makeRequest(t, requester.asUser, places, {});
    await advance(t, 0);
    expect(await responsesOf(t, requestId)).toHaveLength(1);
    await requester.asUser.mutation(requestsClose, {
      requestId: requestId as never,
      reason: "fulfilled" as const,
    });
    expect(
      await codeOf(
        requester.asUser.mutation(requestsUpdate, {
          requestId: requestId as never,
          unitsNeeded: 2,
        }),
      ),
    ).toBe("ERR_REQUEST_CLOSED");
    await requester.asUser.mutation(requestsReopen, { requestId: requestId as never });
    await advance(t, 0);
    expect((await requestOf(t, requestId))?.status).toBe("live");
    expect(await responsesOf(t, requestId)).toHaveLength(2); // second donor now notified

    await requester.asUser.mutation(requestsClose, {
      requestId: requestId as never,
      reason: "not_needed" as const,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(requestId as never, { closedAt: Date.now() - 25 * HOUR });
    });
    expect(
      await codeOf(requester.asUser.mutation(requestsReopen, { requestId: requestId as never })),
    ).toBe("ERR_REQUEST_CLOSED");
  });

  it("auto-close fires at needed-by + S-17 with reason expired", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const requester = await makeUser(t);
    const { requestId } = await makeRequest(t, requester.asUser, places, {
      neededBy: Date.now() + HOUR,
    });
    await advance(t, 0);
    await advance(t, HOUR + 6 * HOUR - 10 * MIN); // just before the deadline
    expect((await requestOf(t, requestId))?.status).toBe("live");
    await advance(t, 15 * MIN); // past needed-by + 6 h
    const request = await requestOf(t, requestId);
    expect(request?.status).toBe("closed");
    expect(request?.closeReason).toBe("expired");
  });
});

// ─── Confirmation + cooldown (F-502/F-503) ───────────────────────────
describe("donation confirmation and cooldown (F-502/F-503)", () => {
  it("prompt at S-19; cooldown starts ONLY from the donor's own confirmation", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const requester = await makeUser(t);
    const d1 = await makeDonor(t, places, {});
    // Needed in 3 days so the S-17 auto-close stays out of this test's way.
    const { requestId } = await makeRequest(t, requester.asUser, places, {
      neededBy: Date.now() + 3 * 24 * HOUR,
    });
    await advance(t, 0);
    await acceptAs(d1, requestId, "cf-a1");
    const response = await responseOf(t, requestId, d1.subject);

    // The REQUESTER says the donation happened — no cooldown may start.
    await requester.asUser.mutation(responsesRecordOutcome, {
      requestId: requestId as never,
      responseId: response!._id as never,
      outcome: "donated" as const,
    });
    let mine = await d1.asUser.query(donorsGetMine, {});
    expect(mine.eligibleFrom).toBe(0);

    // S-19 later the prompt fires: the donor (no outcome yet) is asked;
    // the requester already answered, so they are not asked again.
    await advance(t, 24 * HOUR);
    expect(await notificationsOf(t, d1.subject, "NTF-10")).toHaveLength(1);
    expect(await notificationsOf(t, requester.subject, "NTF-10")).toHaveLength(0);

    // The DONOR confirms → cooldown starts (male, whole blood: +90 days).
    await d1.asUser.mutation(responsesRecordOutcome, {
      requestId: requestId as never,
      outcome: "donated" as const,
    });
    mine = await d1.asUser.query(donorsGetMine, {});
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    expect(mine.donor?.lastDonationDate).toBe(today);
    expect(mine.eligibleFrom).toBe(Date.parse(`${today}T00:00:00.000Z`) + 90 * 24 * HOUR);

    // The reminder finds every outcome recorded — no second prompt.
    await advance(t, 24 * HOUR);
    expect(await notificationsOf(t, d1.subject, "NTF-10")).toHaveLength(1);
  });

  it("'did not donate' records the outcome but starts no cooldown", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const requester = await makeUser(t);
    const d1 = await makeDonor(t, places, {});
    const { requestId } = await makeRequest(t, requester.asUser, places, {});
    await advance(t, 0);
    await acceptAs(d1, requestId, "cf-b1");
    await d1.asUser.mutation(responsesRecordOutcome, {
      requestId: requestId as never,
      outcome: "did_not_donate" as const,
    });
    const mine = await d1.asUser.query(donorsGetMine, {});
    expect(mine.eligibleFrom).toBe(0);
    expect(mine.donor?.lastDonationDate).toBeUndefined();
  });
});

// ─── Availability (F-602) ────────────────────────────────────────────
describe("availability (F-602)", () => {
  it("a paused donor is skipped; the hourly sweep resumes them with NTF-13; VAL-20 holds", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const donor = await makeDonor(t, places, {});
    await donor.asUser.mutation(donorsSetAvailability, {
      availability: "paused" as const,
      pausedUntil: Date.now() + 7 * 24 * HOUR,
    });
    expect(
      await codeOf(
        donor.asUser.mutation(donorsSetAvailability, {
          availability: "paused" as const,
          pausedUntil: Date.now() + 200 * 24 * HOUR,
        }),
      ),
    ).toBe("ERR_VALIDATION");
    expect(
      await codeOf(
        donor.asUser.mutation(donorsSetAvailability, {
          availability: "paused" as const,
          pausedUntil: Date.now() + 12 * HOUR, // under the 1-day VAL-20 floor
        }),
      ),
    ).toBe("ERR_VALIDATION");

    const requester = await makeUser(t);
    const { requestId } = await makeRequest(t, requester.asUser, places, {});
    await advance(t, 0);
    expect(await responsesOf(t, requestId)).toHaveLength(0);

    vi.setSystemTime(T0 + 7 * 24 * HOUR + HOUR);
    await t.mutation(hourlySweep, {});
    const mine = await donor.asUser.query(donorsGetMine, {});
    expect(mine.donor?.availability).toBe("available");
    expect(await notificationsOf(t, donor.subject, "NTF-13")).toHaveLength(1);
  });
});

// ─── Report & block (F-801) + reveal limits (F-802) ──────────────────
describe("report & block (F-801) and reveal limits (F-802)", () => {
  it("a money report freezes the account; a frozen member cannot post but can view their own request (G6)", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const admin = await makeUser(t, { name: "Admin One" });
    await t.run(async (ctx) => {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_authUserId", (q) => q.eq("authUserId", admin.subject))
        .unique();
      await ctx.db.patch(profile!._id, { role: "admin" });
    });
    const subject = await makeUser(t, { name: "Subject One" });
    const { requestId } = await makeRequest(t, subject.asUser, places, {});
    const reporter = await makeUser(t, { name: "Reporter One" });
    const subjectId = await profileIdOf(t, subject.subject);

    const result = await reporter.asUser.mutation(reportsCreate, {
      subjectId: subjectId as never,
      reason: "money" as const,
      block: false,
    });
    expect(result.autoAction).toBe("account_frozen");
    const frozen = await t.run(async (ctx) => await ctx.db.get(subjectId as never));
    expect((frozen as unknown as { status: string }).status).toBe("frozen");
    const audits = await t.run(async (ctx) => await ctx.db.query("auditLog").collect());
    expect(audits.some((a) => a.action === "account_frozen_auto")).toBe(true);
    expect(await notificationsOf(t, admin.subject, "NTF-17")).toHaveLength(1);

    // Cannot post while frozen…
    expect(
      await codeOf(makeRequest(t, subject.asUser, places, {})),
    ).toBe("ERR_FROZEN");
    // …but can still view their own request read-only (gate G6).
    const view = await subject.asUser.query(requestsGetForOwner, {
      requestId: requestId as never,
    });
    expect(view.request._id).toBe(requestId);
  });

  it("a confirmed donor's fake report freezes the request's reveals; a bystander's does not", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const requester = await makeUser(t);
    const donor = await makeDonor(t, places, {});
    const bystander = await makeUser(t, { name: "By Stander" });
    const { requestId } = await makeRequest(t, requester.asUser, places, {});
    await advance(t, 0);
    await acceptAs(donor, requestId, "fb-a1");
    const requesterId = await profileIdOf(t, requester.subject);

    const noAuto = await bystander.asUser.mutation(reportsCreate, {
      subjectId: requesterId as never,
      requestId: requestId as never,
      reason: "fake" as const,
      block: false,
    });
    expect(noAuto.autoAction).toBeUndefined();
    expect((await requestOf(t, requestId))?.revealsFrozen).toBe(false);

    const auto = await donor.asUser.mutation(reportsCreate, {
      subjectId: requesterId as never,
      requestId: requestId as never,
      reason: "fake" as const,
      block: true,
    });
    expect(auto.autoAction).toBe("reveals_frozen");
    expect((await requestOf(t, requestId))?.revealsFrozen).toBe(true);
    const blocks = await t.run(async (ctx) => await ctx.db.query("blocks").collect());
    expect(blocks).toHaveLength(1);
  });

  it("reports are rate-limited to 10 per day", async () => {
    const t = newTest();
    await seedAll(t);
    const subject = await makeUser(t, { name: "Subject Two" });
    const reporter = await makeUser(t, { name: "Reporter Two" });
    const subjectId = await profileIdOf(t, subject.subject);
    for (let i = 0; i < 10; i++) {
      await reporter.asUser.mutation(reportsCreate, {
        subjectId: subjectId as never,
        reason: "other" as const,
        block: false,
      });
    }
    expect(
      await codeOf(
        reporter.asUser.mutation(reportsCreate, {
          subjectId: subjectId as never,
          reason: "other" as const,
          block: false,
        }),
      ),
    ).toBe("ERR_RATE_LIMITED");
  });

  it("blocks.create stops matching between the pair", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const requester = await makeUser(t);
    const donor = await makeDonor(t, places, {});
    const donorId = await profileIdOf(t, donor.subject);
    await requester.asUser.mutation(blocksCreate, { profileId: donorId as never });
    const { requestId } = await makeRequest(t, requester.asUser, places, {});
    await advance(t, 0);
    expect(await responsesOf(t, requestId)).toHaveLength(0);
  });

  it("the requester reveal cap (S-23) withholds the second donor's number but still confirms them", async () => {
    const t = newTest();
    await seedAll(t);
    await patchSetting(t, "revealsPerRequesterPerDay", 1);
    const places = await seedPlaces(t);
    const requester = await makeUser(t);
    await setPhoneVerified(t, requester.subject); // open limit 2
    const d1 = await makeDonor(t, places, {});
    const d2 = await makeDonor(t, places, {});
    const a = await makeRequest(t, requester.asUser, places, {});
    const b = await makeRequest(t, requester.asUser, places, {});
    await advance(t, 0);
    await acceptAs(d1, a.requestId, "cap-a1");
    await acceptAs(d2, b.requestId, "cap-a2");
    expect((await responseOf(t, b.requestId, d2.subject))?.state).toBe("confirmed");
    const requesterId = await profileIdOf(t, requester.subject);
    const reveals = await t.run(async (ctx) => {
      return await ctx.db
        .query("contactReveals")
        .withIndex("by_viewer_request", (q) => q.eq("viewerId", requesterId))
        .collect();
    });
    expect(reveals).toHaveLength(1); // only the first donor's number
    const viewB = await requester.asUser.query(requestsGetForOwner, {
      requestId: b.requestId as never,
    });
    expect(viewB.confirmedDonors).toHaveLength(1);
    expect(viewB.confirmedDonors[0].phone).toBeUndefined();
  });
});

describe("reveal-volume flag (S-24)", () => {
  it("staff-side reveals past the daily threshold raise one moderation flag", async () => {
    const t = newTest();
    await seedAll(t);
    await patchSetting(t, "revealFlagPerDay", 2);
    const places = await seedPlaces(t);
    const requester = await makeUser(t);
    const { requestId } = await makeRequest(t, requester.asUser, places, {});
    const admin = await makeUser(t, { name: "Admin Two" });
    const subject = await makeUser(t, { name: "Subject Three" });
    await t.run(async (ctx) => {
      const viewer = await ctx.db
        .query("profiles")
        .withIndex("by_authUserId", (q) => q.eq("authUserId", admin.subject))
        .unique();
      const target = await ctx.db
        .query("profiles")
        .withIndex("by_authUserId", (q) => q.eq("authUserId", subject.subject))
        .unique();
      for (let i = 0; i < 3; i++) {
        await recordContactReveal(ctx, {
          viewer: viewer!,
          subject: target!,
          subjectRole: "donor",
          requestId: requestId as never,
          reason: "admin_reveal",
          reasonText: "test",
          expiresAt: Date.now() + HOUR,
          isDemo: false,
        });
      }
    });
    const flags = await t.run(async (ctx) => {
      const items = await ctx.db.query("moderationItems").collect();
      return items.filter((i) => i.kind === "reveal_volume");
    });
    expect(flags).toHaveLength(1); // exactly at the crossing (threshold 2 → 3rd reveal)
  });
});
