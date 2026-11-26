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
import * as publicModule from "../convex/public";
import * as supportModule from "../convex/support";
import * as notificationsModule from "../convex/notifications";
import * as placesModule from "../convex/places";
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
  "../convex/admin/ai.ts": async () => adminAiModule,
  "../convex/admin/usage.ts": async () => adminUsageModule,
  "../convex/admin/demo.ts": async () => adminDemoModule,
  "../convex/auth.ts": async () => authModule,
  "../convex/public.ts": async () => publicModule,
  "../convex/support.ts": async () => supportModule,
  "../convex/notifications.ts": async () => notificationsModule,
  "../convex/places.ts": async () => placesModule,
  "../convex/http.ts": async () => ({ default: httpModule }),
};

const T0 = Date.parse("2026-12-07T06:00:00.000Z");
const HOUR = 3_600_000;

function newTest() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  registerPush(t);
  return t;
}
type Test = ReturnType<typeof newTest>;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "NO_THROW";
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code ?? String(e);
  }
}

let seq = 0;
async function insertProfile(
  t: Test,
  opts: { role?: "member" | "volunteer" | "admin" | "superadmin"; name?: string } = {},
) {
  seq += 1;
  const authUserId = `p6acc-user-${seq}`;
  const profileId = await t.run(async (ctx) =>
    await ctx.db.insert("profiles", {
      authUserId,
      name: opts.name ?? `Person ${seq}`,
      firstName: (opts.name ?? `Person ${seq}`).split(" ")[0],
      dateOfBirth: "1995-05-01",
      language: "en",
      role: opts.role ?? "member",
      phone: "01712345678",
      phoneVerified: true,
      status: "active",
      consentVersion: "2026-11-28-pilot",
      lastActiveAt: Date.now(),
      isDemo: false,
    }),
  );
  return { profileId, asUser: t.withIdentity({ subject: authUserId }) };
}

async function seedPlaces(t: Test) {
  return await t.run(async (ctx) => {
    seq += 1;
    const divisionId = await ctx.db.insert("places", {
      level: "division", code: `DIVA-${seq}`, nameEn: "Chattogram", nameBn: "চট্টগ্রাম",
      lat: 22.35, lng: 91.8, isMetroThana: false, neighbourIds: [],
    });
    const districtId = await ctx.db.insert("places", {
      level: "district", code: `DISA-${seq}`, nameEn: "Chattogram", nameBn: "চট্টগ্রাম",
      parentId: divisionId, lat: 22.35, lng: 91.8, isMetroThana: false, neighbourIds: [],
    });
    const upazilaId = await ctx.db.insert("places", {
      level: "upazila", code: `UPAA-${seq}`, nameEn: "Kotwali", nameBn: "কোতোয়ালী",
      parentId: districtId, lat: 22.36, lng: 91.83, isMetroThana: true, neighbourIds: [],
    });
    return { divisionId, districtId, upazilaId };
  });
}
type Places = Awaited<ReturnType<typeof seedPlaces>>;

async function insertRequest(t: Test, places: Places, requesterId: Id<"profiles">) {
  return await t.run(async (ctx) =>
    await ctx.db.insert("requests", {
      requesterId, source: "form", clientId: `acc-${Math.random().toString(36).slice(2)}`,
      bloodGroup: "B+" as never, component: "whole_blood", isDengue: false,
      unitsNeeded: 2, unitsConfirmed: 0,
      divisionId: places.divisionId, districtId: places.districtId, upazilaId: places.upazilaId,
      approxLat: 22.36, approxLng: 91.83, neededBy: Date.now() + 6 * HOUR, urgency: "today",
      contactPhone: "01712345678", contactPhoneVerified: true, lang: "en",
      publicSlug: `accslug-${Math.random().toString(36).slice(2, 12)}`,
      status: "live", wave: 1, volunteerShownIds: [], fallbackShown: false,
      zeroEligibleAtPublish: false, verifiedBadge: false, slipStatus: "none",
      revealsFrozen: false, hiddenByModerator: false, aiAssisted: false, isDemo: false,
    }),
  );
}

const F = {
  appConfig: makeFunctionReference<"query">("public:appConfig"),
  me: makeFunctionReference<"query">("profiles:me"),
  hospitalsSearch: makeFunctionReference<"query">("hospitals:search"),
  placesChildren: makeFunctionReference<"query">("places:children"),
  consentsAccept: makeFunctionReference<"mutation">("consents:accept"),
  donorsGetMine: makeFunctionReference<"query">("donors:getMine"),
  donorsSetAvailability: makeFunctionReference<"mutation">("donors:setAvailability"),
  requestsListMine: makeFunctionReference<"query">("requests:listMine"),
  requestsClose: makeFunctionReference<"mutation">("requests:close"),
  requestsGetForOwner: makeFunctionReference<"query">("requests:getForOwner"),
  responsesInbox: makeFunctionReference<"query">("responses:inbox"),
  responsesAccept: makeFunctionReference<"mutation">("responses:accept"),
  blocksCreate: makeFunctionReference<"mutation">("blocks:create"),
  notificationsMarkOpened: makeFunctionReference<"mutation">("notifications:markOpened"),
  pushRegister: makeFunctionReference<"mutation">("push:registerExpoToken"),
  pushSendTest: makeFunctionReference<"mutation">("push:sendTest"),
  pushWebStatus: makeFunctionReference<"query">("push:webPushStatus"),
  reportsCreate: makeFunctionReference<"mutation">("reports:create"),
  supportHelpline: makeFunctionReference<"query">("support:helpline"),
  intakeRefData: makeFunctionReference<"query">("intake:refData"),
  intakeParse: makeFunctionReference<"action">("intake:parse"),
  pvStart: makeFunctionReference<"mutation">("phoneVerification:start"),
  pvStatus: makeFunctionReference<"query">("phoneVerification:status"),
  pvLookup: makeFunctionReference<"query">("phoneVerification:lookupInPerson"),
  pvConfirm: makeFunctionReference<"mutation">("phoneVerification:confirmInPerson"),
  volunteersGetMine: makeFunctionReference<"query">("volunteers:getMine"),
  volunteersBoard: makeFunctionReference<"query">("volunteers:board"),
  volunteersSetOnDuty: makeFunctionReference<"mutation">("volunteers:setOnDuty"),
  volunteersSearchDonors: makeFunctionReference<"mutation">("volunteers:searchDonors"),
  bloodBanksNear: makeFunctionReference<"query">("hospitals:bloodBanksNear"),
  whoHasMyNumber: makeFunctionReference<"query">("profiles:whoHasMyNumber"),
  exportMyData: makeFunctionReference<"mutation">("profiles:exportMyData"),
  updateLanguage: makeFunctionReference<"mutation">("profiles:updateLanguage"),
  requestDeletion: makeFunctionReference<"mutation">("profiles:requestDeletion"),
  cancelDeletion: makeFunctionReference<"mutation">("profiles:cancelDeletion"),
  statsDashboard: makeFunctionReference<"query">("stats:dashboard"),
  statsRecompute: makeFunctionReference<"mutation">("stats:recomputeStats"),
  moderationList: makeFunctionReference<"query">("admin/moderation:list"),
  moderationGet: makeFunctionReference<"query">("admin/moderation:get"),
  moderationDecide: makeFunctionReference<"mutation">("admin/moderation:decide"),
  peopleSearch: makeFunctionReference<"query">("admin/people:search"),
  peopleApplications: makeFunctionReference<"query">("admin/people:applications"),
  auditList: makeFunctionReference<"query">("admin/audit:list"),
  aiStatus: makeFunctionReference<"query">("admin/ai:status"),
  aiSetFeature: makeFunctionReference<"mutation">("admin/ai:setFeature"),
  usageGet: makeFunctionReference<"query">("admin/usage:get"),
  usageSetManual: makeFunctionReference<"mutation">("admin/usage:setManualEntry"),
  demoStatus: makeFunctionReference<"query">("admin/demo:status"),
  demoSetEnabled: makeFunctionReference<"mutation">("admin/demo:setEnabled"),
  demoReset: makeFunctionReference<"mutation">("admin/demo:reset"),
  adminSettingsList: makeFunctionReference<"query">("admin/settings:list"),
};

const seedSettings = makeFunctionReference<"mutation">("seed:seedSettings");

describe("P6 access matrix — visitors (no identity)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  it("public functions answer; profiles.me is null (not an error)", async () => {
    const t = newTest();
    await t.mutation(seedSettings, {});
    const cfg = await t.query(F.appConfig, {});
    expect(cfg.consentVersion).toBe("2026-11-28-pilot");
    expect(await t.query(F.me, {})).toBeNull();
    expect(await t.query(F.hospitalsSearch, { text: "medical" })).toEqual([]);
    expect(Array.isArray(await t.query(F.placesChildren, {}))).toBe(true);
  });

  it("every member/volunteer/admin function refuses with ERR_UNAUTHENTICATED", async () => {
    const t = newTest();
    await t.mutation(seedSettings, {});
    const places = await seedPlaces(t);
    const someone = await insertProfile(t, {});
    const requestId = await insertRequest(t, places, someone.profileId);
    const verificationId = await t.run(async (ctx) =>
      await ctx.db.insert("phoneVerifications", {
        profileId: someone.profileId, method: "telegram", token: "tok",
        expiresAt: Date.now() + 600_000, status: "pending",
      }),
    );
    const notificationId = await t.run(async (ctx) =>
      await ctx.db.insert("notifications", {
        recipientId: someone.profileId, template: "NTF-14", channel: "inapp",
        status: "queued", isDemo: false,
      }),
    );
    const itemId = await t.run(async (ctx) =>
      await ctx.db.insert("moderationItems", {
        type: "report", kind: "other" as never, subjectId: someone.profileId,
        severity: "low", status: "open", isDemo: false,
      }),
    );

    const calls: [string, Promise<unknown>][] = [
      ["consents:accept", t.mutation(F.consentsAccept, { kind: "terms_privacy", version: "2026-11-28-pilot", lang: "en" })],
      ["donors:getMine", t.query(F.donorsGetMine, {})],
      ["donors:setAvailability", t.mutation(F.donorsSetAvailability, { availability: "paused" })],
      ["requests:listMine", t.query(F.requestsListMine, { status: "active", paginationOpts: { numItems: 10, cursor: null } })],
      ["requests:close", t.mutation(F.requestsClose, { requestId, reason: "not_needed" })],
      ["requests:getForOwner", t.query(F.requestsGetForOwner, { requestId })],
      ["responses:inbox", t.query(F.responsesInbox, {})],
      ["responses:accept", t.mutation(F.responsesAccept, { requestId, clientId: "c1", selfCheck: true, callMode: "mutual" })],
      ["blocks:create", t.mutation(F.blocksCreate, { profileId: someone.profileId })],
      ["notifications:markOpened", t.mutation(F.notificationsMarkOpened, { notificationId })],
      ["push:registerExpoToken", t.mutation(F.pushRegister, { token: "ExponentPushToken[x]" })],
      ["push:sendTest", t.mutation(F.pushSendTest, {})],
      ["push:webPushStatus", t.query(F.pushWebStatus, {})],
      ["reports:create", t.mutation(F.reportsCreate, { subjectId: someone.profileId, reason: "other", block: false })],
      ["support:helpline", t.query(F.supportHelpline, {})],
      ["intake:refData", t.query(F.intakeRefData, {})],
      ["intake:parse", t.action(F.intakeParse, { text: "B+ blood needed at CMCH tomorrow", lang: "en", source: "text" })],
      ["phoneVerification:start", t.mutation(F.pvStart, { method: "telegram" })],
      ["phoneVerification:status", t.query(F.pvStatus, { verificationId })],
      ["phoneVerification:lookupInPerson", t.query(F.pvLookup, { code: "ABC234" })],
      ["phoneVerification:confirmInPerson", t.mutation(F.pvConfirm, { verificationId, matches: true })],
      ["volunteers:getMine", t.query(F.volunteersGetMine, {})],
      ["volunteers:board", t.query(F.volunteersBoard, {})],
      ["volunteers:setOnDuty", t.mutation(F.volunteersSetOnDuty, { onDuty: true })],
      ["volunteers:searchDonors", t.mutation(F.volunteersSearchDonors, { requestId })],
      ["hospitals:bloodBanksNear", t.query(F.bloodBanksNear, { districtId: places.districtId, upazilaId: places.upazilaId })],
      ["profiles:whoHasMyNumber", t.query(F.whoHasMyNumber, {})],
      ["profiles:exportMyData", t.mutation(F.exportMyData, {})],
      ["profiles:updateLanguage", t.mutation(F.updateLanguage, { language: "bn" })],
      ["profiles:requestDeletion", t.mutation(F.requestDeletion, { confirmWord: "DELETE" })],
      ["profiles:cancelDeletion", t.mutation(F.cancelDeletion, {})],
      ["stats:dashboard", t.query(F.statsDashboard, {})],
      ["stats:recomputeStats", t.mutation(F.statsRecompute, {})],
      ["admin/moderation:list", t.query(F.moderationList, { status: "open" })],
      ["admin/moderation:get", t.query(F.moderationGet, { itemId })],
      ["admin/moderation:decide", t.mutation(F.moderationDecide, { itemId, decision: "warn", reason: "A valid-length reason." })],
      ["admin/people:search", t.query(F.peopleSearch, { text: "Person" })],
      ["admin/people:applications", t.query(F.peopleApplications, {})],
      ["admin/audit:list", t.query(F.auditList, { paginationOpts: { numItems: 10, cursor: null } })],
      ["admin/ai:status", t.query(F.aiStatus, {})],
      ["admin/ai:setFeature", t.mutation(F.aiSetFeature, { feature: "intake", enabled: false })],
      ["admin/usage:get", t.query(F.usageGet, {})],
      ["admin/usage:setManualEntry", t.mutation(F.usageSetManual, { service: "eas", metric: "mau", value: 3 })],
      ["admin/demo:status", t.query(F.demoStatus, {})],
      ["admin/demo:setEnabled", t.mutation(F.demoSetEnabled, { enabled: false })],
      ["admin/demo:reset", t.mutation(F.demoReset, {})],
      ["admin/settings:list", t.query(F.adminSettingsList, {})],
    ];
    for (const [name, call] of calls) {
      expect(await codeOf(call), name).toBe("ERR_UNAUTHENTICATED");
    }
  });
});

describe("P6 access matrix — wrong role", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  async function setup(t: Test) {
    await t.mutation(seedSettings, {});
    const places = await seedPlaces(t);
    const member = await insertProfile(t, { role: "member" });
    const volunteer = await insertProfile(t, { role: "volunteer" });
    const admin = await insertProfile(t, { role: "admin" });
    const requestId = await insertRequest(t, places, member.profileId);
    const verificationId = await t.run(async (ctx) =>
      await ctx.db.insert("phoneVerifications", {
        profileId: member.profileId, method: "in_person", token: "tok2", code: "ABC234",
        expiresAt: Date.now() + 600_000, status: "pending",
      }),
    );
    const itemId = await t.run(async (ctx) =>
      await ctx.db.insert("moderationItems", {
        type: "report", kind: "other" as never, subjectId: member.profileId,
        severity: "low", status: "open", isDemo: false,
      }),
    );
    return { member, volunteer, admin, requestId, verificationId, itemId };
  }

  it("member → volunteer functions: ERR_FORBIDDEN", async () => {
    const t = newTest();
    const s = await setup(t);
    const calls: [string, Promise<unknown>][] = [
      ["volunteers:board", s.member.asUser.query(F.volunteersBoard, {})],
      ["volunteers:setOnDuty", s.member.asUser.mutation(F.volunteersSetOnDuty, { onDuty: true })],
      ["volunteers:searchDonors", s.member.asUser.mutation(F.volunteersSearchDonors, { requestId: s.requestId })],
      ["phoneVerification:lookupInPerson", s.member.asUser.query(F.pvLookup, { code: "ABC234" })],
      ["phoneVerification:confirmInPerson", s.member.asUser.mutation(F.pvConfirm, { verificationId: s.verificationId, matches: true })],
    ];
    for (const [name, call] of calls) {
      expect(await codeOf(call), name).toBe("ERR_FORBIDDEN");
    }
  });

  it("member → admin functions: ERR_FORBIDDEN (every family)", async () => {
    const t = newTest();
    const s = await setup(t);
    const calls: [string, Promise<unknown>][] = [
      ["stats:dashboard", s.member.asUser.query(F.statsDashboard, {})],
      ["stats:recomputeStats", s.member.asUser.mutation(F.statsRecompute, {})],
      ["admin/moderation:list", s.member.asUser.query(F.moderationList, { status: "open" })],
      ["admin/moderation:get", s.member.asUser.query(F.moderationGet, { itemId: s.itemId })],
      ["admin/moderation:decide", s.member.asUser.mutation(F.moderationDecide, { itemId: s.itemId, decision: "warn", reason: "A valid-length reason." })],
      ["admin/people:search", s.member.asUser.query(F.peopleSearch, { text: "Person" })],
      ["admin/people:applications", s.member.asUser.query(F.peopleApplications, {})],
      ["admin/audit:list", s.member.asUser.query(F.auditList, { paginationOpts: { numItems: 10, cursor: null } })],
      ["admin/ai:status", s.member.asUser.query(F.aiStatus, {})],
      ["admin/ai:setFeature", s.member.asUser.mutation(F.aiSetFeature, { feature: "intake", enabled: false })],
      ["admin/usage:get", s.member.asUser.query(F.usageGet, {})],
      ["admin/usage:setManualEntry", s.member.asUser.mutation(F.usageSetManual, { service: "eas", metric: "mau", value: 3 })],
      ["admin/demo:status", s.member.asUser.query(F.demoStatus, {})],
      ["admin/demo:setEnabled", s.member.asUser.mutation(F.demoSetEnabled, { enabled: false })],
      ["admin/demo:reset", s.member.asUser.mutation(F.demoReset, {})],
      ["admin/settings:list", s.member.asUser.query(F.adminSettingsList, {})],
    ];
    for (const [name, call] of calls) {
      expect(await codeOf(call), name).toBe("ERR_FORBIDDEN");
    }
  });

  it("volunteer → admin functions: ERR_FORBIDDEN; admin positive control works", async () => {
    const t = newTest();
    const s = await setup(t);
    expect(await codeOf(s.volunteer.asUser.query(F.statsDashboard, {}))).toBe("ERR_FORBIDDEN");
    expect(await codeOf(s.volunteer.asUser.query(F.moderationList, { status: "open" }))).toBe("ERR_FORBIDDEN");
    expect(await codeOf(s.volunteer.asUser.query(F.peopleSearch, { text: "Person" }))).toBe("ERR_FORBIDDEN");
    expect(await codeOf(s.volunteer.asUser.query(F.demoStatus, {}))).toBe("ERR_FORBIDDEN");
    expect(await codeOf(s.volunteer.asUser.mutation(F.demoReset, {}))).toBe("ERR_FORBIDDEN");
    // Positive control: the same calls succeed for an admin, proving
    // the refusals above are role checks, not broken functions.
    expect(await s.admin.asUser.query(F.moderationList, { status: "open" })).toHaveLength(1);
    await s.admin.asUser.query(F.statsDashboard, {});
    expect((await s.admin.asUser.query(F.adminSettingsList, {})).length).toBeGreaterThanOrEqual(61);
  });
});

describe("P6 access matrix — wrong owner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  it("another member's request/notification/verification is ERR_NOT_FOUND", async () => {
    const t = newTest();
    await t.mutation(seedSettings, {});
    const places = await seedPlaces(t);
    const owner = await insertProfile(t, { name: "Owner" });
    const other = await insertProfile(t, { name: "Other" });
    const requestId = await insertRequest(t, places, owner.profileId);
    const verificationId = await t.run(async (ctx) =>
      await ctx.db.insert("phoneVerifications", {
        profileId: owner.profileId, method: "telegram", token: "tok3",
        expiresAt: Date.now() + 600_000, status: "pending",
      }),
    );
    const notificationId = await t.run(async (ctx) =>
      await ctx.db.insert("notifications", {
        recipientId: owner.profileId, template: "NTF-14", channel: "inapp",
        status: "queued", isDemo: false,
      }),
    );
    expect(await codeOf(other.asUser.mutation(F.requestsClose, { requestId, reason: "not_needed" })))
      .toBe("ERR_NOT_FOUND");
    expect(await codeOf(other.asUser.query(F.requestsGetForOwner, { requestId })))
      .toBe("ERR_NOT_FOUND");
    expect(await codeOf(other.asUser.mutation(F.notificationsMarkOpened, { notificationId })))
      .toBe("ERR_NOT_FOUND");
    expect(await codeOf(other.asUser.query(F.pvStatus, { verificationId })))
      .toBe("ERR_NOT_FOUND");
    // Positive controls: the owner can do all four.
    await owner.asUser.query(F.requestsGetForOwner, { requestId });
    await owner.asUser.mutation(F.notificationsMarkOpened, { notificationId });
    await owner.asUser.query(F.pvStatus, { verificationId });
  });

  it("a live donor cannot accept a request they were never notified on", async () => {
    const t = newTest();
    await t.mutation(seedSettings, {});
    const places = await seedPlaces(t);
    const requester = await insertProfile(t, { name: "Requester" });
    const donor = await insertProfile(t, { name: "Unnotified Donor" });
    const requestId = await insertRequest(t, places, requester.profileId);
    await t.run(async (ctx) =>
      await ctx.db.insert("donorProfiles", {
        profileId: donor.profileId, bloodGroup: "B+" as never, gender: "unspecified",
        divisionId: places.divisionId, districtId: places.districtId, upazilaId: places.upazilaId,
        travelRange: "district", neverDonated: true, plateletOptIn: false,
        availability: "available", availabilityConfirmedAt: Date.now(),
        eligibleFrom: 0, eligibleFromPlatelets: 0, callMode: "mutual",
        volunteersMayCall: false, verifiedRequestsOnly: false, alertCapPerDay: 3,
        quietStart: "00:00", quietEnd: "07:00", urgentOverride: false, hidden: false,
        live: true, selfCheckAt: Date.now(), healthConsentVersion: "2026-11-28-pilot",
        noShowAt: [], isDemo: false,
      }),
    );
    expect(await codeOf(donor.asUser.mutation(F.responsesAccept, {
      requestId, clientId: "acc-accept-1", selfCheck: true, callMode: "mutual",
    }))).toBe("ERR_NOT_FOUND");
  });
});
