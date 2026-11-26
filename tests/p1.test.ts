import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { readFileSync } from "node:fs";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerPush } from "@convex-dev/expo-push-notifications/test";
import schema from "../convex/schema";
import * as seedModule from "../convex/seed";
import * as publicModule from "../convex/public";
import * as profilesModule from "../convex/profiles";
import * as consentsModule from "../convex/consents";
import * as supportModule from "../convex/support";
import * as phoneVerificationModule from "../convex/phoneVerification";
import * as hospitalsModule from "../convex/hospitals";
import * as placesModule from "../convex/places";
import * as donorsModule from "../convex/donors";
import * as requestsModule from "../convex/requests";
import * as matchingModule from "../convex/matching";
import * as responsesModule from "../convex/responses";
import * as notificationsModule from "../convex/notifications";
import * as pushModule from "../convex/push";
import { parseCsv } from "../scripts/import-hospitals";

const modules = {
  "../convex/_generated/api.ts": async () => ({}),
  "../convex/seed.ts": async () => seedModule,
  "../convex/public.ts": async () => publicModule,
  "../convex/profiles.ts": async () => profilesModule,
  "../convex/consents.ts": async () => consentsModule,
  "../convex/support.ts": async () => supportModule,
  "../convex/phoneVerification.ts": async () => phoneVerificationModule,
  "../convex/hospitals.ts": async () => hospitalsModule,
  "../convex/places.ts": async () => placesModule,
  "../convex/donors.ts": async () => donorsModule,
  "../convex/requests.ts": async () => requestsModule,
  "../convex/matching.ts": async () => matchingModule,
  "../convex/responses.ts": async () => responsesModule,
  "../convex/notifications.ts": async () => notificationsModule,
  "../convex/push.ts": async () => pushModule,
};

const seedSettings = makeFunctionReference<"mutation">("seed:seedSettings");
const appConfig = makeFunctionReference<"query">("public:appConfig");
const completeOnboarding = makeFunctionReference<"mutation">("profiles:completeOnboarding");
const me = makeFunctionReference<"query">("profiles:me");
const donorsUpsert = makeFunctionReference<"mutation">("donors:upsert");
const donorsGetMine = makeFunctionReference<"query">("donors:getMine");
const requestsCreate = makeFunctionReference<"mutation">("requests:create");
const requestsGetForOwner = makeFunctionReference<"query">("requests:getForOwner");
const requestsListMine = makeFunctionReference<"query">("requests:listMine");
const requestsClose = makeFunctionReference<"mutation">("requests:close");
const startRequest = makeFunctionReference<"mutation">("matching:startRequest");
const volunteerHotline = makeFunctionReference<"mutation">("matching:volunteerHotline");
const responsesAccept = makeFunctionReference<"mutation">("responses:accept");
const responsesDecline = makeFunctionReference<"mutation">("responses:decline");
const responsesInbox = makeFunctionReference<"query">("responses:inbox");
const responsesGetForDonor = makeFunctionReference<"query">("responses:getForDonor");
const pvStart = makeFunctionReference<"mutation">("phoneVerification:start");
const pvStatus = makeFunctionReference<"query">("phoneVerification:status");
const pvAcceptMismatch = makeFunctionReference<"mutation">("phoneVerification:acceptMismatch");
const pvStartInPerson = makeFunctionReference<"mutation">("phoneVerification:startInPerson");
const pvLookupInPerson = makeFunctionReference<"query">("phoneVerification:lookupInPerson");
const pvConfirmInPerson = makeFunctionReference<"mutation">("phoneVerification:confirmInPerson");
const pvHandleTelegram = makeFunctionReference<"mutation">("phoneVerification:handleTelegramUpdate");
const hospitalsSearch = makeFunctionReference<"query">("hospitals:search");
const hospitalsImport = makeFunctionReference<"mutation">("hospitals:importHospitals");
const supportHelpline = makeFunctionReference<"query">("support:helpline");

const CONSENT_VERSION = "2026-11-28-pilot";
let seq = 0;

function newTest() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  registerPush(t);
  return t;
}

type Test = ReturnType<typeof newTest>;

async function seedAll(t: Test) {
  await t.mutation(seedSettings, {});
  // P2 enforces quiet hours (S-21) in matching. This P1 suite predates
  // that filter and runs on the wall clock, so it pins the seeded quiet
  // window to empty (start == end = never quiet) to stay deterministic;
  // quiet-hours behaviour itself is covered in tests/p2.test.ts.
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "quietHours"))
      .unique();
    if (row) await ctx.db.patch(row._id, { value: { start: "00:00", end: "00:00" } });
  });
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

async function makeUser(
  t: Test,
  opts: { name?: string; phone?: string; dob?: string } = {},
) {
  seq += 1;
  const subject = `user-${seq}`;
  const asUser = t.withIdentity({ subject, name: opts.name ?? "Test User" });
  const result = await asUser.mutation(completeOnboarding, {
    name: opts.name ?? "Test User",
    dateOfBirth: opts.dob ?? "1995-05-01",
    phone: opts.phone ?? "01712345678",
    language: "en" as const,
    consentVersion: CONSENT_VERSION,
    consentAcceptedAt: Date.now(),
  });
  return { asUser, subject, result };
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

async function makeDonor(
  t: Test,
  places: Awaited<ReturnType<typeof seedPlaces>>,
  opts: { group?: string; phone?: string; platelets?: boolean; upazilaId?: string } = {},
) {
  const { asUser, subject } = await makeUser(t, { phone: opts.phone ?? "01712345678" });
  await setPhoneVerified(t, subject);
  const res = await asUser.mutation(donorsUpsert, {
    bloodGroup: (opts.group ?? "B+") as never,
    gender: "male" as const,
    divisionId: places.divisionId as never,
    districtId: places.districtId as never,
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
  opts: { group?: string; units?: number; clientId?: string } = {},
) {
  return await asRequester.mutation(requestsCreate, {
    clientId: opts.clientId ?? `client-${Math.random().toString(36).slice(2)}`,
    bloodGroup: (opts.group ?? "B+") as never,
    component: "whole_blood" as const,
    isDengue: false,
    unitsNeeded: opts.units ?? 1,
    divisionId: places.divisionId as never,
    districtId: places.districtId as never,
    upazilaId: places.upazilaId as never,
    placeText: "Test Hospital Area",
    neededBy: Date.now() + 3 * 3_600_000,
    contactPhone: "01712345678",
    source: "form" as const,
    aiAssisted: false,
    lang: "en" as const,
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

// ─── Onboarding & the 18+ gate (P1-G8) ───────────────────────────────
describe("onboarding + 18+ gate", () => {
  it("completes onboarding, writes profile + consent + audit + event", async () => {
    const t = newTest();
    await seedAll(t);
    const { asUser, result } = await makeUser(t, { name: "Rahima Khatun" });
    expect(result).toEqual({ result: "ok" });
    const profile = await asUser.query(me, {});
    expect(profile?.name).toBe("Rahima Khatun");
    expect(profile?.firstName).toBe("Rahima");
    expect(profile?.phoneVerified).toBe(false);
    expect(profile?.needsConsent).toBe(false);
    await t.run(async (ctx) => {
      const consents = await ctx.db.query("consents").collect();
      expect(consents).toHaveLength(1);
      expect(consents[0].kind).toBe("terms_privacy");
      const events = await ctx.db.query("events").collect();
      expect(events.map((e) => e.name)).toContain("profile_completed");
    });
  });

  it("under-18 DOB is blocked at onboarding (P1-G8)", async () => {
    const t = newTest();
    await seedAll(t);
    const dob = new Date(Date.now() - 17 * 365.25 * 86_400_000).toISOString().slice(0, 10);
    const { asUser, result } = await makeUser(t, { dob });
    expect(result).toEqual({ result: "underage" });
    const profile = await asUser.query(me, {});
    expect(profile?.status).toBe("underage_blocked");
    // …and every member function refuses them with ERR_UNDERAGE.
    const places = await seedPlaces(t);
    expect(
      await codeOf(
        asUser.mutation(donorsUpsert, {
          bloodGroup: "B+" as never, gender: "male" as const,
          divisionId: places.divisionId as never, districtId: places.districtId as never,
          upazilaId: places.upazilaId as never, travelRange: "district" as const,
          neverDonated: true, plateletOptIn: false, callMode: "mutual" as const,
          checklist: { weight: true, health: true, screening: true },
          healthConsentVersion: CONSENT_VERSION,
        }),
      ),
    ).toBe("ERR_UNDERAGE");
  });

  it("sign-up rate limit S-25: 6th onboarding in an hour → ERR_RATE_LIMITED (P1-G11)", async () => {
    const t = newTest();
    await seedAll(t);
    const asUser = t.withIdentity({ subject: "burst-user" });
    const args = {
      name: "Burst User", dateOfBirth: "1995-05-01", phone: "01712345678",
      language: "en" as const, consentVersion: CONSENT_VERSION, consentAcceptedAt: Date.now(),
    };
    for (let i = 0; i < 5; i++) await asUser.mutation(completeOnboarding, args);
    expect(await codeOf(asUser.mutation(completeOnboarding, args))).toBe("ERR_RATE_LIMITED");
  });

  it("unauthenticated calls are refused (access tests)", async () => {
    const t = newTest();
    await seedAll(t);
    expect(await codeOf(t.query(supportHelpline, {}))).toBe("ERR_UNAUTHENTICATED");
    expect(await codeOf(t.mutation(pvStartInPerson, {}))).toBe("ERR_UNAUTHENTICATED");
  });
});

// ─── Donor setup ─────────────────────────────────────────────────────
describe("donor setup", () => {
  it("upsert computes eligibility + live; getMine reflects it", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const { asUser } = await makeDonor(t, places, { group: "O-" });
    const mine = await asUser.query(donorsGetMine, {});
    expect(mine.live).toBe(true);
    expect(mine.donor?.bloodGroup).toBe("O-");
    expect(mine.eligibleFrom).toBe(0);
  });

  it("donor without a verified phone is not live (reason: phone)", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const { asUser } = await makeUser(t);
    const res = await asUser.mutation(donorsUpsert, {
      bloodGroup: "B+" as never, gender: "female" as const,
      divisionId: places.divisionId as never, districtId: places.districtId as never,
      upazilaId: places.upazilaId as never, travelRange: "district" as const,
      neverDonated: true, plateletOptIn: false, callMode: "mutual" as const,
      checklist: { weight: true, health: true, screening: true },
      healthConsentVersion: CONSENT_VERSION,
    });
    expect(res.live).toBe(false);
    expect(res.notLiveReasons).toContain("phone");
  });

  it("checklist not fully ticked → ERR_VALIDATION", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const { asUser } = await makeUser(t);
    expect(
      await codeOf(
        asUser.mutation(donorsUpsert, {
          bloodGroup: "B+" as never, gender: "male" as const,
          divisionId: places.divisionId as never, districtId: places.districtId as never,
          upazilaId: places.upazilaId as never, travelRange: "district" as const,
          neverDonated: true, plateletOptIn: false, callMode: "mutual" as const,
          checklist: { weight: false, health: true, screening: true },
          healthConsentVersion: CONSENT_VERSION,
        }),
      ),
    ).toBe("ERR_VALIDATION");
  });
});

// ─── Core loop: create → wave 1 → accept → reveal → close ────────────
describe("core loop", () => {
  it("requests.create twice with the same clientId → one request (P1-G4)", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const { asUser } = await makeUser(t);
    const first = await makeRequest(t, asUser, places, { clientId: "dup-1" });
    const second = await makeRequest(t, asUser, places, { clientId: "dup-1" });
    expect(first.existing).toBe(false);
    expect(second.existing).toBe(true);
    expect(second.requestId).toBe(first.requestId);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("requests").collect()).toHaveLength(1);
    });
  });

  it("wave 1 notifies exact-group same-district donors only; accept reveals both ways", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const donorB = await makeDonor(t, places, { group: "B+", phone: "01711111111" });
    await makeDonor(t, places, { group: "A+", phone: "01722222222" }); // wrong group
    const { asUser: asRequester } = await makeUser(t, { phone: "01799999999" });
    const { requestId } = await makeRequest(t, asRequester, places, { group: "B+" });
    await t.mutation(startRequest, { requestId: requestId as never });

    const inbox = await donorB.asUser.query(responsesInbox, {});
    expect(inbox.needsAnswer).toHaveLength(1);
    expect(inbox.needsAnswer[0].hospitalName).toBe("Test Hospital Area");

    // Before accepting, the donor sees no requester phone and no patient name.
    const before = await donorB.asUser.query(responsesGetForDonor, { requestId: requestId as never });
    expect(before.requester).toBeUndefined();
    expect(before.patientName).toBeUndefined();
    expect(JSON.stringify(before)).not.toContain("01799999999");

    const accepted = await donorB.asUser.mutation(responsesAccept, {
      requestId: requestId as never,
      clientId: "accept-1",
      selfCheck: true,
      callMode: "mutual" as const,
    });
    expect(accepted.state).toBe("confirmed");

    // Mutual reveal: donor sees the requester's number, requester sees the donor's.
    const after = await donorB.asUser.query(responsesGetForDonor, { requestId: requestId as never });
    expect(after.requester?.phone).toBe("+8801799999999");
    const owner = await asRequester.query(requestsGetForOwner, { requestId: requestId as never });
    expect(owner.progress.confirmed).toBe(1);
    expect(owner.confirmedDonors).toHaveLength(1);
    expect(owner.confirmedDonors[0].phone).toBe("+8801711111111");
    expect(owner.request.status).toBe("covered");

    // Every reveal wrote a contactReveals row AND an audit entry (P1-G6).
    await t.run(async (ctx) => {
      const reveals = await ctx.db.query("contactReveals").collect();
      expect(reveals).toHaveLength(2);
      const audits = await ctx.db.query("auditLog").collect();
      expect(audits.filter((a) => a.action === "contact_revealed")).toHaveLength(2);
      const events = await ctx.db.query("events").collect();
      const names = events.map((e) => e.name);
      for (const expected of ["request_published", "wave_sent", "notification_sent", "donor_accepted", "donor_confirmed", "contact_shared"]) {
        expect(names).toContain(expected);
      }
      // No phone number in any event props (P1-G12).
      expect(JSON.stringify(events)).not.toMatch(/01[3-9]\d{8}/);
    });
  });

  it("5 donors accept a 1-unit request → 2 confirmed + 3 standby (P1-G5)", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const donors = [];
    for (let i = 0; i < 5; i++) {
      donors.push(await makeDonor(t, places, { group: "B+", phone: `0171000000${i}` }));
    }
    const { asUser: asRequester } = await makeUser(t, { phone: "01799999999" });
    const { requestId } = await makeRequest(t, asRequester, places, { group: "B+", units: 1 });
    await t.mutation(startRequest, { requestId: requestId as never });

    const results = await Promise.all(
      donors.map((d, i) =>
        d.asUser.mutation(responsesAccept, {
          requestId: requestId as never,
          clientId: `accept-${i}`,
          selfCheck: true,
          callMode: "mutual" as const,
        }),
      ),
    );
    expect(results.filter((r) => r.state === "confirmed")).toHaveLength(2);
    expect(results.filter((r) => r.state === "standby")).toHaveLength(3);
    await t.run(async (ctx) => {
      const responses = await ctx.db.query("responses").collect();
      expect(responses.filter((r) => r.state === "confirmed")).toHaveLength(2);
      expect(responses.filter((r) => r.state === "standby")).toHaveLength(3);
      // 2 confirmed donors × 2 directions of mutual reveal = 4 logged reveals.
      expect(await ctx.db.query("contactReveals").collect()).toHaveLength(4);
      const request = (await ctx.db.get(requestId as never)) as {
        unitsConfirmed: number;
        status: string;
      } | null;
      expect(request?.unitsConfirmed).toBe(1);
      expect(request?.status).toBe("covered");
    });
  });

  it("donor_calls mode: requester never receives the donor's number (P1-G6)", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const donor = await makeDonor(t, places, { group: "B+", phone: "01711111111" });
    const { asUser: asRequester } = await makeUser(t, { phone: "01799999999" });
    const { requestId } = await makeRequest(t, asRequester, places, { group: "B+" });
    await t.mutation(startRequest, { requestId: requestId as never });
    const accepted = await donor.asUser.mutation(responsesAccept, {
      requestId: requestId as never,
      clientId: "accept-dc",
      selfCheck: true,
      callMode: "donor_calls" as const,
    });
    expect(accepted.state).toBe("confirmed");
    const owner = await asRequester.query(requestsGetForOwner, { requestId: requestId as never });
    expect(owner.confirmedDonors[0].callMode).toBe("donor_calls");
    expect(owner.confirmedDonors[0].phone).toBeUndefined();
    expect(JSON.stringify(owner)).not.toContain("01711111111");
    // …while the donor still sees the requester's number (PRD §3.3).
    const donorView = await donor.asUser.query(responsesGetForDonor, { requestId: requestId as never });
    expect(donorView.requester?.phone).toBe("+8801799999999");
    await t.run(async (ctx) => {
      expect(await ctx.db.query("contactReveals").collect()).toHaveLength(1);
    });
  });

  it("a member who was not notified cannot see the request (ERR_NOT_FOUND)", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    await makeDonor(t, places, { group: "B+" });
    const outsider = await makeDonor(t, places, { group: "A+", phone: "01733333333" });
    const { asUser: asRequester } = await makeUser(t, { phone: "01799999999" });
    const { requestId } = await makeRequest(t, asRequester, places, { group: "B+" });
    await t.mutation(startRequest, { requestId: requestId as never });
    expect(
      await codeOf(outsider.asUser.query(responsesGetForDonor, { requestId: requestId as never })),
    ).toBe("ERR_NOT_FOUND");
    expect(
      await codeOf(outsider.asUser.query(requestsGetForOwner, { requestId: requestId as never })),
    ).toBe("ERR_NOT_FOUND");
  });

  it("decline records the reason; second answer → ERR_ALREADY_RESPONDED", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const donor = await makeDonor(t, places, { group: "B+" });
    const { asUser: asRequester } = await makeUser(t, { phone: "01799999999" });
    const { requestId } = await makeRequest(t, asRequester, places, { group: "B+" });
    await t.mutation(startRequest, { requestId: requestId as never });
    await donor.asUser.mutation(responsesDecline, {
      requestId: requestId as never, reason: "busy" as const,
    });
    expect(
      await codeOf(
        donor.asUser.mutation(responsesAccept, {
          requestId: requestId as never, clientId: "late", selfCheck: true, callMode: "mutual" as const,
        }),
      ),
    ).toBe("ERR_ALREADY_RESPONDED");
  });

  it("close notifies still-deciding donors (NTF-09) and blocks later accepts", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const donor = await makeDonor(t, places, { group: "B+", phone: "01711111111" });
    const { asUser: asRequester } = await makeUser(t, { phone: "01799999999" });
    const { requestId } = await makeRequest(t, asRequester, places, { group: "B+" });
    await t.mutation(startRequest, { requestId: requestId as never });
    await asRequester.mutation(requestsClose, {
      requestId: requestId as never, reason: "not_needed" as const,
    });
    await t.run(async (ctx) => {
      const notes = await ctx.db.query("notifications").collect();
      expect(notes.some((n) => n.template === "NTF-09")).toBe(true);
      const request = (await ctx.db.get(requestId as never)) as {
        status: string;
        closeReason?: string;
      } | null;
      expect(request?.status).toBe("closed");
      expect(request?.closeReason).toBe("not_needed");
    });
    expect(
      await codeOf(
        donor.asUser.mutation(responsesAccept, {
          requestId: requestId as never, clientId: "too-late", selfCheck: true, callMode: "mutual" as const,
        }),
      ),
    ).toBe("ERR_REQUEST_CLOSED");
    const mine = await asRequester.query(requestsListMine, {
      status: "closed" as const, paginationOpts: { numItems: 10, cursor: null },
    });
    expect(mine.page).toHaveLength(1);
  });

  it("open-request limit S-22: unverified requester blocked at 2nd open request (P1-G11)", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const { asUser } = await makeUser(t); // phone NOT verified → limit 1
    await makeRequest(t, asUser, places, { clientId: "lim-1" });
    expect(
      await codeOf(makeRequest(t, asUser, places, { clientId: "lim-2" })),
    ).toBe("ERR_OPEN_REQUEST_LIMIT");
  });

  it("zero eligible donors → immediate no-donors state with blood banks", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    // One hospital in the district for the blood-bank list.
    await t.run(async (ctx) => {
      await ctx.db.insert("hospitals", {
        nameEn: "Test Blood Bank", nameBn: "টেস্ট ব্লাড ব্যাংক", aliases: [],
        searchText: "test blood bank", type: "blood_bank",
        divisionId: places.divisionId, districtId: places.districtId, upazilaId: places.upazilaId,
        bloodBankPhone: "02-12345678", lat: 22.36, lng: 91.83, active: true, isDemo: false,
      });
    });
    const { asUser } = await makeUser(t, { phone: "01799999999" });
    const { requestId } = await makeRequest(t, asUser, places, { group: "AB-" });
    await t.mutation(startRequest, { requestId: requestId as never });
    const owner = await asUser.query(requestsGetForOwner, { requestId: requestId as never });
    expect(owner.noDonors.show).toBe(true);
    expect(owner.noDonors.bloodBanks).toHaveLength(1);
    expect(owner.noDonors.bloodBanks[0].phone).toBe("02-12345678");
  });
});

// ─── Practice-area isolation (P1-G7) ─────────────────────────────────
describe("practice isolation", () => {
  it("practice donors are never notified for real requests and vice versa", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    // A practice donor, inserted directly (admin-created in production).
    await t.run(async (ctx) => {
      const profileId = await ctx.db.insert("profiles", {
        authUserId: "demo-donor", name: "Demo Donor", firstName: "Demo",
        dateOfBirth: "1995-05-01", language: "en", role: "member",
        phone: "+8801755555555", phoneVerified: true, status: "active",
        consentVersion: CONSENT_VERSION, lastActiveAt: Date.now(), isDemo: true,
      });
      await ctx.db.insert("donorProfiles", {
        profileId, bloodGroup: "B+", gender: "male",
        divisionId: places.divisionId, districtId: places.districtId, upazilaId: places.upazilaId,
        travelRange: "district", neverDonated: true, plateletOptIn: false,
        availability: "available", availabilityConfirmedAt: Date.now(),
        eligibleFrom: 0, eligibleFromPlatelets: 0, callMode: "mutual",
        volunteersMayCall: false, verifiedRequestsOnly: false, alertCapPerDay: 3,
        quietStart: "00:00", quietEnd: "07:00", urgentOverride: false, hidden: false,
        live: true, selfCheckAt: Date.now(), healthConsentVersion: CONSENT_VERSION,
        noShowAt: [], isDemo: true,
      });
    });
    const realDonor = await makeDonor(t, places, { group: "B+", phone: "01711111111" });
    const { asUser: asRequester } = await makeUser(t, { phone: "01799999999" });
    const { requestId } = await makeRequest(t, asRequester, places, { group: "B+" });
    await t.mutation(startRequest, { requestId: requestId as never });
    await t.run(async (ctx) => {
      const responses = await ctx.db.query("responses").collect();
      expect(responses).toHaveLength(1); // only the real donor
      expect(responses[0].isDemo).toBe(false);
    });
    const inbox = await realDonor.asUser.query(responsesInbox, {});
    expect(inbox.needsAnswer).toHaveLength(1);
  });
});

// ─── 30-second fallback (F-504) ──────────────────────────────────────
describe("30-second fallback", () => {
  it("no volunteer on duty → fallbackShown; helpline served via support.helpline", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", "fallbackContactPhone")).unique();
      await ctx.db.patch(row!._id, { value: "+8801712345678" });
    });
    const { asUser } = await makeUser(t, { phone: "01799999999" });
    const { requestId } = await makeRequest(t, asUser, places, { group: "B+" });
    await t.mutation(startRequest, { requestId: requestId as never });
    await t.mutation(volunteerHotline, { requestId: requestId as never });
    const owner = await asUser.query(requestsGetForOwner, { requestId: requestId as never });
    expect(owner.fallbackPhone).toBe("+8801712345678");
    expect(await asUser.query(supportHelpline, {})).toEqual({ phone: "+8801712345678" });
  });

  it("on-duty volunteer covering the district is shown with a logged reveal", async () => {
    const t = newTest();
    await seedAll(t);
    const places = await seedPlaces(t);
    const volunteer = await makeUser(t, { name: "Nusrat Jahan", phone: "01766666666" });
    await setRole(t, volunteer.subject, "volunteer");
    await t.run(async (ctx) => {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_authUserId", (q) => q.eq("authUserId", volunteer.subject))
        .unique();
      await ctx.db.insert("volunteerProfiles", {
        profileId: profile!._id, status: "approved",
        upazilaIds: [], districtIds: [places.districtId],
        motivation: "helping", numberDisplayConsentAt: Date.now(),
        onDuty: true, activeClaims: 0, isDemo: false,
      });
    });
    const { asUser } = await makeUser(t, { phone: "01799999999" });
    const { requestId } = await makeRequest(t, asUser, places, { group: "B+" });
    await t.mutation(startRequest, { requestId: requestId as never });
    await t.mutation(volunteerHotline, { requestId: requestId as never });
    const owner = await asUser.query(requestsGetForOwner, { requestId: requestId as never });
    expect(owner.volunteers).toHaveLength(1);
    expect(owner.volunteers[0].firstName).toBe("Nusrat");
    expect(owner.volunteers[0].phone).toBe("+8801766666666");
    await t.run(async (ctx) => {
      const reveals = await ctx.db.query("contactReveals").collect();
      expect(reveals).toHaveLength(1);
      expect(reveals[0].reason).toBe("volunteer_hotline");
    });
  });
});

// ─── Phone verification: Telegram (P1-G9) ────────────────────────────
describe("telegram verification", () => {
  async function setupTelegram(t: Test) {
    await seedAll(t);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", "verification")).unique();
      await ctx.db.patch(row!._id, {
        value: { telegram: true, whatsapp: false, inPerson: true, telegramBot: "udvasito_test_bot", whatsappNumber: "" },
      });
    });
  }

  it("success path: /start → share own contact → verified", async () => {
    const t = newTest();
    await setupTelegram(t);
    const { asUser } = await makeUser(t, { phone: "01712345678" });
    const started = await asUser.mutation(pvStart, { method: "telegram" as const });
    expect(started.deepLink).toContain("https://t.me/udvasito_test_bot?start=");
    const token = started.deepLink.split("start=")[1];
    const start = await t.mutation(pvHandleTelegram, {
      update: { message: { chat: { id: 42 }, from: { id: 777 }, text: `/start ${token}` } },
    });
    expect(start.action).toBe("prompt_contact");
    const shared = await t.mutation(pvHandleTelegram, {
      update: { message: { chat: { id: 42 }, from: { id: 777 }, contact: { phone_number: "+8801712345678", user_id: 777 } } },
    });
    expect(shared.action).toBe("verified");
    const profile = await asUser.query(me, {});
    expect(profile?.phoneVerified).toBe(true);
    const status = await asUser.query(pvStatus, { verificationId: started.verificationId as never });
    expect(status.status).toBe("verified");
  });

  it("someone else's contact → own_number reply, no verification", async () => {
    const t = newTest();
    await setupTelegram(t);
    const { asUser } = await makeUser(t, { phone: "01712345678" });
    const started = await asUser.mutation(pvStart, { method: "telegram" as const });
    const token = started.deepLink.split("start=")[1];
    await t.mutation(pvHandleTelegram, {
      update: { message: { chat: { id: 42 }, from: { id: 777 }, text: `/start ${token}` } },
    });
    const res = await t.mutation(pvHandleTelegram, {
      update: { message: { chat: { id: 42 }, from: { id: 777 }, contact: { phone_number: "+8801799999999", user_id: 999 } } },
    });
    expect(res.action).toBe("own_number");
    expect((await asUser.query(me, {}))?.phoneVerified).toBe(false);
  });

  it("mismatch path: different number shared → acceptMismatch adopts it", async () => {
    const t = newTest();
    await setupTelegram(t);
    const { asUser } = await makeUser(t, { phone: "01712345678" });
    const started = await asUser.mutation(pvStart, { method: "telegram" as const });
    const token = started.deepLink.split("start=")[1];
    await t.mutation(pvHandleTelegram, {
      update: { message: { chat: { id: 42 }, from: { id: 777 }, text: `/start ${token}` } },
    });
    const res = await t.mutation(pvHandleTelegram, {
      update: { message: { chat: { id: 42 }, from: { id: 777 }, contact: { phone_number: "01812345678", user_id: 777 } } },
    });
    expect(res.action).toBe("mismatch");
    const status = await asUser.query(pvStatus, { verificationId: started.verificationId as never });
    expect(status.status).toBe("mismatch");
    expect(status.verifiedPhone).toBe("+8801812345678");
    expect(status.enteredPhone).toBe("+8801712345678");
    await asUser.mutation(pvAcceptMismatch, { verificationId: started.verificationId as never });
    const profile = await asUser.query(me, {});
    expect(profile?.phone).toBe("+8801812345678");
    expect(profile?.phoneVerified).toBe(true);
  });

  it("expired link path: contact after expiry → expired", async () => {
    const t = newTest();
    await setupTelegram(t);
    const { asUser } = await makeUser(t, { phone: "01712345678" });
    const started = await asUser.mutation(pvStart, { method: "telegram" as const });
    const token = started.deepLink.split("start=")[1];
    await t.mutation(pvHandleTelegram, {
      update: { message: { chat: { id: 42 }, from: { id: 777 }, text: `/start ${token}` } },
    });
    await t.run(async (ctx) => {
      const row = await ctx.db.get(started.verificationId as never);
      await ctx.db.patch(started.verificationId as never, { expiresAt: Date.now() - 1000 });
      expect(row).not.toBeNull();
    });
    const res = await t.mutation(pvHandleTelegram, {
      update: { message: { chat: { id: 42 }, from: { id: 777 }, contact: { phone_number: "+8801712345678", user_id: 777 } } },
    });
    expect(res.action).toBe("expired");
    expect((await asUser.query(me, {}))?.phoneVerified).toBe(false);
  });

  it("whatsapp method is honestly disabled while its switch is off", async () => {
    const t = newTest();
    await setupTelegram(t);
    const { asUser } = await makeUser(t);
    expect(await codeOf(asUser.mutation(pvStart, { method: "whatsapp" as const }))).toBe("ERR_METHOD_DISABLED");
  });
});

// ─── Phone verification: in person (P1-G9) ───────────────────────────
describe("in-person verification", () => {
  it("admin verifies a second phone; payload never contains the full number", async () => {
    const t = newTest();
    await seedAll(t);
    const person = await makeUser(t, { name: "Karim Uddin", phone: "01712345678" });
    const admin = await makeUser(t, { name: "Admin One", phone: "01788888888" });
    await setRole(t, admin.subject, "admin");
    const started = await person.asUser.mutation(pvStartInPerson, {});
    expect(started.code).toHaveLength(6);
    const lookup = await admin.asUser.query(pvLookupInPerson, { code: started.code });
    expect(Object.keys(lookup).sort()).toEqual(["firstName", "phoneLast4", "verificationId"]);
    expect(lookup.firstName).toBe("Karim");
    expect(lookup.phoneLast4).toBe("5678");
    expect(JSON.stringify(lookup)).not.toContain("01712345678");
    expect(JSON.stringify(lookup)).not.toContain("+8801712345678");
    await admin.asUser.mutation(pvConfirmInPerson, {
      verificationId: started.verificationId as never, matches: true,
    });
    const profile = await person.asUser.query(me, {});
    expect(profile?.phoneVerified).toBe(true);
    await t.run(async (ctx) => {
      const audits = await ctx.db.query("auditLog").collect();
      expect(audits.some((a) => a.action === "phone_verified_in_person")).toBe(true);
    });
  });

  it("own code → ERR_SELF_VERIFICATION", async () => {
    const t = newTest();
    await seedAll(t);
    const person = await makeUser(t, { phone: "01712345678" });
    await setRole(t, person.subject, "volunteer");
    const started = await person.asUser.mutation(pvStartInPerson, {});
    expect(await codeOf(person.asUser.query(pvLookupInPerson, { code: started.code }))).toBe("ERR_SELF_VERIFICATION");
    expect(
      await codeOf(
        person.asUser.mutation(pvConfirmInPerson, {
          verificationId: started.verificationId as never, matches: true,
        }),
      ),
    ).toBe("ERR_SELF_VERIFICATION");
  });

  it("no-match path marks mismatch and does not verify; members cannot look up codes", async () => {
    const t = newTest();
    await seedAll(t);
    const person = await makeUser(t, { phone: "01712345678" });
    const admin = await makeUser(t, { name: "Admin One", phone: "01788888888" });
    await setRole(t, admin.subject, "admin");
    const started = await person.asUser.mutation(pvStartInPerson, {});
    // Plain members (including the code's owner) are refused at the role gate;
    // the self-verification refusal itself is covered by the test above.
    expect(await codeOf(person.asUser.query(pvLookupInPerson, { code: started.code }))).toBe("ERR_FORBIDDEN");
    const plain = await makeUser(t, { name: "Plain Member", phone: "01777777777" });
    expect(await codeOf(plain.asUser.query(pvLookupInPerson, { code: started.code }))).toBe("ERR_FORBIDDEN");
    await admin.asUser.mutation(pvConfirmInPerson, {
      verificationId: started.verificationId as never, matches: false,
    });
    expect((await person.asUser.query(me, {}))?.phoneVerified).toBe(false);
    await t.run(async (ctx) => {
      const row = (await ctx.db.get(started.verificationId as never)) as {
        status: string;
      } | null;
      expect(row?.status).toBe("mismatch");
    });
  });
});

// ─── Hospitals import + search ───────────────────────────────────────
describe("hospitals", () => {
  it("imports data/hospitals.csv idempotently (key nameEn+district) and searches aliases", async () => {
    const t = newTest();
    await seedAll(t);
    // Seed the real places dataset (582 rows) so CSV place names resolve.
    const placesData = JSON.parse(readFileSync("data/places.json", "utf8")) as Record<string, unknown>[];
    await t.mutation(makeFunctionReference<"mutation">("places:seedPlaces"), {
      rows: placesData.map((r) => ({
        level: r.level, code: r.code, nameEn: r.nameEn, nameBn: r.nameBn,
        parentCode: (r.parentCode as string | null) ?? null,
        lat: r.lat, lng: r.lng, isMetroThana: r.isMetroThana,
        neighbourCodes: r.neighbourCodes ?? [],
      })) as never,
    });
    const rows = parseCsv(readFileSync("data/hospitals.csv", "utf8")).map((row) => ({
      nameEn: row.nameEn,
      nameBn: row.nameBn,
      aliases: row.aliases ? row.aliases.split(";").map((a) => a.trim()).filter(Boolean) : [],
      type: row.type as "hospital" | "blood_bank" | "clinic",
      districtName: row.district,
      upazilaName: row.upazila,
      address: row.address || undefined,
      bloodBankPhone: row.bloodBankPhone || undefined,
      lat: Number(row.lat),
      lng: Number(row.lng),
      active: row.active === "true",
    }));
    const first = await t.mutation(hospitalsImport, { rows: rows as never });
    expect(first.skipped).toEqual([]);
    expect(first.inserted).toBe(rows.length);
    const second = await t.mutation(hospitalsImport, { rows: rows as never });
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(rows.length);
    const found = await t.query(hospitalsSearch, { text: "CMCH" });
    expect(found.map((h: { nameEn: string }) => h.nameEn)).toContain("Chittagong Medical College Hospital");
    const cfg = await t.query(appConfig, {});
    expect(cfg.verification.telegram).toBe(true);
    expect(JSON.stringify(cfg)).not.toMatch(/01[3-9]\d{8}/);
  });
});

// ─── appConfig ───────────────────────────────────────────────────────
describe("appConfig", () => {
  it("exposes verification config + features, never a phone number", async () => {
    const t = newTest();
    await seedAll(t);
    const cfg = await t.query(appConfig, {});
    expect(cfg.consentVersion).toBe(CONSENT_VERSION);
    expect(cfg.verification.inPerson).toBe(true);
    expect(cfg.aiFeatures.intake).toBe(true);
    expect(JSON.stringify(cfg)).not.toMatch(/01[3-9]\d{8}/);
  });
});
