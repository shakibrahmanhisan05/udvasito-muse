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
      level: "division", code: `DIV6-${placeSeq}`, nameEn: "Chattogram", nameBn: "চট্টগ্রাম",
      lat: 22.35, lng: 91.8, isMetroThana: false, neighbourIds: [],
    });
    const districtId = await ctx.db.insert("places", {
      level: "district", code: `DIS6-${placeSeq}`, nameEn: "Chattogram", nameBn: "চট্টগ্রাম",
      parentId: divisionId, lat: 22.35, lng: 91.8, isMetroThana: false, neighbourIds: [],
    });
    const upazilaId = await ctx.db.insert("places", {
      level: "upazila", code: `UPA6-${placeSeq}`, nameEn: "Kotwali", nameBn: "কোতোয়ালী",
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
  const authUserId = `p6-user-${userSeq}`;
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
      clientId: `client6-${Math.random().toString(36).slice(2)}`,
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
      publicSlug: `slug6-${Math.random().toString(36).slice(2, 12)}`,
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

// ─────────────────────────────────────────────────────────────────────
// Slice 1 — P5 review F1 (S3): dismiss/warn must choose lift-or-keep
// for the item's P2 auto-freezes (SCR-A03), and the NTF-14 wording
// must match the real outcome. Every decision × freeze-state
// combination is covered here or in tests/p6-rules.test.ts (wording).
// ─────────────────────────────────────────────────────────────────────

describe("P6 slice 1 — moderation freeze choice (SCR-A03, P5 F1)", () => {
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

  /** File a real money report → subject auto-frozen + open item. */
  async function moneyFreeze(t: Test, s: Awaited<ReturnType<typeof setup>>) {
    const out = await s.reporter.asUser.mutation(reportsCreate, {
      subjectId: s.subject.profileId, reason: "money" as const, block: false,
    });
    expect(out.autoAction).toBe("account_frozen");
    const queue = await s.admin.asUser.query(moderationList, { status: "open" });
    expect(queue).toHaveLength(1);
    return queue[0].itemId as Id<"moderationItems">;
  }

  it("dismiss/warn on a frozen account REQUIRE an explicit freeze choice", async () => {
    const t = newTest();
    const s = await setup(t);
    const itemId = await moneyFreeze(t, s);
    for (const decision of ["dismiss", "warn"] as const) {
      expect(await codeOf(s.admin.asUser.mutation(moderationDecide, {
        itemId, decision, reason: "Reviewed the report and the history.",
      }))).toBe("ERR_VALIDATION");
    }
    // The item is still open and the account still frozen.
    const item = await t.run(async (ctx) => await ctx.db.get(itemId));
    expect(item!.status).toBe("open");
    const profile = await t.run(async (ctx) => await ctx.db.get(s.subject.profileId));
    expect(profile!.status).toBe("frozen");
  });

  it("dismiss + keep: item closes, account STAYS frozen, audit/event say kept", async () => {
    const t = newTest();
    const s = await setup(t);
    const itemId = await moneyFreeze(t, s);
    await s.admin.asUser.mutation(moderationDecide, {
      itemId, decision: "dismiss" as const, freezeChoice: "keep" as const,
      reason: "Report unproven, but other reports are still being checked.",
    });
    const profile = await t.run(async (ctx) => await ctx.db.get(s.subject.profileId));
    expect(profile!.status).toBe("frozen");
    const audits = await auditRows(t, "moderation_decided");
    expect(audits).toHaveLength(1);
    expect(audits[0].meta?.freezeChoice).toBe("keep");
    expect(audits[0].meta?.freezesLifted).toEqual([]);
    const events = await decidedEvents(t);
    expect(events).toHaveLength(1);
    expect(events[0].props?.freeze).toBe("kept");
    expect((await notificationsTo(t, s.subject.profileId, "NTF-14")).length).toBe(1);
  });

  it("dismiss + lift: account active again, donor live recomputed, audit says lifted", async () => {
    const t = newTest();
    const s = await setup(t);
    const donorId = await insertDonor(t, s.places, s.subject.profileId, { live: true });
    const itemId = await moneyFreeze(t, s);
    const frozenDonor = await t.run(async (ctx) => await ctx.db.get(donorId));
    expect(frozenDonor!.live).toBe(false); // the auto-freeze took them offline
    await s.admin.asUser.mutation(moderationDecide, {
      itemId, decision: "dismiss" as const, freezeChoice: "lift" as const,
      reason: "The family confirmed no money was ever asked for.",
    });
    const profile = await t.run(async (ctx) => await ctx.db.get(s.subject.profileId));
    expect(profile!.status).toBe("active");
    expect(profile!.statusReason).toBeUndefined();
    const donor = await t.run(async (ctx) => await ctx.db.get(donorId));
    expect(donor!.live).toBe(true);
    const audits = await auditRows(t, "moderation_decided");
    expect(audits[0].meta?.freezeChoice).toBe("lift");
    expect(audits[0].meta?.freezesLifted).toEqual(["account"]);
    expect((await decidedEvents(t))[0].props?.freeze).toBe("lifted");
  });

  it("warn + keep leaves the freeze; warn + lift removes it (fresh item each)", async () => {
    const t = newTest();
    const s = await setup(t);
    const item1 = await moneyFreeze(t, s);
    await s.admin.asUser.mutation(moderationDecide, {
      itemId: item1, decision: "warn" as const, freezeChoice: "keep" as const,
      reason: "First warning; freeze stays while a second report is checked.",
    });
    expect((await t.run(async (ctx) => await ctx.db.get(s.subject.profileId)))!.status).toBe("frozen");
    // Unfreeze out-of-band (as admin.people restore would), re-freeze via
    // a second money report, then warn + lift.
    await t.run(async (ctx) => await ctx.db.patch(s.subject.profileId, { status: "active", statusReason: undefined }));
    const item2 = await moneyFreeze(t, s);
    await s.admin.asUser.mutation(moderationDecide, {
      itemId: item2, decision: "warn" as const, freezeChoice: "lift" as const,
      reason: "Warned in person; the freeze was a misunderstanding.",
    });
    expect((await t.run(async (ctx) => await ctx.db.get(s.subject.profileId)))!.status).toBe("active");
    expect((await notificationsTo(t, s.subject.profileId, "NTF-14")).length).toBe(2);
  });

  it("reveals freeze: dismiss + keep keeps sharing paused; dismiss + lift resumes it", async () => {
    const t = newTest();
    const s = await setup(t);
    const requestId = await insertRequest(t, s.places, s.subject.profileId);
    const donorProfile = await insertProfile(t, { name: "Confirmed Donor" });
    const donorRow = await insertDonor(t, s.places, donorProfile.profileId);
    await t.run(async (ctx) =>
      await ctx.db.insert("responses", {
        requestId, donorProfileId: donorRow, donorId: donorProfile.profileId,
        wave: 1, state: "confirmed", notifiedAt: Date.now(), acceptedAt: Date.now(),
        callMode: "mutual", isDemo: false,
      }),
    );
    const out = await donorProfile.asUser.mutation(reportsCreate, {
      subjectId: s.subject.profileId, requestId, reason: "fake" as const, block: false,
    });
    expect(out.autoAction).toBe("reveals_frozen");
    expect((await t.run(async (ctx) => await ctx.db.get(requestId)))!.revealsFrozen).toBe(true);
    const queue = await s.admin.asUser.query(moderationList, { status: "open" });
    const itemId = queue[0].itemId;
    // No choice → refused, freeze untouched.
    expect(await codeOf(s.admin.asUser.mutation(moderationDecide, {
      itemId, decision: "dismiss" as const, reason: "Looked into the fake-request report.",
    }))).toBe("ERR_VALIDATION");
    await s.admin.asUser.mutation(moderationDecide, {
      itemId, decision: "dismiss" as const, freezeChoice: "keep" as const,
      reason: "Request looks genuine but sharing stays paused for now.",
    });
    expect((await t.run(async (ctx) => await ctx.db.get(requestId)))!.revealsFrozen).toBe(true);
    // The requester (the item's subject) was notified.
    expect((await notificationsTo(t, s.subject.profileId, "NTF-14")).length).toBe(1);
  });

  it("both freezes on one item: one choice lifts both; audit lists both", async () => {
    const t = newTest();
    const s = await setup(t);
    const requestId = await insertRequest(t, s.places, s.subject.profileId);
    await t.run(async (ctx) => {
      await ctx.db.patch(s.subject.profileId, { status: "frozen", statusReason: "report_money" });
      await ctx.db.patch(requestId, { revealsFrozen: true });
    });
    const itemId = await t.run(async (ctx) =>
      await ctx.db.insert("moderationItems", {
        type: "report", kind: "money" as never, subjectId: s.subject.profileId,
        requestId, severity: "high", status: "open", isDemo: false,
      }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("reports", {
        reporterId: s.reporter.profileId, subjectId: s.subject.profileId, requestId,
        reason: "money", autoAction: "account_frozen", moderationItemId: itemId, isDemo: false,
      });
      await ctx.db.insert("reports", {
        reporterId: s.reporter.profileId, subjectId: s.subject.profileId, requestId,
        reason: "fake", autoAction: "reveals_frozen", moderationItemId: itemId, isDemo: false,
      });
    });
    await s.admin.asUser.mutation(moderationDecide, {
      itemId, decision: "warn" as const, freezeChoice: "lift" as const,
      reason: "Warned; both automatic freezes were mistakes.",
    });
    expect((await t.run(async (ctx) => await ctx.db.get(s.subject.profileId)))!.status).toBe("active");
    expect((await t.run(async (ctx) => await ctx.db.get(requestId)))!.revealsFrozen).toBe(false);
    const audits = await auditRows(t, "moderation_decided");
    expect(audits[0].meta?.freezesLifted).toEqual(["account", "reveals"]);
  });

  it("no-freeze items decide exactly as before (choice not required, choice ignored if passed)", async () => {
    const t = newTest();
    const s = await setup(t);
    const itemId = await t.run(async (ctx) =>
      await ctx.db.insert("moderationItems", {
        type: "report", kind: "harassment" as never, subjectId: s.subject.profileId,
        severity: "medium", status: "open", isDemo: false,
      }),
    );
    await s.admin.asUser.mutation(moderationDecide, {
      itemId, decision: "dismiss" as const, reason: "A misunderstanding between neighbours.",
    });
    const item = await t.run(async (ctx) => await ctx.db.get(itemId));
    expect(item!.status).toBe("decided");
    expect((await decidedEvents(t))[0].props?.freeze).toBe("none");
  });

  it("a freeze already lifted by another path no longer forces a choice", async () => {
    const t = newTest();
    const s = await setup(t);
    const itemId = await moneyFreeze(t, s);
    // Another admin restored the account from the people screen first.
    await t.run(async (ctx) => await ctx.db.patch(s.subject.profileId, { status: "active", statusReason: undefined }));
    await s.admin.asUser.mutation(moderationDecide, {
      itemId, decision: "dismiss" as const, reason: "Account already restored by a colleague.",
    });
    const item = await t.run(async (ctx) => await ctx.db.get(itemId));
    expect(item!.status).toBe("decided");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Slice 2 — re-consent machinery (roadmap P6, D-R5): when the
// settings consentVersion advances past a member's accepted version,
// G3 (profiles.me needsConsent) blocks until they accept the CURRENT
// version; stale acceptances are rejected server-side.
// ─────────────────────────────────────────────────────────────────────

describe("P6 slice 2 — re-consent when consentVersion advances", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  const NEW_VERSION = "2026-12-08-final";

  async function advanceVersion(t: Test, version: string) {
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("settings")
        .withIndex("by_key", (q) => q.eq("key", "consentVersion"))
        .unique();
      expect(row).not.toBeNull();
      await ctx.db.patch(row!._id, { value: version });
    });
  }

  async function consentRows(t: Test, profileId: Id<"profiles">) {
    return await t.run(async (ctx) =>
      (await ctx.db.query("consents").collect()).filter((c) => c.profileId === profileId),
    );
  }

  it("unchanged version → no prompt (needsConsent stays false)", async () => {
    const t = newTest();
    await t.mutation(seedSettings, {});
    const member = await insertProfile(t, { consentVersion: "2026-11-28-pilot" });
    const me = await member.asUser.query(profilesMe, {});
    expect(me!.needsConsent).toBe(false);
    expect(me!.consentVersion).toBe("2026-11-28-pilot");
  });

  it("advanced version → blocked at G3 until the CURRENT version is accepted", async () => {
    const t = newTest();
    await t.mutation(seedSettings, {});
    const member = await insertProfile(t, { consentVersion: "2026-11-28-pilot" });
    await advanceVersion(t, NEW_VERSION);

    // Blocked: the server side of G3 reports the mismatch.
    const blocked = await member.asUser.query(profilesMe, {});
    expect(blocked!.needsConsent).toBe(true);
    expect(blocked!.consentVersion).toBe("2026-11-28-pilot");

    // A stale acceptance (old version) is rejected and changes nothing.
    expect(await codeOf(member.asUser.mutation(acceptConsent, {
      kind: "terms_privacy" as const, version: "2026-11-28-pilot", lang: "en" as const,
    }))).toBe("ERR_VALIDATION");
    expect((await member.asUser.query(profilesMe, {}))!.needsConsent).toBe(true);
    expect(await consentRows(t, member.profileId)).toHaveLength(0);

    // A guessed/future version is rejected too.
    expect(await codeOf(member.asUser.mutation(acceptConsent, {
      kind: "terms_privacy" as const, version: "2099-01-01-guessed", lang: "en" as const,
    }))).toBe("ERR_VALIDATION");

    // Accepting the current version unblocks and records the consent.
    await member.asUser.mutation(acceptConsent, {
      kind: "terms_privacy" as const, version: NEW_VERSION, lang: "bn" as const,
    });
    const after = await member.asUser.query(profilesMe, {});
    expect(after!.needsConsent).toBe(false);
    expect(after!.consentVersion).toBe(NEW_VERSION);
    const rows = await consentRows(t, member.profileId);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("terms_privacy");
    expect(rows[0].version).toBe(NEW_VERSION);
    expect(rows[0].lang).toBe("bn");
  });

  it("a member who joined on the new version is never prompted", async () => {
    const t = newTest();
    await t.mutation(seedSettings, {});
    await advanceVersion(t, NEW_VERSION);
    const member = await insertProfile(t, { consentVersion: NEW_VERSION });
    expect((await member.asUser.query(profilesMe, {}))!.needsConsent).toBe(false);
  });

  it("non-terms consents are not version-gated (donor health consent still records)", async () => {
    const t = newTest();
    await t.mutation(seedSettings, {});
    await advanceVersion(t, NEW_VERSION);
    const member = await insertProfile(t, { consentVersion: "2026-11-28-pilot" });
    await member.asUser.mutation(acceptConsent, {
      kind: "donor_health_contact" as const, version: "2026-11-28-pilot", lang: "en" as const,
    });
    const rows = await consentRows(t, member.profileId);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("donor_health_contact");
    // …and the terms gate is unaffected by it.
    expect((await member.asUser.query(profilesMe, {}))!.needsConsent).toBe(true);
  });

  it("visitors cannot record consent (member wrapper)", async () => {
    const t = newTest();
    await t.mutation(seedSettings, {});
    expect(await codeOf(t.mutation(acceptConsent, {
      kind: "terms_privacy" as const, version: "2026-11-28-pilot", lang: "en" as const,
    }))).toBe("ERR_UNAUTHENTICATED");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Slice 3 — public pages data: public.appConfig now also serves the
// public-by-design contactEmail + medicalReviewer settings that the
// SCR-P01 footer and SCR-P05 About page render (only when set).
// ─────────────────────────────────────────────────────────────────────

const appConfigRef = makeFunctionReference<"query">("public:appConfig");

describe("P6 slice 3 — appConfig public contact/reviewer values", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  async function setSetting(t: Test, key: string, value: unknown) {
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("settings")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      expect(row).not.toBeNull();
      await ctx.db.patch(row!._id, { value });
    });
  }

  it("defaults are empty (pages hide the lines) and set values flow through", async () => {
    const t = newTest();
    await t.mutation(seedSettings, {});
    const before = await t.query(appConfigRef, {});
    expect(before.contactEmail).toBe("");
    expect(before.medicalReviewer).toEqual({ name: "", reviewedAt: 0 });
    await setSetting(t, "contactEmail", "team@example.org");
    await setSetting(t, "medicalReviewer", { name: "Dr. Example", reviewedAt: T0 });
    const after = await t.query(appConfigRef, {});
    expect(after.contactEmail).toBe("team@example.org");
    expect(after.medicalReviewer).toEqual({ name: "Dr. Example", reviewedAt: T0 });
    // The P0 contract is unchanged.
    expect(after.consentVersion).toBe("2026-11-28-pilot");
    expect(after.apkUrl).toBe("");
  });
});
