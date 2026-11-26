import { describe, expect, it } from "vitest";
import {
  canDonate,
  computeEligibility,
  dateToMs,
  type EligibilitySettings,
} from "../convex/rules/eligibility";
import { groupsFor, isCompatible } from "../convex/rules/compatibility";
import { nextWaveAt, nextWaveSize } from "../convex/rules/waves";
import { canCreateRequest } from "../convex/rules/limits";
import { rankCandidates } from "../convex/rules/ranking";
import { redact } from "../convex/rules/redaction";

const S: EligibilitySettings = {
  minAge: 18,
  maxDonorAge: 65,
  intervalWholeMaleDays: 90,
  intervalWholeOtherDays: 120,
  intervalPlateletDays: 14,
  intervalPlateletToWholeDays: 14,
};
const DAY = 86_400_000;

describe("eligibility (PRD §5.1)", () => {
  it("never donated → eligible immediately", () => {
    expect(
      computeEligibility({ gender: "male", neverDonated: true }, S),
    ).toEqual({ eligibleFrom: 0, eligibleFromPlatelets: 0 });
  });
  it("male whole blood → 90 days for both components", () => {
    const r = computeEligibility(
      { gender: "male", neverDonated: false, lastDonationDate: "2026-09-01", lastDonationType: "whole_blood" },
      S,
    );
    expect(r.eligibleFrom).toBe(dateToMs("2026-09-01") + 90 * DAY);
    expect(r.eligibleFromPlatelets).toBe(r.eligibleFrom);
  });
  it("female whole blood → 120 days", () => {
    const r = computeEligibility(
      { gender: "female", neverDonated: false, lastDonationDate: "2026-09-01", lastDonationType: "whole_blood" },
      S,
    );
    expect(r.eligibleFrom).toBe(dateToMs("2026-09-01") + 120 * DAY);
  });
  it("platelets → 14 days to platelets and to whole blood", () => {
    const r = computeEligibility(
      { gender: "male", neverDonated: false, lastDonationDate: "2026-09-01", lastDonationType: "platelets" },
      S,
    );
    expect(r.eligibleFromPlatelets).toBe(dateToMs("2026-09-01") + 14 * DAY);
    expect(r.eligibleFrom).toBe(dateToMs("2026-09-01") + 14 * DAY);
  });
  it("age gate: 17 blocked, 18 ok, 66 blocked (DOB in Asia/Dhaka)", () => {
    const now = dateToMs("2026-11-26");
    const base = { gender: "male" as const, neverDonated: true, plateletOptIn: true };
    expect(canDonate(base, "whole_blood", now, S, "2009-11-27").ok).toBe(false); // 16, turning 17
    expect(canDonate(base, "whole_blood", now, S, "2008-11-26").ok).toBe(true); // exactly 18
    expect(canDonate(base, "whole_blood", now, S, "1960-11-25").ok).toBe(false); // 66
    expect(canDonate(base, "whole_blood", now, S, "1961-11-26").ok).toBe(true); // exactly 65
  });
  it("cooldown blocks with the eligible date; platelet opt-in required", () => {
    const now = dateToMs("2026-10-01");
    const donor = {
      gender: "male" as const, neverDonated: false,
      lastDonationDate: "2026-09-01", lastDonationType: "whole_blood" as const,
      plateletOptIn: false,
    };
    const r = canDonate(donor, "whole_blood", now, S, "2000-01-01");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("cooldown");
      expect(r.date).toBe(dateToMs("2026-09-01") + 90 * DAY);
    }
    const p = canDonate({ ...donor, neverDonated: true }, "platelets", now, S, "2000-01-01");
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toBe("platelets");
  });
});

describe("compatibility (PRD §5.2)", () => {
  const on = { compatibleInFinalWave: true };
  const off = { compatibleInFinalWave: false };
  it("exact only before the final wave", () => {
    expect(groupsFor("A+", "whole_blood", false, on)).toEqual({ exact: ["A+"], compatible: [] });
  });
  it("compatible groups join in the final wave when S-11 is on", () => {
    expect(groupsFor("A+", "whole_blood", true, on).compatible).toEqual(["A-", "O+", "O-"]);
    expect(groupsFor("AB+", "whole_blood", true, on).compatible).toHaveLength(7);
    expect(groupsFor("O-", "whole_blood", true, on).compatible).toEqual([]);
    expect(groupsFor("A+", "whole_blood", true, off).compatible).toEqual([]);
  });
  it("platelets are exact only, even in the final wave", () => {
    expect(groupsFor("B-", "platelets", true, on)).toEqual({ exact: ["B-"], compatible: [] });
  });
  it("'any' matches all groups; 'not_sure' matches none", () => {
    expect(groupsFor("any", "whole_blood", false, on).exact).toHaveLength(8);
    expect(groupsFor("not_sure", "whole_blood", true, on)).toEqual({ exact: [], compatible: [] });
    expect(isCompatible("O-", "AB+", "whole_blood", true, on)).toBe(true);
    expect(isCompatible("O-", "AB+", "whole_blood", false, on)).toBe(false);
  });
});

describe("waves (PRD §5.4)", () => {
  const ws = { waveSizes: [10, 25, 50], waveIntervalMin: { now: 5, today: 15, later: 30 }, waveCount: 3 };
  it("sizes come from settings; later waves shrink by opened-unanswered", () => {
    expect(nextWaveSize(1, 0, ws)).toBe(10);
    expect(nextWaveSize(2, 4, ws)).toBe(21);
    expect(nextWaveSize(3, 60, ws)).toBe(0);
    expect(nextWaveSize(4, 0, ws)).toBe(0);
  });
  it("interval depends on urgency", () => {
    const now = 1_000_000;
    expect(nextWaveAt({ urgency: "now" }, ws, now)).toBe(now + 5 * 60_000);
    expect(nextWaveAt({ urgency: "later" }, ws, now)).toBe(now + 30 * 60_000);
  });
});

describe("limits (PRD §5.8)", () => {
  const ls = { openRequestsUnverified: 1, openRequestsVerified: 2, requestsPerMonth: 5, volunteerRequestsPerMonth: 20 };
  it("unverified phone → 1 open request; verified → 2", () => {
    expect(canCreateRequest({ phoneVerified: false }, { open: 1, thisMonth: 0, isVolunteerPosting: false }, ls).ok).toBe(false);
    expect(canCreateRequest({ phoneVerified: true }, { open: 1, thisMonth: 0, isVolunteerPosting: false }, ls).ok).toBe(true);
    expect(canCreateRequest({ phoneVerified: true }, { open: 2, thisMonth: 0, isVolunteerPosting: false }, ls).ok).toBe(false);
  });
  it("monthly caps differ for volunteers posting on behalf", () => {
    expect(canCreateRequest({ phoneVerified: true }, { open: 0, thisMonth: 5, isVolunteerPosting: false }, ls).ok).toBe(false);
    expect(canCreateRequest({ phoneVerified: true }, { open: 0, thisMonth: 5, isVolunteerPosting: true }, ls).ok).toBe(true);
  });
});

describe("ranking tiers (PRD §5.3)", () => {
  it("same thana → neighbours → district → division", () => {
    const req = { upazilaId: "u1", districtId: "d1", divisionId: "v1", neighbourUpazilaIds: ["u2"] };
    const mk = (id: string, u: string, d: string, v: string) => ({
      donorProfileId: id, upazilaId: u, districtId: d, divisionId: v, lastActiveAt: 0, alertsLast7Days: 0,
    });
    const ranked = rankCandidates(
      [mk("div", "u9", "d9", "v1"), mk("dist", "u8", "d1", "v1"), mk("same", "u1", "d1", "v1"), mk("nbr", "u2", "d1", "v1")],
      req,
    );
    expect(ranked.map((r) => r.donorProfileId)).toEqual(["same", "nbr", "dist", "div"]);
  });
});

describe("redaction (PRD §6.2)", () => {
  it("removes BD phone numbers in Latin and Bangla digits, emails, diagnoses", () => {
    const r = redact("Call 01712-345678 or +880 1812 345678, mail a@b.com, patient has cancer");
    expect(r.text).not.toContain("01712");
    expect(r.text).not.toContain("1812");
    expect(r.text).not.toContain("a@b.com");
    expect(r.text.toLowerCase()).not.toContain("cancer");
    expect(r.removed.phones).toBe(2);
    const bn = redact("নম্বর ০১৭১২৩৪৫৬৭৮");
    expect(bn.removed.phones).toBe(1);
    expect(bn.text).not.toContain("০১৭১২");
  });
  it("removes text after name labels", () => {
    const r = redact("Patient: Rahim Uddin, B+ needed");
    expect(r.text).not.toContain("Rahim Uddin");
    expect(r.removed.names).toBeGreaterThan(0);
  });
});
