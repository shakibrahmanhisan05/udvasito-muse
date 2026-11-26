import { describe, expect, it } from "vitest";
import { rankCandidates } from "../convex/rules/ranking";
import {
  alertAllowed,
  isQuietHours,
  noShowCountWithin,
  pruneNoShows,
  startOfDhakaDay,
} from "../convex/rules/alertPolicy";

// Asia/Dhaka is UTC+6 year-round. 2026-11-29 12:00 +06 = 06:00 UTC.
const DHAKA_NOON = Date.parse("2026-11-29T06:00:00.000Z");
const DHAKA_3AM = Date.parse("2026-11-28T21:00:00.000Z"); // 03:00 +06 on the 29th

describe("quiet hours (S-21)", () => {
  it("default window 00:00–07:00 contains 03:00 but not noon", () => {
    expect(isQuietHours(DHAKA_3AM, "00:00", "07:00")).toBe(true);
    expect(isQuietHours(DHAKA_NOON, "00:00", "07:00")).toBe(false);
  });

  it("wrapping window 22:00–06:00 contains 03:00 and 23:30, not noon", () => {
    const dhaka2330 = Date.parse("2026-11-29T17:30:00.000Z");
    expect(isQuietHours(DHAKA_3AM, "22:00", "06:00")).toBe(true);
    expect(isQuietHours(dhaka2330, "22:00", "06:00")).toBe(true);
    expect(isQuietHours(DHAKA_NOON, "22:00", "06:00")).toBe(false);
  });

  it("empty window (start == end) is never quiet", () => {
    expect(isQuietHours(DHAKA_3AM, "03:00", "03:00")).toBe(false);
  });
});

describe("alert policy (S-20 cap + S-21 quiet hours)", () => {
  const base = {
    alertsToday: 0,
    capPerDay: 3,
    quietStart: "00:00",
    quietEnd: "07:00",
    urgency: "today" as const,
    urgentOverride: false,
  };

  it("allows a normal daytime alert under the cap", () => {
    expect(alertAllowed({ ...base, now: DHAKA_NOON })).toBe(true);
  });

  it("blocks at the daily cap", () => {
    expect(alertAllowed({ ...base, now: DHAKA_NOON, alertsToday: 3 })).toBe(false);
  });

  it("blocks during quiet hours for non-urgent requests", () => {
    expect(alertAllowed({ ...base, now: DHAKA_3AM })).toBe(false);
  });

  it("urgent override lets a 'now' request through quiet hours only when opted in", () => {
    expect(
      alertAllowed({ ...base, now: DHAKA_3AM, urgency: "now", urgentOverride: true }),
    ).toBe(true);
    expect(
      alertAllowed({ ...base, now: DHAKA_3AM, urgency: "now", urgentOverride: false }),
    ).toBe(false);
    expect(
      alertAllowed({ ...base, now: DHAKA_3AM, urgency: "today", urgentOverride: true }),
    ).toBe(false);
  });

  it("the cap still applies during an urgent override", () => {
    expect(
      alertAllowed({
        ...base, now: DHAKA_3AM, urgency: "now", urgentOverride: true, alertsToday: 3,
      }),
    ).toBe(false);
  });
});

describe("Dhaka day boundary", () => {
  it("startOfDhakaDay is 18:00 UTC the previous day", () => {
    expect(startOfDhakaDay(DHAKA_NOON)).toBe(Date.parse("2026-11-28T18:00:00.000Z"));
    expect(startOfDhakaDay(DHAKA_3AM)).toBe(Date.parse("2026-11-28T18:00:00.000Z"));
  });
});

describe("no-show window (S-37)", () => {
  const now = DHAKA_NOON;
  const old = now - 91 * 86_400_000;
  const recent = now - 10 * 86_400_000;

  it("counts only no-shows inside the window", () => {
    expect(noShowCountWithin([old, recent, recent], now, 90)).toBe(2);
  });

  it("prunes entries outside the window", () => {
    expect(pruneNoShows([old, recent], now, 90)).toEqual([recent]);
  });
});

describe("ranking tie-breakers (PRD §5.3 step 3)", () => {
  const req = { upazilaId: "u1", districtId: "d1", divisionId: "v1", neighbourUpazilaIds: [] };
  const mk = (id: string, extra: object) => ({
    donorProfileId: id, upazilaId: "u1", districtId: "d1", divisionId: "v1",
    lastActiveAt: 100, alertsLast7Days: 0, ...extra,
  });

  it("exact group before compatible within the same tier", () => {
    const ranked = rankCandidates(
      [mk("compat", { exactGroup: false, lastActiveAt: 999 }), mk("exact", { exactGroup: true })],
      req,
    );
    expect(ranked.map((r) => r.donorProfileId)).toEqual(["exact", "compat"]);
  });

  it("then most recently active, fewer alerts last 7 days, lower no-show count", () => {
    const ranked = rankCandidates(
      [
        mk("a", { lastActiveAt: 50 }),
        mk("b", { lastActiveAt: 80, alertsLast7Days: 2 }),
        mk("c", { lastActiveAt: 80, alertsLast7Days: 1, noShowCount: 1 }),
        mk("d", { lastActiveAt: 80, alertsLast7Days: 1, noShowCount: 0 }),
      ],
      req,
    );
    expect(ranked.map((r) => r.donorProfileId)).toEqual(["d", "c", "b", "a"]);
  });
});
