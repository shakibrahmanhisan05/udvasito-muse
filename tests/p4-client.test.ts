import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerPush } from "@convex-dev/expo-push-notifications/test";
import schema from "../convex/schema";
import { Outbox, type KeyValueStorage, type OutboxItem } from "../src/lib/outbox";
import { formatCount, formatDateTime, formatTime } from "../src/lib/format";
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

// Same harness pattern as tests/p4.test.ts.
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
const requestsCreate = makeFunctionReference<"mutation">("requests:create");
const T0 = Date.parse("2026-12-03T06:00:00.000Z");
const CONSENT_VERSION = "2026-11-28-pilot";
let seq = 0;

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => {
      data.set(k, v);
    },
  };
}

const item = (clientId: string): OutboxItem => ({
  clientId,
  payload: { clientId },
  queuedAt: 1,
});

describe("P4 — offline outbox queue logic (F-207)", () => {
  it("enqueue dedupes by clientId and persists across instances", async () => {
    const storage = memoryStorage();
    const box = new Outbox(storage);
    await box.enqueue(item("a"));
    await box.enqueue(item("a"));
    await box.enqueue(item("b"));
    expect((await box.list()).map((i) => i.clientId)).toEqual(["a", "b"]);
    // A fresh instance (app restart) sees the same persisted queue.
    expect((await new Outbox(storage).list()).map((i) => i.clientId)).toEqual(["a", "b"]);
  });

  it("flush sends oldest-first, removes successes, stops at the first failure", async () => {
    const box = new Outbox(memoryStorage());
    await box.enqueue(item("a"));
    await box.enqueue(item("b"));
    await box.enqueue(item("c"));
    const attempted: string[] = [];
    const res = await box.flush(async (i) => {
      attempted.push(i.clientId);
      if (i.clientId === "b") throw new Error("still offline");
    });
    expect(attempted).toEqual(["a", "b"]);
    expect(res).toEqual({ sent: 1, remaining: 2 });
    expect((await box.list()).map((i) => i.clientId)).toEqual(["b", "c"]);
    // Reconnect: the rest flush, queue empties.
    const res2 = await box.flush(async () => {});
    expect(res2).toEqual({ sent: 2, remaining: 0 });
    expect(await box.list()).toEqual([]);
  });
});

describe("P4 — Bangla display formatting (X02)", () => {
  it("counts use Bangla digits in bn and Latin digits in en", () => {
    expect(formatCount(12, "bn")).toBe("১২");
    expect(formatCount(12, "en")).toBe("12");
    expect(formatCount(0, "bn")).toBe("০");
  });

  it("date/time formatting localises digits with the language", () => {
    const ts = Date.parse("2026-12-03T06:05:00.000Z");
    expect(formatTime(ts, "en")).not.toMatch(/[০-৯]/);
    expect(formatTime(ts, "bn")).toMatch(/[০-৯]/);
    expect(formatDateTime(ts, "bn")).toMatch(/[০-৯]/);
  });
});

describe("P4 — offline post → reconnect → exactly ONE request (DoD)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a queued post flushes once; a re-flush hits server idempotency, never a duplicate", async () => {
    const t = convexTest(schema, modules);
    registerRateLimiter(t);
    registerPush(t);
    await t.mutation(seedSettings, {});
    const world = await t.run(async (ctx) => {
      const divisionId = await ctx.db.insert("places", {
        level: "division", code: "DIV-Q", nameEn: "Chattogram", nameBn: "চট্টগ্রাম",
        lat: 22.7, lng: 91.7, isMetroThana: false, neighbourIds: [],
      });
      const districtId = await ctx.db.insert("places", {
        level: "district", code: "DIS-Q", nameEn: "Chattogram", nameBn: "চট্টগ্রাম",
        parentId: divisionId, lat: 22.335, lng: 91.834, isMetroThana: false, neighbourIds: [],
      });
      const upazilaId = await ctx.db.insert("places", {
        level: "upazila", code: "UP-Q1", nameEn: "Panchlaish", nameBn: "পাঁচলাইশ",
        parentId: districtId, lat: 22.373, lng: 91.829, isMetroThana: true, neighbourIds: [],
      });
      const hospitalId = await ctx.db.insert("hospitals", {
        nameEn: "Chittagong Medical College Hospital",
        nameBn: "চট্টগ্রাম মেডিকেল কলেজ হাসপাতাল",
        aliases: ["CMCH"], searchText: "cmch", type: "hospital",
        divisionId, districtId, upazilaId, lat: 22.359, lng: 91.831,
        active: true, isDemo: false,
      });
      return { divisionId, districtId, upazilaId, hospitalId };
    });
    seq += 1;
    const subject = `offline-user-${seq}`;
    const asUser = t.withIdentity({ subject, name: "Offline Poster" });
    await asUser.mutation(completeOnboarding, {
      name: "Offline Poster",
      dateOfBirth: "1995-05-01",
      phone: "01712345678",
      language: "en" as const,
      consentVersion: CONSENT_VERSION,
      consentAcceptedAt: Date.now(),
    });
    await t.run(async (ctx) => {
      const p = await ctx.db
        .query("profiles")
        .withIndex("by_authUserId", (q) => q.eq("authUserId", subject))
        .unique();
      await ctx.db.patch(p!._id, { phoneVerified: true, phoneVerifiedVia: "telegram" });
    });

    const payload = {
      clientId: "offline-post-1",
      bloodGroup: "B+" as never,
      component: "whole_blood" as const,
      isDengue: false,
      unitsNeeded: 2,
      hospitalId: world.hospitalId as never,
      divisionId: world.divisionId as never,
      districtId: world.districtId as never,
      upazilaId: world.upazilaId as never,
      neededBy: Date.now() + 6 * 3_600_000,
      contactPhone: "01712345678",
      source: "text" as const,
      aiAssisted: false,
      lang: "en" as const,
    };

    // "Offline": the member posts, the mutation is never reached, the
    // exact args wait in the outbox ("Waiting for network").
    const box = new Outbox(memoryStorage());
    await box.enqueue({ clientId: payload.clientId, payload, queuedAt: Date.now() });
    expect(await t.run(async (ctx) => await ctx.db.query("requests").collect())).toHaveLength(0);

    // Reconnect: flush through the real mutation.
    const send = async (i: OutboxItem) =>
      await asUser.mutation(requestsCreate, i.payload as never);
    const first = await box.flush(send);
    expect(first).toEqual({ sent: 1, remaining: 0 });
    let requests = await t.run(async (ctx) => await ctx.db.query("requests").collect());
    expect(requests).toHaveLength(1);

    // A duplicate flush attempt (flaky network, double retry) with the
    // same clientId returns the existing request — still exactly one.
    await box.enqueue({ clientId: payload.clientId, payload, queuedAt: Date.now() });
    const second = await box.flush(send);
    expect(second.sent).toBe(1);
    requests = await t.run(async (ctx) => await ctx.db.query("requests").collect());
    expect(requests).toHaveLength(1);
    expect(requests[0]!.clientId).toBe("offline-post-1");
  });
});
