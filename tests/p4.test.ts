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
import * as hospitalsModule from "../convex/hospitals";
import * as pushModule from "../convex/push";
import * as intakeModule from "../convex/intake";
import * as pushWebModule from "../convex/pushWeb";
import {
  decryptWebPushPayload,
  encryptWebPushPayload,
  generateSubscriptionKeys,
  generateVapidKeys,
} from "../convex/_lib/webPushCrypto";

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
};

const seedSettings = makeFunctionReference<"mutation">("seed:seedSettings");
const completeOnboarding = makeFunctionReference<"mutation">("profiles:completeOnboarding");
const peopleApplications = makeFunctionReference<"query">("admin/people:applications");
const peopleSearch = makeFunctionReference<"query">("admin/people:search");
const peopleGet = makeFunctionReference<"query">("admin/people:get");
const peopleSetRole = makeFunctionReference<"mutation">("admin/people:setRole");
const peopleSetStatus = makeFunctionReference<"mutation">("admin/people:setStatus");
const peopleRevealPhone = makeFunctionReference<"mutation">("admin/people:revealPhone");
const peopleRevokeVerification = makeFunctionReference<"mutation">("admin/people:revokeVerification");
const peopleReview = makeFunctionReference<"mutation">("admin/people:reviewVolunteer");
const intakeParse = makeFunctionReference<"action">("intake:parse");
const intakeRefData = makeFunctionReference<"query">("intake:refData");
const requestsCreate = makeFunctionReference<"mutation">("requests:create");
const donorsUpsert = makeFunctionReference<"mutation">("donors:upsert");
const pushRegisterWeb = makeFunctionReference<"mutation">("push:registerWebSubscription");
const pushWebStatus = makeFunctionReference<"query">("push:webPushStatus");
const pushSendWeb = makeFunctionReference<"action">("pushWeb:sendToProfile");

const CONSENT_VERSION = "2026-11-28-pilot";
// 2026-12-03 12:00 Asia/Dhaka (06:00 UTC) — safely outside quiet hours.
const T0 = Date.parse("2026-12-03T06:00:00.000Z");
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

async function patchProfile(
  t: Test,
  subject: string,
  patch: Record<string, unknown>,
) {
  await t.run(async (ctx) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", subject))
      .unique();
    await ctx.db.patch(profile!._id, patch as never);
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

describe("P4 slice 0 — admin.people negative tests (P3 review S3-F1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function setup(t: Test) {
    await seedAll(t);
    const member = await makeUser(t, { name: "Plain Member" });
    const volunteer = await makeUser(t, { name: "Vera Volunteer" });
    await patchProfile(t, volunteer.subject, { role: "volunteer" });
    const frozenAdmin = await makeUser(t, { name: "Frozen Admin" });
    await patchProfile(t, frozenAdmin.subject, { role: "admin", status: "frozen" });
    const admin = await makeUser(t, { name: "Real Admin" });
    await patchProfile(t, admin.subject, { role: "superadmin" });
    const target = await makeUser(t, { name: "Target Person" });
    const targetId = await profileIdOf(t, target.subject);
    // A pending volunteer application row so reviewVolunteer has a real id.
    const vpId = await t.run(async (ctx) => {
      return await ctx.db.insert("volunteerProfiles", {
        profileId: targetId,
        status: "pending",
        upazilaIds: [],
        districtIds: [],
        motivation: "I want to help people in my area",
        numberDisplayConsentAt: Date.now(),
        onDuty: false,
        activeClaims: 0,
        isDemo: false,
      });
    });
    return { member, volunteer, frozenAdmin, admin, targetId, vpId };
  }

  const REASON = "Routine review of this account record";

  function adminCalls(
    asUser: ReturnType<Test["withIdentity"]>,
    targetId: string,
    vpId: string,
  ): [string, Promise<unknown>][] {
    return [
      ["applications", asUser.query(peopleApplications, {})],
      ["search", asUser.query(peopleSearch, { text: "Target" })],
      ["get", asUser.query(peopleGet, { profileId: targetId as never })],
      [
        "setRole",
        asUser.mutation(peopleSetRole, {
          profileId: targetId as never,
          role: "volunteer" as const,
          reason: REASON,
        }),
      ],
      [
        "setStatus",
        asUser.mutation(peopleSetStatus, {
          profileId: targetId as never,
          status: "frozen" as const,
          reason: REASON,
        }),
      ],
      [
        "revealPhone",
        asUser.mutation(peopleRevealPhone, {
          profileId: targetId as never,
          reason: REASON,
        }),
      ],
      [
        "revokeVerification",
        asUser.mutation(peopleRevokeVerification, {
          profileId: targetId as never,
          reason: REASON,
        }),
      ],
      [
        "reviewVolunteer",
        asUser.mutation(peopleReview, {
          volunteerProfileId: vpId as never,
          decision: "approve" as const,
        }),
      ],
    ];
  }

  it("plain member gets ERR_FORBIDDEN from every admin.people function", async () => {
    const t = newTest();
    const { member, targetId, vpId } = await setup(t);
    for (const [name, call] of adminCalls(member.asUser, String(targetId), String(vpId))) {
      expect(await codeOf(call), name).toBe("ERR_FORBIDDEN");
    }
  });

  it("volunteer gets ERR_FORBIDDEN from every admin.people function", async () => {
    const t = newTest();
    const { volunteer, targetId, vpId } = await setup(t);
    for (const [name, call] of adminCalls(volunteer.asUser, String(targetId), String(vpId))) {
      expect(await codeOf(call), name).toBe("ERR_FORBIDDEN");
    }
  });

  it("frozen admin is stopped by the active-account gate (ERR_FROZEN) before any handler runs", async () => {
    const t = newTest();
    const { frozenAdmin, targetId, vpId } = await setup(t);
    // The wrappers run assertActive before assertRole, so a frozen admin —
    // although the role would pass — is rejected with ERR_FROZEN.
    for (const [name, call] of adminCalls(frozenAdmin.asUser, String(targetId), String(vpId))) {
      expect(await codeOf(call), name).toBe("ERR_FROZEN");
    }
  });

  it("control: an active superadmin CAN call the read functions (gate is role, not a blanket block)", async () => {
    const t = newTest();
    const { admin, targetId } = await setup(t);
    const apps = await admin.asUser.query(peopleApplications, {});
    expect(Array.isArray(apps)).toBe(true);
    const detail = await admin.asUser.query(peopleGet, {
      profileId: targetId as never,
    });
    expect(detail).toBeTruthy();
  });
});

// ── P4 slice 3: intake.parse (rules + redaction + Gemini) ─────────────

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

/** Minimal places + two hospitals for the intake refData. */
async function seedIntakeWorld(t: Test) {
  return await t.run(async (ctx) => {
    const divisionId = await ctx.db.insert("places", {
      level: "division", code: "DIV-I", nameEn: "Chattogram", nameBn: "চট্টগ্রাম",
      lat: 22.7, lng: 91.7, isMetroThana: false, neighbourIds: [],
    });
    const districtId = await ctx.db.insert("places", {
      level: "district", code: "DIS-I", nameEn: "Chattogram", nameBn: "চট্টগ্রাম",
      parentId: divisionId, lat: 22.335, lng: 91.834, isMetroThana: false, neighbourIds: [],
    });
    const panchlaishId = await ctx.db.insert("places", {
      level: "upazila", code: "UP-I1", nameEn: "Panchlaish", nameBn: "পাঁচলাইশ",
      parentId: districtId, lat: 22.373, lng: 91.829, isMetroThana: true, neighbourIds: [],
    });
    const hathazariId = await ctx.db.insert("places", {
      level: "upazila", code: "UP-I2", nameEn: "Hathazari", nameBn: "হাটহাজারী",
      parentId: districtId, lat: 22.5, lng: 91.8, isMetroThana: false, neighbourIds: [],
    });
    const cmchId = await ctx.db.insert("hospitals", {
      nameEn: "Chittagong Medical College Hospital",
      nameBn: "চট্টগ্রাম মেডিকেল কলেজ হাসপাতাল",
      aliases: ["CMCH", "চমেক", "Chittagong Medical"],
      searchText: "chittagong medical college hospital cmch",
      type: "hospital",
      divisionId, districtId, upazilaId: panchlaishId,
      lat: 22.359, lng: 91.831, active: true, isDemo: false,
    });
    const evercareId = await ctx.db.insert("hospitals", {
      nameEn: "Evercare Hospital Chattogram",
      nameBn: "এভারকেয়ার হাসপাতাল চট্টগ্রাম",
      aliases: ["Evercare", "Evercare Chittagong"],
      searchText: "evercare hospital chattogram",
      type: "hospital",
      divisionId, districtId, upazilaId: hathazariId,
      lat: 22.42, lng: 91.81, active: true, isDemo: false,
    });
    return { divisionId, districtId, panchlaishId, hathazariId, cmchId, evercareId };
  });
}

function geminiOk(payload: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
  };
}

/** Text where rules find group + hospital but NOT units → AI is asked. */
const NEEDS_AI_TEXT =
  "রোগীর নাম: করিম উদ্দিন, B+ রক্ত লাগবে চট্টগ্রাম মেডিকেল কলেজ হাসপাতালে, কয় ব্যাগ লাগবে ডাক্তার বলেননি, আজকেই লাগবে। যোগাযোগ: 01812-345678";

describe("P4 — intake.parse", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    process.env.GEMINI_API_KEY = "test-key-not-real";
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.GEMINI_API_KEY;
  });

  async function setupAi(t: Test) {
    await seedAll(t);
    const world = await seedIntakeWorld(t);
    await patchSetting(t, "ai.models", { lite: "gemini-test-lite", flash: "" });
    const user = await makeUser(t, { name: "Requester" });
    return { world, user };
  }

  it("rules-complete text never calls the AI", async () => {
    const t = newTest();
    const { user } = await setupAi(t);
    const fetchMock = vi.fn(async () => geminiOk({}));
    vi.stubGlobal("fetch", fetchMock);
    const res = await user.asUser.action(intakeParse, {
      text: "B+ রক্ত লাগবে ২ ব্যাগ, চট্টগ্রাম মেডিকেল কলেজ হাসপাতাল, আগামীকাল। যোগাযোগ: 01812345678",
      lang: "bn" as const,
      source: "text" as const,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.aiUsed).toBe(false);
    expect(res.aiError).toBeUndefined();
    expect(res.fields.bloodGroup).toBe("B+");
    expect(res.fields.units).toBe(2);
    expect(res.extractedPhone).toBe("01812345678");
    expect(res.hospitalCandidates.length).toBeGreaterThan(0);
  });

  it("AI fills only the missing fields; payload is redacted; phone comes from regex, never the AI", async () => {
    const t = newTest();
    const { user, world } = await setupAi(t);
    let sentBody = "";
    const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
      sentBody = init?.body ?? "";
      return geminiOk({
        bloodGroup: null, component: null, isDengue: null, units: 3,
        hospitalName: null, area: null,
        neededBy: { kind: null, isoDateTime: null },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await user.asUser.action(intakeParse, {
      text: NEEDS_AI_TEXT,
      lang: "bn" as const,
      source: "paste" as const,
      clientId: "draft-1",
    });
    expect(res.aiUsed).toBe(true);
    expect(res.fields.units).toBe(3); // filled by AI
    expect(res.fields.bloodGroup).toBe("B+"); // from rules, untouched
    expect(String(res.fields.hospitalId)).toBe(String(world.cmchId));
    // The phone in the RESULT came from the regex extractor…
    expect(res.extractedPhone).toBe("01812345678");
    // …and the payload that left for Gemini contains no PII at all.
    expect(sentBody).not.toContain("01812345678");
    expect(sentBody).not.toContain("01812");
    expect(sentBody).not.toContain("করিম উদ্দিন");
    expect(sentBody).toContain("[phone]");
    expect(sentBody).toContain("[name]");
    // aiCalls row stores the REDACTED input only; quota was consumed.
    const rows = await t.run(async (ctx) => await ctx.db.query("aiCalls").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ok).toBe(true);
    expect(rows[0]!.inputRedacted).not.toContain("01812345678");
    expect(rows[0]!.inputRedacted).not.toContain("করিম উদ্দিন");
    expect(rows[0]!.clientId).toBe("draft-1");
    const quota = await t.run(async (ctx) => await ctx.db.query("aiQuota").collect());
    expect(quota).toHaveLength(1);
    expect(quota[0]!.count).toBe(1);
    const events = await t.run(async (ctx) => await ctx.db.query("events").collect());
    expect(events.some((e) => e.name === "ai_call")).toBe(true);
  });

  it("AI off (ai.features.intake=false): parse degrades honestly and the form still posts end-to-end", async () => {
    const t = newTest();
    const { user, world } = await setupAi(t);
    await patchSetting(t, "ai.features", {
      intake: false, duplicate: true, assistant: true, appeal: true, summary: true,
    });
    const fetchMock = vi.fn(async () => geminiOk({ units: 9 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await user.asUser.action(intakeParse, {
      text: NEEDS_AI_TEXT, lang: "bn" as const, source: "text" as const, clientId: "draft-off",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.aiUsed).toBe(false);
    expect(res.aiError).toBe("disabled");
    expect(res.fields.units).toBeUndefined(); // still missing — the human fills it
    expect(res.missing).toContain("units");
    // The form path itself never depended on AI: posting works.
    await patchProfile(t, user.subject, { phoneVerified: true, phoneVerifiedVia: "telegram" });
    const created = await user.asUser.mutation(requestsCreate, {
      clientId: "draft-off",
      bloodGroup: "B+" as never,
      component: "whole_blood" as const,
      isDengue: false,
      unitsNeeded: 2,
      hospitalId: world.cmchId as never,
      divisionId: world.divisionId as never,
      districtId: world.districtId as never,
      upazilaId: world.panchlaishId as never,
      neededBy: Date.now() + 6 * 3_600_000,
      contactPhone: "01812345678",
      source: "text" as const,
      aiAssisted: false,
      lang: "bn" as const,
    });
    expect(created.requestId).toBeTruthy();
    expect(created.existing).toBe(false);
  });

  it("no GEMINI_API_KEY in env → aiError 'unavailable', rules result intact, no quota consumed", async () => {
    const t = newTest();
    const { user } = await setupAi(t);
    delete process.env.GEMINI_API_KEY;
    const res = await user.asUser.action(intakeParse, {
      text: NEEDS_AI_TEXT, lang: "bn" as const, source: "text" as const,
    });
    expect(res.aiError).toBe("unavailable");
    expect(res.aiUsed).toBe(false);
    expect(res.fields.bloodGroup).toBe("B+");
    const quota = await t.run(async (ctx) => await ctx.db.query("aiQuota").collect());
    expect(quota).toHaveLength(0);
  });

  it("daily quota reached → aiError 'quota'", async () => {
    const t = newTest();
    const { user } = await setupAi(t);
    await patchSetting(t, "ai.limits", { liteDaily: 1, liteRpm: 15, flashDaily: 20 });
    vi.stubGlobal("fetch", vi.fn(async () => geminiOk({ units: 2 })));
    const first = await user.asUser.action(intakeParse, {
      text: NEEDS_AI_TEXT, lang: "bn" as const, source: "text" as const, clientId: "draft-a",
    });
    expect(first.aiUsed).toBe(true);
    const second = await user.asUser.action(intakeParse, {
      text: NEEDS_AI_TEXT, lang: "bn" as const, source: "text" as const, clientId: "draft-b",
    });
    expect(second.aiUsed).toBe(false);
    expect(second.aiError).toBe("quota");
  });

  it("S-29 per-request cap: the same draft cannot spend AI calls beyond aiIntakeCallsPerRequest", async () => {
    const t = newTest();
    const { user } = await setupAi(t);
    await patchSetting(t, "aiIntakeCallsPerRequest", 1);
    vi.stubGlobal("fetch", vi.fn(async () => geminiOk({ units: 2 })));
    const first = await user.asUser.action(intakeParse, {
      text: NEEDS_AI_TEXT, lang: "bn" as const, source: "text" as const, clientId: "draft-cap",
    });
    expect(first.aiUsed).toBe(true);
    const second = await user.asUser.action(intakeParse, {
      text: NEEDS_AI_TEXT, lang: "bn" as const, source: "text" as const, clientId: "draft-cap",
    });
    expect(second.aiUsed).toBe(false);
    expect(second.aiError).toBe("quota");
    // A different draft still gets its own allowance.
    const third = await user.asUser.action(intakeParse, {
      text: NEEDS_AI_TEXT, lang: "bn" as const, source: "text" as const, clientId: "draft-other",
    });
    expect(third.aiUsed).toBe(true);
  });

  it("Gemini HTTP failure → 'unavailable' + aiCalls row ok=false; garbage JSON → invalid_response", async () => {
    const t = newTest();
    const { user } = await setupAi(t);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const res = await user.asUser.action(intakeParse, {
      text: NEEDS_AI_TEXT, lang: "bn" as const, source: "text" as const, clientId: "draft-err",
    });
    expect(res.aiError).toBe("unavailable");
    expect(res.fields.bloodGroup).toBe("B+");
    let rows = await t.run(async (ctx) => await ctx.db.query("aiCalls").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ok).toBe(false);
    expect(rows[0]!.errorKind).toBe("http_500");

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "not json at all" }] } }] }),
    })));
    const res2 = await user.asUser.action(intakeParse, {
      text: NEEDS_AI_TEXT, lang: "bn" as const, source: "text" as const, clientId: "draft-err2",
    });
    expect(res2.aiError).toBe("unavailable");
    rows = await t.run(async (ctx) => await ctx.db.query("aiCalls").collect());
    expect(rows).toHaveLength(2);
    expect(rows[1]!.errorKind).toBe("invalid_response");
  });

  it("an AI response containing a phone number is voided whole (invalid_response)", async () => {
    const t = newTest();
    const { user } = await setupAi(t);
    vi.stubGlobal("fetch", vi.fn(async () => geminiOk({
      units: 2, hospitalName: "Call 01799999999 for details",
    })));
    const res = await user.asUser.action(intakeParse, {
      text: NEEDS_AI_TEXT, lang: "bn" as const, source: "text" as const, clientId: "draft-pii",
    });
    expect(res.aiUsed).toBe(false);
    expect(res.aiError).toBe("unavailable");
    expect(res.fields.units).toBeUndefined();
  });

  it("VAL-13: too-short and too-long texts are rejected", async () => {
    const t = newTest();
    const { user } = await setupAi(t);
    expect(await codeOf(user.asUser.action(intakeParse, {
      text: "B+", lang: "en" as const, source: "text" as const,
    }))).toBe("ERR_VALIDATION");
    expect(await codeOf(user.asUser.action(intakeParse, {
      text: "x".repeat(2001), lang: "en" as const, source: "text" as const,
    }))).toBe("ERR_VALIDATION");
  });

  it("rate limit: the 11th parse within an hour is ERR_RATE_LIMITED (specs §6.1)", async () => {
    const t = newTest();
    const { user } = await setupAi(t);
    const text = "B+ blood needed, 2 bags, at CMCH, tomorrow morning please";
    for (let i = 0; i < 10; i++) {
      await user.asUser.action(intakeParse, {
        text, lang: "en" as const, source: "text" as const,
      });
    }
    expect(await codeOf(user.asUser.action(intakeParse, {
      text, lang: "en" as const, source: "text" as const,
    }))).toBe("ERR_RATE_LIMITED");
  });

  it("frozen member is stopped at the guard (G6) before any parsing", async () => {
    const t = newTest();
    const { user } = await setupAi(t);
    await patchProfile(t, user.subject, { status: "frozen" });
    expect(await codeOf(user.asUser.action(intakeParse, {
      text: NEEDS_AI_TEXT, lang: "bn" as const, source: "text" as const,
    }))).toBe("ERR_FROZEN");
  });

  it("refData query serves the caller's hospitals with metro-thana areas only", async () => {
    const t = newTest();
    const { user } = await setupAi(t);
    const ref = await user.asUser.query(intakeRefData, {});
    type RefHospital = { nameEn: string; area?: string; aliases: string[] };
    type RefArea = { nameEn: string };
    const cmch = (ref.hospitals as RefHospital[]).find((h) => h.nameEn.startsWith("Chittagong Medical"));
    const evercare = (ref.hospitals as RefHospital[]).find((h) => h.nameEn.startsWith("Evercare"));
    expect(cmch?.area).toBe("Panchlaish");
    expect(evercare?.area).toBeUndefined();
    expect(cmch?.aliases).toContain("CMCH");
    expect((ref.areas as RefArea[]).some((a) => a.nameEn === "Panchlaish")).toBe(true);
  });
});


// ── P4 slice 4: Web Push (F-303) ──────────────────────────────────────

describe("P4 — web push", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
  });

  it("crypto round-trip: an encrypted payload decrypts with the subscription's private key", () => {
    const sub = generateSubscriptionKeys();
    const payload = JSON.stringify({ title: "B+ needed", body: "2 bags · CMCH", url: "/alerts/x" });
    const body = encryptWebPushPayload({ p256dh: sub.p256dh, auth: sub.auth }, payload);
    expect(decryptWebPushPayload(body, sub.privateKey, sub.auth)).toBe(payload);
  });

  it("registerWebSubscription stores, upserts by endpoint, and validates", async () => {
    const t = newTest();
    await seedAll(t);
    const user = await makeUser(t, { name: "Web User" });
    const sub = generateSubscriptionKeys();
    const endpoint = "https://push.example.com/sub/abc123";
    const res = await user.asUser.mutation(pushRegisterWeb, {
      endpoint, p256dh: sub.p256dh, auth: sub.auth, userAgent: "test-browser",
    });
    // No VAPID keys in this test env → the server honestly says so.
    expect(res.configured).toBe(false);
    expect(await codeOf(user.asUser.mutation(pushRegisterWeb, {
      endpoint: "http://insecure.example.com/x", p256dh: sub.p256dh, auth: sub.auth,
    }))).toBe("ERR_VALIDATION");
    // Re-registering the same endpoint updates keys, never duplicates.
    const sub2 = generateSubscriptionKeys();
    await user.asUser.mutation(pushRegisterWeb, {
      endpoint, p256dh: sub2.p256dh, auth: sub2.auth,
    });
    const rows = await t.run(async (ctx) => await ctx.db.query("webPushSubscriptions").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.p256dh).toBe(sub2.p256dh);
    const status = await user.asUser.query(pushWebStatus, {});
    expect(status.configured).toBe(false);
    process.env.VAPID_PUBLIC_KEY = generateVapidKeys().publicKey;
    const status2 = await user.asUser.query(pushWebStatus, {});
    expect(status2.configured).toBe(true);
  });

  async function setupSender(t: Test) {
    await seedAll(t);
    const world = await seedIntakeWorld(t);
    const user = await makeUser(t, { name: "Web Donor" });
    const profileId = await profileIdOf(t, user.subject);
    const vapid = generateVapidKeys();
    process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
    process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
    process.env.VAPID_SUBJECT = "https://udvasito.example";
    const sub = generateSubscriptionKeys();
    const endpoint = "https://push.example.com/sub/donor1";
    await user.asUser.mutation(pushRegisterWeb, {
      endpoint, p256dh: sub.p256dh, auth: sub.auth,
    });
    return { world, user, profileId, sub, endpoint };
  }

  it("sendToProfile delivers an encrypted, decryptable payload and resets failures", async () => {
    const t = newTest();
    const { profileId, sub, endpoint } = await setupSender(t);
    let captured: { url: string; body: Buffer; auth: string } | null = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: Uint8Array; headers?: Record<string, string> }) => {
      captured = { url, body: Buffer.from(init!.body!), auth: init!.headers!.Authorization! };
      return { status: 201 };
    }));
    const res = await t.action(pushSendWeb, {
      profileId: profileId as never,
      title: "B+ blood needed · Chittagong Medical College Hospital",
      body: "2 bag(s) by 12:00 · 1.2 km. Tap to answer.",
      url: "/alerts/xyz",
    });
    expect(res.sent).toBe(1);
    expect(captured!.url).toBe(endpoint);
    expect(captured!.auth).toMatch(/^vapid t=eyJ/);
    const plain = decryptWebPushPayload(captured!.body, sub.privateKey, sub.auth);
    const parsed = JSON.parse(plain) as { title: string; url: string };
    expect(parsed.title).toContain("B+ blood needed");
    expect(parsed.url).toBe("/alerts/xyz");
    expect(plain).not.toMatch(/01[3-9]\d{8}/); // no phone in payload (§6.8)
    const rows = await t.run(async (ctx) => await ctx.db.query("webPushSubscriptions").collect());
    expect(rows[0]!.failures).toBe(0);
    expect(rows[0]!.lastSuccessAt).toBeTypeOf("number");
  });

  it("410 from the push service removes the subscription; 5 failures remove it too", async () => {
    const t = newTest();
    const { profileId } = await setupSender(t);
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 410 })));
    await t.action(pushSendWeb, {
      profileId: profileId as never, title: "t", body: "b", url: "/",
    });
    let rows = await t.run(async (ctx) => await ctx.db.query("webPushSubscriptions").collect());
    expect(rows).toHaveLength(0);

    // Fresh subscription, persistent 500s → gone after the 5th failure.
    const sub2 = generateSubscriptionKeys();
    const user2 = await makeUser(t, { name: "Second" });
    const profile2 = await profileIdOf(t, user2.subject);
    await user2.asUser.mutation(pushRegisterWeb, {
      endpoint: "https://push.example.com/sub/donor2", p256dh: sub2.p256dh, auth: sub2.auth,
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 500 })));
    for (let i = 0; i < 4; i++) {
      await t.action(pushSendWeb, {
        profileId: profile2 as never, title: "t", body: "b", url: "/",
      });
    }
    rows = await t.run(async (ctx) => await ctx.db.query("webPushSubscriptions").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.failures).toBe(4);
    await t.action(pushSendWeb, {
      profileId: profile2 as never, title: "t", body: "b", url: "/",
    });
    rows = await t.run(async (ctx) => await ctx.db.query("webPushSubscriptions").collect());
    expect(rows).toHaveLength(0);
  });

  it("without VAPID env the sender reports not_configured and sends nothing", async () => {
    const t = newTest();
    await seedAll(t);
    const user = await makeUser(t, { name: "No Vapid" });
    const profileId = await profileIdOf(t, user.subject);
    const sub = generateSubscriptionKeys();
    await user.asUser.mutation(pushRegisterWeb, {
      endpoint: "https://push.example.com/sub/x", p256dh: sub.p256dh, auth: sub.auth,
    });
    const fetchMock = vi.fn(async () => ({ status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await t.action(pushSendWeb, {
      profileId: profileId as never, title: "t", body: "b", url: "/",
    });
    expect(res.sent).toBe(0);
    expect(res.reason).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("end-to-end: a wave-1 notification reaches the donor's web subscription, encrypted", async () => {
    const t = newTest();
    const { world } = await setupSender(t);
    // Donor: B+ at Panchlaish, phone verified, with a web subscription.
    const donor = await makeUser(t, { name: "Donor Web", phone: "01799999999" });
    await patchProfile(t, donor.subject, { phoneVerified: true, phoneVerifiedVia: "telegram" });
    await donor.asUser.mutation(donorsUpsert, {
      bloodGroup: "B+" as never,
      gender: "male" as const,
      divisionId: world.divisionId as never,
      districtId: world.districtId as never,
      upazilaId: world.panchlaishId as never,
      travelRange: "district" as const,
      neverDonated: true,
      plateletOptIn: false,
      callMode: "mutual" as const,
      checklist: { weight: true, health: true, screening: true },
      healthConsentVersion: CONSENT_VERSION,
    });
    const donorSub = generateSubscriptionKeys();
    const donorEndpoint = "https://push.example.com/sub/wave-donor";
    await donor.asUser.mutation(pushRegisterWeb, {
      endpoint: donorEndpoint, p256dh: donorSub.p256dh, auth: donorSub.auth,
    });
    const sentTo: string[] = [];
    let donorPayload: Buffer | null = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: Uint8Array }) => {
      sentTo.push(url);
      if (url === donorEndpoint) donorPayload = Buffer.from(init!.body!);
      return { status: 201 };
    }));
    // Requester posts a B+ request at CMCH.
    const requester = await makeUser(t, { name: "Requester", phone: "01812345678" });
    await patchProfile(t, requester.subject, { phoneVerified: true, phoneVerifiedVia: "telegram" });
    await requester.asUser.mutation(requestsCreate, {
      clientId: "web-push-e2e",
      bloodGroup: "B+" as never,
      component: "whole_blood" as const,
      isDengue: false,
      unitsNeeded: 2,
      hospitalId: world.cmchId as never,
      divisionId: world.divisionId as never,
      districtId: world.districtId as never,
      upazilaId: world.panchlaishId as never,
      neededBy: Date.now() + 6 * 3_600_000,
      contactPhone: "01812345678",
      source: "form" as const,
      aiAssisted: false,
      lang: "en" as const,
    });
    // finishAllScheduledFunctions drains actions scheduled by other
    // scheduled functions (the web-push send), which
    // finishInProgressScheduledFunctions does not in this harness.
    await t.finishAllScheduledFunctions(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(sentTo).toContain(donorEndpoint);
    const plain = decryptWebPushPayload(donorPayload!, donorSub.privateKey, donorSub.auth);
    expect(plain).toContain("B+");
    expect(plain).not.toContain("01812345678"); // requester's number never in a push
  });
});

