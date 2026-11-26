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
import * as phoneVerificationModule from "../convex/phoneVerification";
import * as volunteersModule from "../convex/volunteers";
import * as adminPeopleModule from "../convex/admin/people";
import * as retentionModule from "../convex/retention";

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
};

const seedSettings = makeFunctionReference<"mutation">("seed:seedSettings");
const completeOnboarding = makeFunctionReference<"mutation">("profiles:completeOnboarding");
const donorsUpsert = makeFunctionReference<"mutation">("donors:upsert");
const requestsCreate = makeFunctionReference<"mutation">("requests:create");
const requestsGetForOwner = makeFunctionReference<"query">("requests:getForOwner");
const requestsMarkNR = makeFunctionReference<"mutation">("requests:markDonorNotResponding");
const responsesAccept = makeFunctionReference<"mutation">("responses:accept");
const responsesWithdraw = makeFunctionReference<"mutation">("responses:withdraw");
const escalate = makeFunctionReference<"mutation">("matching:escalate");
const volunteerHotline = makeFunctionReference<"mutation">("matching:volunteerHotline");
const volunteersApply = makeFunctionReference<"mutation">("volunteers:apply");
const volunteersGetMine = makeFunctionReference<"query">("volunteers:getMine");
const volunteersSetOnDuty = makeFunctionReference<"mutation">("volunteers:setOnDuty");
const volunteersSetAreas = makeFunctionReference<"mutation">("volunteers:setAreas");
const volunteersBoard = makeFunctionReference<"query">("volunteers:board");
const volunteersGetRequest = makeFunctionReference<"query">("volunteers:getRequest");
const volunteersOpenCase = makeFunctionReference<"mutation">("volunteers:openCase");
const volunteersClaim = makeFunctionReference<"mutation">("volunteers:claim");
const volunteersUnclaim = makeFunctionReference<"mutation">("volunteers:unclaim");
const volunteersSearchDonors = makeFunctionReference<"mutation">("volunteers:searchDonors");
const volunteersAskDonor = makeFunctionReference<"mutation">("volunteers:askDonor");
const volunteersRevealOptIn = makeFunctionReference<"mutation">("volunteers:revealOptInDonor");
const donorsUpdateSettings = makeFunctionReference<"mutation">("donors:updateSettings");
const peopleApplications = makeFunctionReference<"query">("admin/people:applications");
const peopleReview = makeFunctionReference<"mutation">("admin/people:reviewVolunteer");
const peopleSearch = makeFunctionReference<"query">("admin/people:search");
const peopleGet = makeFunctionReference<"query">("admin/people:get");
const peopleSetRole = makeFunctionReference<"mutation">("admin/people:setRole");
const peopleSetStatus = makeFunctionReference<"mutation">("admin/people:setStatus");
const peopleRevealPhone = makeFunctionReference<"mutation">("admin/people:revealPhone");
const peopleRevokeVerification = makeFunctionReference<"mutation">("admin/people:revokeVerification");
const pvStartInPerson = makeFunctionReference<"mutation">("phoneVerification:startInPerson");
const pvLookupInPerson = makeFunctionReference<"query">("phoneVerification:lookupInPerson");
const pvConfirmInPerson = makeFunctionReference<"mutation">("phoneVerification:confirmInPerson");
const profilesWhoHasMyNumber = makeFunctionReference<"query">("profiles:whoHasMyNumber");
const profilesRequestDeletion = makeFunctionReference<"mutation">("profiles:requestDeletion");
const profilesCancelDeletion = makeFunctionReference<"mutation">("profiles:cancelDeletion");
const profilesExportMyData = makeFunctionReference<"mutation">("profiles:exportMyData");
const retentionDaily = makeFunctionReference<"mutation">("retention:daily");
const requestsClose = makeFunctionReference<"mutation">("requests:close");

const CONSENT_VERSION = "2026-11-28-pilot";
// 2026-11-29 12:00 Asia/Dhaka (06:00 UTC) — safely outside quiet hours.
const T0 = Date.parse("2026-11-29T06:00:00.000Z");
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
let seq = 0;

function newTest() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  registerPush(t);
  return t;
}

type Test = ReturnType<typeof newTest>;

async function advance(t: Test, ms: number) {
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
    const district2Id = await ctx.db.insert("places", {
      level: "district", code: "DIS-T2", nameEn: "Cox's Bazar", nameBn: "কক্সবাজার",
      parentId: divisionId, lat: 21.916, lng: 92.0, isMetroThana: false, neighbourIds: [],
    });
    const upazilaId = await ctx.db.insert("places", {
      level: "upazila", code: "UP-T1", nameEn: "Panchlaish", nameBn: "পাঁচলাইশ",
      parentId: districtId, lat: 22.373, lng: 91.829, isMetroThana: true, neighbourIds: [],
    });
    const upazila2Id = await ctx.db.insert("places", {
      level: "upazila", code: "UP-T2", nameEn: "Kotwali", nameBn: "কোতোয়ালী",
      parentId: districtId, lat: 22.343, lng: 91.832, isMetroThana: true, neighbourIds: [upazilaId],
    });
    const upazila3Id = await ctx.db.insert("places", {
      level: "upazila", code: "UP-T3", nameEn: "Cox's Bazar Sadar", nameBn: "কক্সবাজার সদর",
      parentId: district2Id, lat: 21.916, lng: 92.0, isMetroThana: false, neighbourIds: [],
    });
    await ctx.db.patch(upazilaId, { neighbourIds: [upazila2Id] });
    return { divisionId, districtId, district2Id, upazilaId, upazila2Id, upazila3Id };
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

async function setRole(t: Test, subject: string, role: string) {
  await t.run(async (ctx) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", subject))
      .unique();
    await ctx.db.patch(profile!._id, { role: role as never });
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
    group?: string; platelets?: boolean; upazilaId?: string; districtId?: string;
    phone?: string; name?: string;
  } = {},
) {
  const { asUser, subject } = await makeUser(t, { phone: opts.phone, name: opts.name });
  await setPhoneVerified(t, subject);
  const districtId = opts.districtId ?? places.districtId;
  const res = await asUser.mutation(donorsUpsert, {
    bloodGroup: (opts.group ?? "B+") as never,
    gender: "male" as const,
    divisionId: places.divisionId as never,
    districtId: districtId as never,
    upazilaId: (opts.upazilaId ?? places.upazilaId) as never,
    travelRange: "district" as const,
    neverDonated: true,
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
    group?: string; units?: number; neededBy?: number; note?: string;
    upazilaId?: string; districtId?: string; contactPhone?: string;
    patientName?: string;
  } = {},
) {
  return await asRequester.mutation(requestsCreate, {
    clientId: `client-${Math.random().toString(36).slice(2)}`,
    bloodGroup: (opts.group ?? "B+") as never,
    component: "whole_blood" as const,
    isDengue: false,
    unitsNeeded: opts.units ?? 1,
    divisionId: places.divisionId as never,
    districtId: (opts.districtId ?? places.districtId) as never,
    upazilaId: (opts.upazilaId ?? places.upazilaId) as never,
    placeText: "Test Hospital Area",
    neededBy: opts.neededBy ?? Date.now() + 3 * HOUR,
    contactPhone: opts.contactPhone ?? "01712345678",
    patientName: opts.patientName,
    note: opts.note,
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

async function responseOf(t: Test, requestId: string, subject: string) {
  const profileId = await profileIdOf(t, subject);
  const rows = await responsesOf(t, requestId);
  return rows.find((r) => r.donorId === profileId);
}

async function revealsOf(t: Test, requestId?: string) {
  return await t.run(async (ctx) => {
    const rows = await ctx.db.query("contactReveals").collect();
    return requestId ? rows.filter((r) => r.requestId === requestId) : rows;
  });
}

async function eventsOf(t: Test, name?: string) {
  return await t.run(async (ctx) => {
    const rows = await ctx.db.query("events").collect();
    return name ? rows.filter((e) => e.name === name) : rows;
  });
}

async function auditsOf(t: Test, action?: string) {
  return await t.run(async (ctx) => {
    const rows = await ctx.db.query("auditLog").collect();
    return action ? rows.filter((a) => a.action === action) : rows;
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

/** An approved volunteer, set up directly (the review flow is tested
 * against admin.people in its own suite below). */
async function makeVolunteer(
  t: Test,
  places: Awaited<ReturnType<typeof seedPlaces>>,
  opts: { name?: string; phone?: string; onDuty?: boolean; wholeDistrict?: boolean } = {},
) {
  const user = await makeUser(t, { name: opts.name ?? "Nusrat Jahan", phone: opts.phone });
  await setPhoneVerified(t, user.subject);
  await setRole(t, user.subject, "volunteer");
  const profileId = await profileIdOf(t, user.subject);
  await t.run(async (ctx) => {
    await ctx.db.insert("volunteerProfiles", {
      profileId,
      status: "approved",
      upazilaIds: opts.wholeDistrict ? [] : [places.upazilaId as never],
      districtIds: opts.wholeDistrict ? [places.districtId as never] : [],
      motivation: "I want to help families in my area.",
      numberDisplayConsentAt: Date.now(),
      onDuty: opts.onDuty ?? false,
      onDutySince: opts.onDuty ? Date.now() : undefined,
      activeClaims: 0,
      isDemo: false,
    });
  });
  return user;
}

async function donorProfileIdOf(t: Test, subject: string) {
  const profileId = await profileIdOf(t, subject);
  return await t.run(async (ctx) => {
    const donor = await ctx.db
      .query("donorProfiles")
      .withIndex("by_profile", (q) => q.eq("profileId", profileId))
      .unique();
    return donor!._id;
  });
}

const PHONE_RE = /\+?8801[3-9]\d{8}|(?<!\d)01[3-9]\d{8}(?!\d)/;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── P2 carry-over fixes (S3-F1, S4-F5) ──────────────────────────────
describe("carry-over fixes from the P2 review", () => {
  it("S-23: a standby promotion cannot push the requester past the daily reveal cap", async () => {
    const t = newTest();
    await seedAll(t);
    await patchSetting(t, "revealsPerRequesterPerDay", 2);
    const places = await seedPlaces(t);
    const requester = await makeUser(t, { name: "Rahima Khatun" });
    const { requestId } = await makeRequest(t, requester.asUser, places, { units: 1 });
    const donorA = await makeDonor(t, places, { name: "Donor A" });
    const donorB = await makeDonor(t, places, { name: "Donor B" });
    const donorC = await makeDonor(t, places, { name: "Donor C" });
    await advance(t, 1); // startRequest → wave 1 notifies all three

    // Slots = units + 1 = 2: A and B confirm; each accept reveals the
    // donor's number to the requester (cap = 2, now exactly reached).
    expect((await acceptAs(donorA, requestId, "a1")).state).toBe("confirmed");
    expect((await acceptAs(donorB, requestId, "b1")).state).toBe("confirmed");
    expect((await acceptAs(donorC, requestId, "c1")).state).toBe("standby");

    const requesterId = await profileIdOf(t, requester.subject);
    const before = await revealsOf(t, requestId);
    expect(before.filter((r) => r.viewerId === requesterId)).toHaveLength(2);

    // A withdraws → C is promoted through confirmStandbyResponse. The
    // promotion must NOT reveal C's number to the capped requester…
    const responseA = await responseOf(t, requestId, donorA.subject);
    await donorA.asUser.mutation(responsesWithdraw, { responseId: responseA!._id as never });
    const responseC = await responseOf(t, requestId, donorC.subject);
    expect(responseC!.state).toBe("confirmed");

    const after = await revealsOf(t, requestId);
    const requesterViews = after.filter((r) => r.viewerId === requesterId);
    expect(requesterViews).toHaveLength(2); // still exactly at the cap
    const donorCId = await profileIdOf(t, donorC.subject);
    expect(requesterViews.some((r) => r.subjectId === donorCId)).toBe(false);
    // …while C (the promoted donor) still receives the requester's number.
    expect(
      after.some((r) => r.viewerId === donorCId && r.subjectId === requesterId),
    ).toBe(true);
    // The withholding is on the record.
    const capEvents = await eventsOf(t, "reveal_cap_reached");
    expect(capEvents).toHaveLength(1);
    expect((capEvents[0].props as { via?: string }).via).toBe("promotion");
    // And the requester-facing view agrees: C shows without a phone.
    const view = await requester.asUser.query(requestsGetForOwner, {
      requestId: requestId as never,
    });
    const shownC = view.confirmedDonors.find(
      (d: { responseId: unknown }) => d.responseId === responseC!._id,
    );
    expect(shownC).toBeDefined();
    expect(shownC!.phone).toBeUndefined();
  });

  it("S4-F5: markDonorNotResponding emits donor_not_responding_marked (specs name)", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const requester = await makeUser(t);
    const { requestId } = await makeRequest(t, requester.asUser, places, {});
    const donor = await makeDonor(t, places, {});
    await advance(t, 1);
    await acceptAs(donor, requestId, "d1");
    const response = await responseOf(t, requestId, donor.subject);
    await requester.asUser.mutation(requestsMarkNR, {
      requestId: requestId as never,
      responseId: response!._id as never,
    });
    const names = (await eventsOf(t)).map((e) => e.name);
    expect(names).toContain("donor_not_responding_marked");
    expect(names).not.toContain("donor_not_responding");
  });
});

// ─── Volunteer application (F-701) ───────────────────────────────────
describe("volunteer application (F-701)", () => {
  it("requires a verified phone; records consent + pending profile; notifies admins", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const admin = await makeUser(t, { name: "Admin One" });
    await setRole(t, admin.subject, "admin");
    const applicant = await makeUser(t, { name: "Karim Uddin" });

    const applyArgs = {
      upazilaIds: [places.upazilaId as never],
      districtIds: [],
      motivation: "I want to help families near my campus.",
      consentVersion: CONSENT_VERSION,
    };
    expect(await codeOf(applicant.asUser.mutation(volunteersApply, applyArgs)))
      .toBe("ERR_PHONE_NOT_VERIFIED");

    await setPhoneVerified(t, applicant.subject);
    expect(
      await codeOf(
        applicant.asUser.mutation(volunteersApply, { ...applyArgs, motivation: "short" }),
      ),
    ).toBe("ERR_VALIDATION");
    expect(
      await codeOf(
        applicant.asUser.mutation(volunteersApply, { ...applyArgs, upazilaIds: [] }),
      ),
    ).toBe("ERR_VALIDATION");

    await applicant.asUser.mutation(volunteersApply, applyArgs);
    const mine = await applicant.asUser.query(volunteersGetMine, {});
    expect(mine?.status).toBe("pending");
    await t.run(async (ctx) => {
      const consents = await ctx.db.query("consents").collect();
      expect(
        consents.some((c) => c.kind === "volunteer_number_display"),
      ).toBe(true);
    });
    expect(await notificationsOf(t, admin.subject, "NTF-17")).toHaveLength(1);
    expect((await eventsOf(t, "volunteer_applied"))).toHaveLength(1);
    // A pending applicant holds no volunteer powers yet.
    expect(
      await codeOf(applicant.asUser.mutation(volunteersSetOnDuty, { onDuty: true })),
    ).toBe("ERR_FORBIDDEN");
  });
});

// ─── Duty, board, claim (F-702/F-703) ────────────────────────────────
describe("duty + board + claim (F-702/F-703)", () => {
  it("duty toggle records the event; board shows covered districts only, number-free", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const volunteer = await makeVolunteer(t, places, {});
    await volunteer.asUser.mutation(volunteersSetOnDuty, { onDuty: true });
    expect((await eventsOf(t, "volunteer_duty_changed"))).toHaveLength(1);
    const mine = await volunteer.asUser.query(volunteersGetMine, {});
    expect(mine?.onDuty).toBe(true);

    const requester = await makeUser(t);
    await setPhoneVerified(t, requester.subject); // S-22: 2 open requests when verified
    const near = await makeRequest(t, requester.asUser, places, {});
    await makeRequest(t, requester.asUser, places, {
      districtId: places.district2Id as never,
      upazilaId: places.upazila3Id as never,
    });
    const board = await volunteer.asUser.query(volunteersBoard, {});
    expect(board.map((b: { requestId: unknown }) => b.requestId)).toEqual([near.requestId]);
    expect(JSON.stringify(board)).not.toMatch(PHONE_RE);
    expect(board[0].claimedByFirstName).toBeNull();
  });

  it("claim is exclusive, counted, and released by unclaim", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const v1 = await makeVolunteer(t, places, { name: "Nusrat Jahan" });
    const v2 = await makeVolunteer(t, places, { name: "Tanvir Ahmed" });
    const requester = await makeUser(t);
    const { requestId } = await makeRequest(t, requester.asUser, places, {});

    await v1.asUser.mutation(volunteersClaim, { requestId: requestId as never });
    expect((await v1.asUser.query(volunteersGetMine, {}))?.activeClaims).toBe(1);
    expect(
      await codeOf(v2.asUser.mutation(volunteersClaim, { requestId: requestId as never })),
    ).toBe("ERR_VALIDATION");
    const board = await v2.asUser.query(volunteersBoard, {});
    expect(board[0].claimedByFirstName).toBe("Nusrat");

    await v1.asUser.mutation(volunteersUnclaim, { requestId: requestId as never });
    expect((await v1.asUser.query(volunteersGetMine, {}))?.activeClaims).toBe(0);
    await v2.asUser.mutation(volunteersClaim, { requestId: requestId as never });
    expect((await eventsOf(t, "volunteer_claimed"))).toHaveLength(3);
  });
});

// ─── openCase: the requester's number, once (F-705 DoD) ─────────────
describe("openCase (F-705)", () => {
  it("a volunteer receives the requester's number only through openCase, logged once per request", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const volunteer = await makeVolunteer(t, places, {});
    const member = await makeUser(t, { name: "Plain Member" });
    const requester = await makeUser(t, { name: "Rahima Khatun", phone: "01799999999" });
    const { requestId } = await makeRequest(t, requester.asUser, places, {
      contactPhone: "01799999999",
    });

    // The case view itself carries no number before openCase…
    const view = await volunteer.asUser.query(volunteersGetRequest, {
      requestId: requestId as never,
    });
    expect(view.requester.phone).toBeUndefined();
    expect(JSON.stringify(view)).not.toMatch(PHONE_RE);
    // …and a plain member cannot open a case at all.
    expect(
      await codeOf(member.asUser.mutation(volunteersOpenCase, { requestId: requestId as never })),
    ).toBe("ERR_FORBIDDEN");

    const opened = await volunteer.asUser.mutation(volunteersOpenCase, {
      requestId: requestId as never,
    });
    expect(opened.requesterPhone).toBe("+8801799999999");
    // Second call: same number, but NO second reveal row or audit entry.
    const again = await volunteer.asUser.mutation(volunteersOpenCase, {
      requestId: requestId as never,
    });
    expect(again.requesterPhone).toBe("+8801799999999");
    const caseReveals = (await revealsOf(t, requestId)).filter(
      (r) => r.reason === "volunteer_case",
    );
    expect(caseReveals).toHaveLength(1);
    expect(await auditsOf(t, "volunteer_case_opened")).toHaveLength(1);
    // Now the case view may show it (the reveal row backs the display).
    const viewAfter = await volunteer.asUser.query(volunteersGetRequest, {
      requestId: requestId as never,
    });
    expect(viewAfter.requester.phone).toBe("+8801799999999");
  });
});

// ─── Donor search + ask + opt-in reveal (F-705) ──────────────────────
describe("donor search, ask, opt-in reveal (F-705)", () => {
  it("search results never contain a donor number; the search is audited", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const volunteer = await makeVolunteer(t, places, {});
    const requester = await makeUser(t);
    const { requestId } = await makeRequest(t, requester.asUser, places, {});
    const donor = await makeDonor(t, places, { name: "Farhan Ali", phone: "01755555555" });
    await advance(t, 1); // wave 1 notifies the donor

    const results = await volunteer.asUser.mutation(volunteersSearchDonors, {
      requestId: requestId as never,
    });
    expect(results).toHaveLength(1);
    expect(results[0].firstName).toBe("Farhan");
    expect(results[0].eligible).toBe(true);
    expect(results[0].alreadyNotified).toBe(true);
    expect(results[0].canBeCalled).toBe(false);
    expect(JSON.stringify(results)).not.toMatch(PHONE_RE);
    expect(JSON.stringify(results)).not.toContain("phone");
    expect(await auditsOf(t, "volunteer_donor_search")).toHaveLength(1);
    expect(donor).toBeDefined();
  });

  it("askDonor sends NTF-02 and the donor's accept runs the normal flow", async () => {
    const t = newTest();
    await seedAll(t);
    await patchSetting(t, "waveSizes", [0, 0, 0]); // waves notify nobody
    const places = await seedPlaces(t);
    const volunteer = await makeVolunteer(t, places, {});
    const requester = await makeUser(t);
    const { requestId } = await makeRequest(t, requester.asUser, places, {});
    const donor = await makeDonor(t, places, {});
    const wrongGroup = await makeDonor(t, places, { group: "A+" });
    await advance(t, 1);
    expect(await responsesOf(t, requestId)).toHaveLength(0);

    const donorProfileId = await donorProfileIdOf(t, donor.subject);
    await volunteer.asUser.mutation(volunteersAskDonor, {
      requestId: requestId as never,
      donorProfileId: donorProfileId as never,
    });
    const rows = await responsesOf(t, requestId);
    expect(rows).toHaveLength(1);
    expect(rows[0].wave).toBe(0);
    expect(rows[0].viaVolunteerId).toBeDefined();
    expect(await notificationsOf(t, donor.subject, "NTF-02")).toHaveLength(1);
    expect((await eventsOf(t, "volunteer_asked_donor"))).toHaveLength(1);

    const wrongId = await donorProfileIdOf(t, wrongGroup.subject);
    expect(
      await codeOf(
        volunteer.asUser.mutation(volunteersAskDonor, {
          requestId: requestId as never,
          donorProfileId: wrongId as never,
        }),
      ),
    ).toBe("ERR_NOT_ELIGIBLE");

    // The asked donor accepts → confirmed with the usual mutual reveal.
    const accepted = await acceptAs(donor, requestId, "ask-accept-1");
    expect(accepted.state).toBe("confirmed");
    const requesterId = await profileIdOf(t, requester.subject);
    expect(
      (await revealsOf(t, requestId)).some((r) => r.viewerId === requesterId),
    ).toBe(true);
  });

  it("askDonor stops at 10 asks per request (PRD §5.8)", async () => {
    const t = newTest();
    await seedAll(t);
    await patchSetting(t, "waveSizes", [0, 0, 0]);
    const places = await seedPlaces(t);
    const volunteer = await makeVolunteer(t, places, {});
    const requester = await makeUser(t);
    const { requestId } = await makeRequest(t, requester.asUser, places, {});
    await advance(t, 1);
    for (let i = 0; i < 10; i++) {
      const donor = await makeDonor(t, places, {});
      const donorProfileId = await donorProfileIdOf(t, donor.subject);
      await volunteer.asUser.mutation(volunteersAskDonor, {
        requestId: requestId as never,
        donorProfileId: donorProfileId as never,
      });
    }
    const eleventh = await makeDonor(t, places, {});
    const eleventhId = await donorProfileIdOf(t, eleventh.subject);
    expect(
      await codeOf(
        volunteer.asUser.mutation(volunteersAskDonor, {
          requestId: requestId as never,
          donorProfileId: eleventhId as never,
        }),
      ),
    ).toBe("ERR_RATE_LIMITED");
  });

  it("searchDonors is rate-limited at 30 per hour (PRD §5.8)", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const volunteer = await makeVolunteer(t, places, {});
    const requester = await makeUser(t);
    const { requestId } = await makeRequest(t, requester.asUser, places, {});
    for (let i = 0; i < 30; i++) {
      await volunteer.asUser.mutation(volunteersSearchDonors, {
        requestId: requestId as never,
      });
    }
    expect(
      await codeOf(
        volunteer.asUser.mutation(volunteersSearchDonors, {
          requestId: requestId as never,
        }),
      ),
    ).toBe("ERR_RATE_LIMITED");
  });

  it("a donor's number reaches a volunteer ONLY for opt-in donors, with a typed reason", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const volunteer = await makeVolunteer(t, places, {});
    const requester = await makeUser(t);
    const { requestId } = await makeRequest(t, requester.asUser, places, {});
    const donor = await makeDonor(t, places, { phone: "01744444444" });
    const donorProfileId = await donorProfileIdOf(t, donor.subject);

    // Not opted in → forbidden, however good the reason.
    expect(
      await codeOf(
        volunteer.asUser.mutation(volunteersRevealOptIn, {
          requestId: requestId as never,
          donorProfileId: donorProfileId as never,
          reason: "Family asked me to call this donor directly",
        }),
      ),
    ).toBe("ERR_FORBIDDEN");

    // The donor opts in (donors.updateSettings, V10 setting)…
    await donor.asUser.mutation(donorsUpdateSettings, { volunteersMayCall: true });
    // …but a too-short reason still fails VAL-18.
    expect(
      await codeOf(
        volunteer.asUser.mutation(volunteersRevealOptIn, {
          requestId: requestId as never,
          donorProfileId: donorProfileId as never,
          reason: "call",
        }),
      ),
    ).toBe("ERR_VALIDATION");

    const revealed = await volunteer.asUser.mutation(volunteersRevealOptIn, {
      requestId: requestId as never,
      donorProfileId: donorProfileId as never,
      reason: "Family asked me to call this donor directly",
    });
    expect(revealed.phone).toBe("+8801744444444");
    const rows = (await revealsOf(t, requestId)).filter(
      (r) => r.reason === "volunteer_optin_call",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].reasonText).toBe("Family asked me to call this donor directly");
    expect(await auditsOf(t, "volunteer_optin_revealed")).toHaveLength(1);
    expect((await eventsOf(t, "volunteer_revealed_optin_donor"))).toHaveLength(1);
  });
});

// ─── Hotline: NTF-03 at publish + least-busy rotation (F-702) ───────
describe("on-duty hotline fan-out + rotation (F-702)", () => {
  it("NTF-03 reaches on-duty volunteers covering the area at publish — and only them", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const onDuty = await makeVolunteer(t, places, { name: "On Duty", onDuty: true });
    const offDuty = await makeVolunteer(t, places, { name: "Off Duty", onDuty: false });
    const farAway = await makeVolunteer(t, places, { name: "Far Away", onDuty: true });
    // farAway covers only the other district's thana.
    const farAwayProfileId = await profileIdOf(t, farAway.subject);
    await t.run(async (ctx) => {
      const vp = await ctx.db
        .query("volunteerProfiles")
        .withIndex("by_profile", (q) => q.eq("profileId", farAwayProfileId))
        .unique();
      await ctx.db.patch(vp!._id, {
        upazilaIds: [places.upazila3Id as never],
        districtIds: [],
      });
    });
    const requester = await makeUser(t);
    await makeRequest(t, requester.asUser, places, {});
    await advance(t, 1); // startRequest
    expect(await notificationsOf(t, onDuty.subject, "NTF-03")).toHaveLength(1);
    expect(await notificationsOf(t, offDuty.subject, "NTF-03")).toHaveLength(0);
    expect(await notificationsOf(t, farAway.subject, "NTF-03")).toHaveLength(0);
  });

  it("hotline rotation picks the least-recently-shown on-duty volunteer", async () => {
    const t = newTest();
    await seedAll(t);
    await patchSetting(t, "maxVolunteersShown", 1);
    const places = await seedPlaces(t);
    const v1 = await makeVolunteer(t, places, { name: "Vol One", onDuty: true, wholeDistrict: true });
    const v2 = await makeVolunteer(t, places, { name: "Vol Two", onDuty: true, wholeDistrict: true });
    // V1 was shown long ago, V2 more recently → V1 is least-recently-shown.
    const shownSetup: [Awaited<ReturnType<typeof profileIdOf>>, number][] = [
      [await profileIdOf(t, v1.subject), T0 - 10_000],
      [await profileIdOf(t, v2.subject), T0 - 5_000],
    ];
    await t.run(async (ctx) => {
      for (const [profileId, shownAt] of shownSetup) {
        const vp = await ctx.db
          .query("volunteerProfiles")
          .withIndex("by_profile", (q) => q.eq("profileId", profileId))
          .unique();
        await ctx.db.patch(vp!._id, { lastShownAt: shownAt });
      }
    });
    const requester = await makeUser(t);
    await setPhoneVerified(t, requester.subject);
    const first = await makeRequest(t, requester.asUser, places, {});
    await t.mutation(volunteerHotline, { requestId: first.requestId as never });
    const v1Id = await profileIdOf(t, v1.subject);
    const v2Id = await profileIdOf(t, v2.subject);
    const firstReveals = await revealsOf(t, first.requestId);
    expect(firstReveals).toHaveLength(1);
    expect(firstReveals[0].subjectId).toBe(v1Id);
    expect(firstReveals[0].reason).toBe("volunteer_hotline");

    // V1 has just been shown, so the next request rotates to V2.
    const second = await makeRequest(t, requester.asUser, places, {});
    await t.mutation(volunteerHotline, { requestId: second.requestId as never });
    const secondReveals = await revealsOf(t, second.requestId);
    expect(secondReveals).toHaveLength(1);
    expect(secondReveals[0].subjectId).toBe(v2Id);
  });
});

// ─── Escalation (F-704) ──────────────────────────────────────────────
describe("escalation (F-704)", () => {
  it("reaches on-duty district volunteers + admins, and fires exactly once", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const admin = await makeUser(t, { name: "Admin One" });
    await setRole(t, admin.subject, "admin");
    const volunteer = await makeVolunteer(t, places, { onDuty: true });
    const requester = await makeUser(t);
    const { requestId } = await makeRequest(t, requester.asUser, places, {});

    await t.mutation(escalate, { requestId: requestId as never });
    expect(await notificationsOf(t, volunteer.subject, "NTF-07")).toHaveLength(1);
    expect(await notificationsOf(t, admin.subject, "NTF-07")).toHaveLength(1);

    // Second run: escalatedAt is set, so nothing fires again.
    await t.mutation(escalate, { requestId: requestId as never });
    expect(await notificationsOf(t, volunteer.subject, "NTF-07")).toHaveLength(1);
    expect(await notificationsOf(t, admin.subject, "NTF-07")).toHaveLength(1);
    expect((await eventsOf(t, "request_escalated"))).toHaveLength(1);
  });

  it("a claimed request is not escalated", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const volunteer = await makeVolunteer(t, places, { onDuty: true });
    const requester = await makeUser(t);
    const { requestId } = await makeRequest(t, requester.asUser, places, {});
    await volunteer.asUser.mutation(volunteersClaim, { requestId: requestId as never });
    await t.mutation(escalate, { requestId: requestId as never });
    expect(await notificationsOf(t, volunteer.subject, "NTF-07")).toHaveLength(0);
    expect((await eventsOf(t, "request_escalated"))).toHaveLength(0);
  });
});

// ─── Volunteer approval + roles (F-903, A05) ─────────────────────────
describe("admin people: applications, roles, status (F-903)", () => {
  async function setupApplicant(t: Test) {
    const places = await seedPlaces(t);
    const admin = await makeUser(t, { name: "Admin One" });
    await setRole(t, admin.subject, "admin");
    const applicant = await makeUser(t, { name: "Karim Uddin", phone: "01733333333" });
    await setPhoneVerified(t, applicant.subject);
    await applicant.asUser.mutation(volunteersApply, {
      upazilaIds: [places.upazilaId as never],
      districtIds: [],
      motivation: "I want to help families near my campus.",
      consentVersion: CONSENT_VERSION,
    });
    return { places, admin, applicant };
  }

  it("the applications queue is phone-free; approve grants the role + NTF-15; reject needs a reason", async () => {
    const t = newTest();
    await seedAll(t);
    const { admin, applicant } = await setupApplicant(t);
    const queue = await admin.asUser.query(peopleApplications, {});
    expect(queue).toHaveLength(1);
    expect(queue[0].status).toBe("pending");
    expect(queue[0].phoneVerified).toBe(true);
    expect(queue[0].areaNames).toContain("Panchlaish");
    expect(JSON.stringify(queue)).not.toMatch(PHONE_RE);

    const vpId = queue[0].volunteerProfileId;
    expect(
      await codeOf(
        admin.asUser.mutation(peopleReview, {
          volunteerProfileId: vpId as never,
          decision: "reject" as const,
        }),
      ),
    ).toBe("ERR_VALIDATION");
    await admin.asUser.mutation(peopleReview, {
      volunteerProfileId: vpId as never,
      decision: "approve" as const,
    });
    const mine = await applicant.asUser.query(volunteersGetMine, {});
    expect(mine?.status).toBe("approved");
    const detail = await admin.asUser.query(peopleGet, {
      profileId: (await profileIdOf(t, applicant.subject)) as never,
    });
    expect(detail.role).toBe("volunteer");
    expect(await notificationsOf(t, applicant.subject, "NTF-15")).toHaveLength(1);
    expect(await auditsOf(t, "volunteer_reviewed")).toHaveLength(1);
    // The newly approved volunteer can go on duty right away.
    await applicant.asUser.mutation(volunteersSetOnDuty, { onDuty: true });
  });

  it("the last admin cannot be removed; granting admin is super-admin only; changes are audited", async () => {
    const t = newTest();
    await seedAll(t);
    const superadmin = await makeUser(t, { name: "Super Admin" });
    await setRole(t, superadmin.subject, "superadmin");
    const admin = await makeUser(t, { name: "Admin One" });
    await setRole(t, admin.subject, "admin");
    const member = await makeUser(t, { name: "Member One" });
    const memberId = await profileIdOf(t, member.subject);
    const superId = await profileIdOf(t, superadmin.subject);

    // A plain admin cannot grant the admin role.
    expect(
      await codeOf(
        admin.asUser.mutation(peopleSetRole, {
          profileId: memberId as never,
          role: "admin" as const,
          reason: "They help run the drives",
        }),
      ),
    ).toBe("ERR_FORBIDDEN");
    // The super-admin can.
    await superadmin.asUser.mutation(peopleSetRole, {
      profileId: memberId as never,
      role: "admin" as const,
      reason: "They help run the drives",
    });
    expect(
      (await auditsOf(t, "role_changed")).filter((a) => a.targetId === String(memberId)),
    ).toHaveLength(1);
    // Demote the other admin so the super-admin is the last one…
    const adminId = await profileIdOf(t, admin.subject);
    await superadmin.asUser.mutation(peopleSetRole, {
      profileId: adminId as never,
      role: "member" as const,
      reason: "Rotating off the ops team",
    });
    await superadmin.asUser.mutation(peopleSetRole, {
      profileId: memberId as never,
      role: "member" as const,
      reason: "Rotating off the ops team",
    });
    // …and now the last admin (the super-admin) cannot be demoted.
    expect(
      await codeOf(
        superadmin.asUser.mutation(peopleSetRole, {
          profileId: superId as never,
          role: "member" as const,
          reason: "Trying to remove the last admin",
        }),
      ),
    ).toBe("ERR_LAST_ADMIN");
  });

  it("setStatus suspends with NTF-14 + audit and drops donor live; search/get never leak phone or DOB", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const admin = await makeUser(t, { name: "Admin One" });
    await setRole(t, admin.subject, "admin");
    const donor = await makeDonor(t, places, { name: "Donor Person", phone: "01766666666" });
    const donorId = await profileIdOf(t, donor.subject);

    const found = await admin.asUser.query(peopleSearch, { text: "Donor Person" });
    expect(found).toHaveLength(1);
    expect(JSON.stringify(found)).not.toMatch(PHONE_RE);
    const detail = await admin.asUser.query(peopleGet, { profileId: donorId as never });
    expect(detail.age).toBeGreaterThan(18);
    expect(JSON.stringify(detail)).not.toMatch(PHONE_RE);
    expect(JSON.stringify(detail)).not.toContain("1995-05-01");

    await admin.asUser.mutation(peopleSetStatus, {
      profileId: donorId as never,
      status: "suspended" as const,
      reason: "Reports of repeated no-shows",
      until: Date.now() + 7 * DAY,
    });
    expect(await notificationsOf(t, donor.subject, "NTF-14")).toHaveLength(1);
    expect(await auditsOf(t, "status_changed")).toHaveLength(1);
    const after = await admin.asUser.query(peopleGet, { profileId: donorId as never });
    expect(after.status).toBe("suspended");
    expect(after.donor?.live).toBe(false);
  });

  it("revokeVerification un-verifies, drops donor live, audits and notifies", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const admin = await makeUser(t, { name: "Admin One" });
    await setRole(t, admin.subject, "admin");
    const donor = await makeDonor(t, places, {});
    const donorId = await profileIdOf(t, donor.subject);
    await admin.asUser.mutation(peopleRevokeVerification, {
      profileId: donorId as never,
      reason: "Number was recycled to a new owner",
    });
    const detail = await admin.asUser.query(peopleGet, { profileId: donorId as never });
    expect(detail.phoneVerified).toBe(false);
    expect(detail.donor?.live).toBe(false);
    expect(await auditsOf(t, "phone_verification_revoked")).toHaveLength(1);
    expect(await notificationsOf(t, donor.subject, "NTF-14")).toHaveLength(1);
  });
});

// ─── Admin reveal with reason (F-805, A14) ───────────────────────────
describe("admin reveal with reason (F-805)", () => {
  it("needs a typed reason; the reveal is audited and volume-flagged past S-24", async () => {
    const t = newTest();
    await seedAll(t);
    await patchSetting(t, "revealFlagPerDay", 2);
    const admin = await makeUser(t, { name: "Admin One" });
    await setRole(t, admin.subject, "admin");
    const subject = await makeUser(t, { name: "Subject One", phone: "01777777777" });
    const subjectId = await profileIdOf(t, subject.subject);

    expect(
      await codeOf(
        admin.asUser.mutation(peopleRevealPhone, {
          profileId: subjectId as never,
          reason: "call",
        }),
      ),
    ).toBe("ERR_VALIDATION");
    const revealed = await admin.asUser.mutation(peopleRevealPhone, {
      profileId: subjectId as never,
      reason: "Calling about their pending request",
    });
    expect(revealed.phone).toBe("+8801777777777");
    const rows = (await revealsOf(t)).filter((r) => r.reason === "admin_reveal");
    expect(rows).toHaveLength(1);
    expect(rows[0].requestId).toBeUndefined(); // person-level: no request context
    expect(rows[0].reasonText).toBe("Calling about their pending request");
    expect(await auditsOf(t, "admin_phone_revealed")).toHaveLength(1);

    // Two more reveals cross the patched S-24 threshold (2) → one flag.
    for (let i = 0; i < 2; i++) {
      await admin.asUser.mutation(peopleRevealPhone, {
        profileId: subjectId as never,
        reason: "Calling about their pending request",
      });
    }
    const flags = await t.run(async (ctx) => {
      const items = await ctx.db.query("moderationItems").collect();
      return items.filter((i) => i.kind === "reveal_volume");
    });
    expect(flags).toHaveLength(1);
  });
});

// ─── In-person verification by approved volunteers (SCR-V06) ─────────
describe("in-person verification by volunteers (SCR-V06)", () => {
  it("an approved volunteer can verify in person; a revoked one cannot", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const admin = await makeUser(t, { name: "Admin One" });
    await setRole(t, admin.subject, "admin");
    // Apply + approve through the real flow so role and roster agree.
    const volunteer = await makeUser(t, { name: "Nusrat Jahan" });
    await setPhoneVerified(t, volunteer.subject);
    await volunteer.asUser.mutation(volunteersApply, {
      upazilaIds: [places.upazilaId as never],
      districtIds: [],
      motivation: "I help at the campus blood drives.",
      consentVersion: CONSENT_VERSION,
    });
    const queue = await admin.asUser.query(peopleApplications, {});
    await admin.asUser.mutation(peopleReview, {
      volunteerProfileId: queue[0].volunteerProfileId as never,
      decision: "approve" as const,
    });

    const person = await makeUser(t, { name: "New Donor", phone: "01788888888" });
    const started = await person.asUser.mutation(pvStartInPerson, {});
    const lookup = await volunteer.asUser.query(pvLookupInPerson, { code: started.code });
    expect(lookup.firstName).toBe("New");
    expect(lookup.phoneLast4).toBe("8888");
    expect(JSON.stringify(lookup)).not.toMatch(PHONE_RE);
    await volunteer.asUser.mutation(pvConfirmInPerson, {
      verificationId: lookup.verificationId as never,
      matches: true,
    });
    const detail = await admin.asUser.query(peopleGet, {
      profileId: (await profileIdOf(t, person.subject)) as never,
    });
    expect(detail.phoneVerified).toBe(true);

    // Revoke the volunteer → the SCR-V06 gate closes again.
    await admin.asUser.mutation(peopleReview, {
      volunteerProfileId: queue[0].volunteerProfileId as never,
      decision: "revoke" as const,
      reason: "Moved away from the campus area",
    });
    const person2 = await makeUser(t, { name: "Second Donor", phone: "01788888887" });
    const started2 = await person2.asUser.mutation(pvStartInPerson, {});
    expect(
      await codeOf(volunteer.asUser.query(pvLookupInPerson, { code: started2.code })),
    ).toBe("ERR_FORBIDDEN");
  });
});

// ─── Privacy & data control (F-603, D07) ─────────────────────────────
describe("privacy & data control (F-603)", () => {
  it("whoHasMyNumber lists viewers by first name + role — never numbers", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const volunteer = await makeVolunteer(t, places, {});
    const requester = await makeUser(t);
    const donor = await makeDonor(t, places, {});
    const { requestId } = await makeRequest(t, requester.asUser, places, {});
    await advance(t, 1);
    await acceptAs(donor, requestId, "acc-1");
    await advance(t, 1);
    await volunteer.asUser.mutation(volunteersOpenCase, {
      requestId: requestId as never,
    });

    const donorView = await donor.asUser.query(profilesWhoHasMyNumber, {});
    expect(donorView).toHaveLength(1);
    expect(donorView[0].viewerRole).toBe("requester");
    expect(donorView[0].viewerFirstName).toBe("Test");
    expect(donorView[0].hospitalName).toBe("Test Hospital Area");
    expect(JSON.stringify(donorView)).not.toMatch(PHONE_RE);

    const requesterView = await requester.asUser.query(profilesWhoHasMyNumber, {});
    const roles = requesterView.map((r: { viewerRole: string }) => r.viewerRole).sort();
    expect(roles).toEqual(["donor", "volunteer"]);
    expect(JSON.stringify(requesterView)).not.toMatch(PHONE_RE);
  });

  it("requestDeletion needs the confirm word (VAL-25); cancel restores the account", async () => {
    const t = newTest();
    await seedAll(t);
    const user = await makeUser(t);
    expect(
      await codeOf(user.asUser.mutation(profilesRequestDeletion, { confirmWord: "delete" })),
    ).toBe("ERR_VALIDATION");
    const { deleteBy } = await user.asUser.mutation(profilesRequestDeletion, {
      confirmWord: "DELETE",
    });
    expect(deleteBy).toBeGreaterThan(Date.now() + 29 * DAY);
    expect(deleteBy).toBeLessThan(Date.now() + 31 * DAY);
    expect(await auditsOf(t, "deletion_requested")).toHaveLength(1);
    await user.asUser.mutation(profilesCancelDeletion, {});
    const detail = await t.run(async (ctx) => {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_authUserId", (q) => q.eq("authUserId", user.subject))
        .unique();
      return profile!;
    });
    expect(detail.status).toBe("active");
    expect(detail.deletionRequestedAt).toBeUndefined();
  });

  it("the export contains ONLY the caller's own data; 2/day rate limit", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const donor = await makeDonor(t, places, { phone: "01711111111" });
    const other = await makeUser(t, { name: "Other Person", phone: "01799999999" });
    const { requestId } = await makeRequest(t, other.asUser, places, {});
    await advance(t, 1);
    await acceptAs(donor, requestId, "acc-1");

    const exported = await donor.asUser.mutation(profilesExportMyData, {});
    expect(exported.url).toBeTruthy();
    const fileId = await t.run(async (ctx) => {
      const rows = await ctx.db.query("exports").collect();
      return rows[0].fileId;
    });
    const text = await t.run(async (ctx) => {
      const blob = await ctx.storage.get(fileId);
      return (await blob?.text()) ?? "";
    });
    const data = JSON.parse(text);
    // Own data is in…
    expect(data.profile.phone).toBe("+8801711111111");
    expect(data.donorProfile.bloodGroup).toBe("B+");
    expect(data.responses).toHaveLength(1);
    // …nobody else's number is. (The other user's phone and the
    // request's contact phone must not appear anywhere.)
    expect(text).not.toContain("01799999999");
    expect(text).not.toContain("01812345678");
    expect(await auditsOf(t, "export_created")).toHaveLength(1);

    await donor.asUser.mutation(profilesExportMyData, {});
    expect(
      await codeOf(donor.asUser.mutation(profilesExportMyData, {})),
    ).toBe("ERR_RATE_LIMITED");
  });
});

// ─── Retention: deletion execution + purges (PRD §5.9) ───────────────
describe("daily retention job (PRD §5.9)", () => {
  it("a due deletion anonymises exactly per §5.9 — scrubbed vs kept fields asserted", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const volunteer = await makeVolunteer(t, places, {});
    const donor = await makeDonor(t, places, { phone: "01711111111" });
    const { requestId } = await makeRequest(t, donor.asUser, places, {
      patientName: "Patient Rahman",
    });
    // A reveal about the donor (kept 12 months per §5.9)…
    const requester = await makeUser(t);
    const { requestId: otherRequest } = await makeRequest(t, requester.asUser, places, {});
    await advance(t, 1);
    await acceptAs(donor, otherRequest, "acc-2");
    await advance(t, 1);
    // …and the donor asks for deletion.
    await donor.asUser.mutation(profilesRequestDeletion, { confirmWord: "DELETE" });
    const donorProfileId = await profileIdOf(t, donor.subject);

    // Not yet due → nothing happens.
    const early = await t.mutation(retentionDaily, {});
    expect(early.deletions).toBe(0);

    // Make it due and run the job.
    await t.run(async (ctx) => {
      await ctx.db.patch(donorProfileId, {
        deletionRequestedAt: Date.now() - 31 * DAY,
      });
    });
    const result = await t.mutation(retentionDaily, {});
    expect(result.deletions).toBe(1);

    const after = await t.run(async (ctx) => {
      const profile = await ctx.db.get(donorProfileId);
      const donorRow = await ctx.db
        .query("donorProfiles")
        .withIndex("by_profile", (q) => q.eq("profileId", donorProfileId))
        .unique();
      const volunteerRow = await ctx.db
        .query("volunteerProfiles")
        .withIndex("by_profile", (q) => q.eq("profileId", donorProfileId))
        .unique();
      const ownRequest = (await ctx.db.get(requestId as never)) as unknown as {
        patientName?: string; contactPhone: string; personalDataPurgedAt?: number;
      } | null;
      const consents = await ctx.db
        .query("consents")
        .withIndex("by_profile_kind", (q) => q.eq("profileId", donorProfileId))
        .collect();
      const reveals = await ctx.db
        .query("contactReveals")
        .withIndex("by_subject", (q) => q.eq("subjectId", donorProfileId))
        .collect();
      const notifications = await ctx.db
        .query("notifications")
        .withIndex("by_recipient", (q) => q.eq("recipientId", donorProfileId))
        .collect();
      return { profile, donorRow, volunteerRow, ownRequest, consents, reveals, notifications };
    });
    // Scrubbed (PRD §5.9)…
    expect(after.profile?.name).toBe("Deleted user");
    expect(after.profile?.firstName).toBe("Deleted");
    expect(after.profile?.phone).toBe("");
    expect(after.profile?.dateOfBirth).toBe("");
    expect(after.profile?.phoneVerified).toBe(false);
    expect(after.profile?.statusReason).toBe("account_deleted");
    expect(after.donorRow).toBeNull();
    expect(after.notifications).toHaveLength(0);
    expect(after.ownRequest?.patientName).toBeUndefined();
    expect(after.ownRequest?.contactPhone).toBe("");
    expect(after.ownRequest?.personalDataPurgedAt).toBeDefined();
    // Kept: identity link (so sign-in resolves), role, consents and the
    // 12-month reveal records.
    expect(after.profile?.authUserId).toBe(donor.subject);
    expect(after.consents.length).toBeGreaterThan(0);
    expect(after.reveals.length).toBeGreaterThan(0);
    expect(await auditsOf(t, "deletion_completed")).toHaveLength(1);
    void volunteer;

    // Idempotent: a second run anonymises nobody.
    const again = await t.mutation(retentionDaily, {});
    expect(again.deletions).toBe(0);
  });

  it("S-35 purges closed-request personal fields and S-26 deletes slip photos", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const requester = await makeUser(t);
    const { requestId } = await makeRequest(t, requester.asUser, places, {
      patientName: "Patient Rahman",
    });
    const slipFileId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["slip"], { type: "image/jpeg" })),
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(requestId as never, {
        status: "closed",
        closedAt: Date.now() - 31 * DAY,
        closeReason: "expired",
        slipFileId,
      });
    });
    const result = await t.mutation(retentionDaily, {});
    expect(result.purged).toBe(1);
    expect(result.slipsDeleted).toBe(1);
    const after = await t.run(async (ctx) => {
      const request = (await ctx.db.get(requestId as never)) as unknown as {
        patientName?: string; contactPhone: string; slipFileId?: string;
      } | null;
      const blob = await ctx.storage.get(slipFileId);
      return { request, blob };
    });
    expect(after.request?.patientName).toBeUndefined();
    expect(after.request?.contactPhone).toBe("");
    expect(after.request?.slipFileId).toBeUndefined();
    expect(after.blob).toBeNull();
  });

  it("events older than 90 days roll up into dailyRollups and are deleted", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const requester = await makeUser(t);
    await makeRequest(t, requester.asUser, places, {});
    expect((await eventsOf(t, "request_published")).length).toBeGreaterThan(0);
    vi.setSystemTime(T0 + 100 * DAY);
    const result = await t.mutation(retentionDaily, {});
    expect(result.eventsRolledUp).toBeGreaterThan(0);
    expect(await eventsOf(t, "request_published")).toHaveLength(0);
    const rollups = await t.run(async (ctx) => await ctx.db.query("dailyRollups").collect());
    const row = rollups.find(
      (r) => r.metric === "events" && (r.dims as { name?: string }).name === "request_published",
    );
    expect(row?.value).toBeGreaterThan(0);
  });
});

// ─── Automatic flags: request farming (F-803) ────────────────────────
describe("request-farming flags (F-803)", () => {
  it("three requests with three different blood groups raise ONE flag", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const requester = await makeUser(t);
    await setPhoneVerified(t, requester.subject);
    const groups = ["O+", "A+", "B+"] as const;
    for (const bloodGroup of groups) {
      const { requestId } = await makeRequest(t, requester.asUser, places, { group: bloodGroup });
      await requester.asUser.mutation(requestsClose, {
        requestId: requestId as never,
        reason: "not_needed" as const,
      });
      await advance(t, 1);
    }
    const flags = await t.run(async (ctx) => {
      const items = await ctx.db.query("moderationItems").collect();
      return items.filter((i) => i.kind === "request_farming");
    });
    expect(flags).toHaveLength(1);
    expect(flags[0].severity).toBe("medium");
    // A fourth varied request does not stack a second open flag.
    const { requestId } = await makeRequest(t, requester.asUser, places, {
      group: "AB+",
    });
    void requestId;
    const after = await t.run(async (ctx) => {
      const items = await ctx.db.query("moderationItems").collect();
      return items.filter((i) => i.kind === "request_farming");
    });
    expect(after).toHaveLength(1);
  });

  it("a genuine repeat need (same group, same hospital) raises no flag", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const requester = await makeUser(t);
    await setPhoneVerified(t, requester.subject);
    for (let i = 0; i < 3; i++) {
      const { requestId } = await makeRequest(t, requester.asUser, places, {});
      await requester.asUser.mutation(requestsClose, {
        requestId: requestId as never,
        reason: "not_needed" as const,
      });
      await advance(t, 1);
    }
    const flags = await t.run(async (ctx) => {
      const items = await ctx.db.query("moderationItems").collect();
      return items.filter((i) => i.kind === "request_farming");
    });
    expect(flags).toHaveLength(0);
  });
});
