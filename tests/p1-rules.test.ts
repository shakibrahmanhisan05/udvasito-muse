import { describe, expect, it } from "vitest";
import {
  containsMoneyWord,
  normalisePhone,
  validateDonorForm,
  validateInPersonCode,
  validateRequestForm,
  type ValidationResult,
} from "../convex/rules/validation";
import { haversineKm } from "../convex/rules/ranking";
import { canDonate, computeEligibility, dateToMs, type EligibilitySettings } from "../convex/rules/eligibility";

const NOW = Date.UTC(2026, 10, 26, 6, 0, 0); // Thu 26 Nov 2026
const DAY = 86_400_000;

function code(r: ValidationResult): string | null {
  return r.ok ? null : r.messageKey;
}

describe("phone normalisation (VAL-03)", () => {
  it("accepts local and international forms, rejects the rest", () => {
    expect(normalisePhone("01712345678")).toBe("+8801712345678");
    expect(normalisePhone("+880 1712-345678")).toBe("+8801712345678");
    expect(normalisePhone("8801712345678")).toBe("+8801712345678");
    expect(normalisePhone("02712345678")).toBeNull();
    expect(normalisePhone("0171234567")).toBeNull();
    expect(normalisePhone("+8801212345678")).toBeNull(); // prefix 12 not a mobile range
  });
});

describe("request form validation (VAL-04…13)", () => {
  const base = {
    bloodGroup: "B+",
    component: "whole_blood" as const,
    isDengue: false,
    unitsNeeded: 2,
    neededBy: NOW + 3 * 3_600_000,
    contactPhone: "01712345678",
    districtId: "d1",
    upazilaId: "u1",
    placeText: "Test Hospital",
  };
  it("happy path", () => {
    expect(validateRequestForm(base, NOW)).toEqual({ ok: true });
  });
  it("units out of range / past neededBy / bad phone", () => {
    expect(code(validateRequestForm({ ...base, unitsNeeded: 11 }, NOW))).toBe("validation.val06.range");
    expect(code(validateRequestForm({ ...base, neededBy: NOW - 10 * 60_000 }, NOW))).toBe("validation.val08.past");
    expect(code(validateRequestForm({ ...base, contactPhone: "123" }, NOW))).toBe("validation.val03.invalid");
  });
  it("no place → val07; no group → val04; platelets+any → val05", () => {
    expect(code(validateRequestForm({ ...base, districtId: undefined, upazilaId: undefined }, NOW))).toBe("validation.val07.empty");
    expect(code(validateRequestForm({ ...base, bloodGroup: "" }, NOW))).toBe("validation.val04.empty");
    expect(code(validateRequestForm({ ...base, component: "platelets", bloodGroup: "any" }, NOW))).toBe("validation.val05.combo");
  });
  it("note with a phone number → val11.phone; far-future neededBy → val08.far", () => {
    expect(code(validateRequestForm({ ...base, note: "call me 01712345678" }, NOW))).toBe("validation.val11.phone");
    expect(code(validateRequestForm({ ...base, neededBy: NOW + 31 * DAY }, NOW))).toBe("validation.val08.far");
  });
});

describe("donor form validation (VAL-14/15)", () => {
  const base = {
    bloodGroup: "O-",
    gender: "female",
    divisionId: "dv",
    districtId: "d1",
    upazilaId: "u1",
    neverDonated: false,
    lastDonationDate: "2026-08-01",
    lastDonationType: "whole_blood",
    checklist: { weight: true, health: true, screening: true },
    healthConsentVersion: "2026-11-28-pilot",
  };
  it("happy path; future last-donation → val14b.future", () => {
    expect(validateDonorForm(base, NOW)).toEqual({ ok: true });
    expect(code(validateDonorForm({ ...base, lastDonationDate: "2027-01-01" }, NOW))).toBe("validation.val14b.future");
  });
  it("invalid group/gender → val04/val14d; no place → val14a; checklist → val14c; no consent → val15", () => {
    expect(code(validateDonorForm({ ...base, bloodGroup: "ZZ" }, NOW))).toBe("validation.val04.empty");
    expect(code(validateDonorForm({ ...base, gender: "x" }, NOW))).toBe("validation.val14d.message");
    expect(code(validateDonorForm({ ...base, upazilaId: undefined }, NOW))).toBe("validation.val14a.message");
    expect(code(validateDonorForm({ ...base, checklist: { weight: false, health: true, screening: true } }, NOW))).toBe("validation.val14c.message");
    expect(code(validateDonorForm({ ...base, healthConsentVersion: "" }, NOW))).toBe("validation.val15.message");
  });
});

describe("money-word flag (VAL-11) + in-person code (VAL-26)", () => {
  it("detects taka/টাকা mentions", () => {
    expect(containsMoneyWord("Need blood, will pay 500 taka")).toBe(true);
    expect(containsMoneyWord("৫০০ টাকা দেবো")).toBe(true);
    expect(containsMoneyWord("Urgent B+ needed")).toBe(false);
  });
  it("code shape: 6 chars from the unambiguous alphabet", () => {
    expect(validateInPersonCode("AB23CD")).toEqual({ ok: true });
    expect(code(validateInPersonCode("ab1"))).toBe("validation.val26.message");
    expect(code(validateInPersonCode("AB10CD"))).toBe("validation.val26.message"); // 1 and 0 excluded
  });
});

describe("haversine", () => {
  it("zero for the same point; CMCH → Chittagong University ≈ 13 km", () => {
    expect(haversineKm({ lat: 22.359, lng: 91.831 }, { lat: 22.359, lng: 91.831 })).toBe(0);
    const d = haversineKm({ lat: 22.359, lng: 91.831 }, { lat: 22.471, lng: 91.785 });
    expect(d).toBeGreaterThan(12);
    expect(d).toBeLessThan(16);
  });
});

describe("eligibility extra rows (PRD §5.1)", () => {
  const S: EligibilitySettings = {
    minAge: 18,
    maxDonorAge: 65,
    intervalWholeMaleDays: 90,
    intervalWholeOtherDays: 120,
    intervalPlateletDays: 14,
    intervalPlateletToWholeDays: 14,
  };
  it("unspecified gender uses the 120-day whole-blood interval", () => {
    const r = computeEligibility(
      { gender: "unspecified", neverDonated: false, lastDonationDate: "2026-09-01", lastDonationType: "whole_blood" },
      S,
    );
    expect(r.eligibleFrom).toBe(dateToMs("2026-09-01") + 120 * DAY);
  });
  it("other gender also uses 120 days; platelet opt-in gates platelet donation", () => {
    const r = computeEligibility(
      { gender: "other", neverDonated: false, lastDonationDate: "2026-09-01", lastDonationType: "whole_blood" },
      S,
    );
    expect(r.eligibleFromPlatelets).toBe(dateToMs("2026-09-01") + 120 * DAY);
    const now = dateToMs("2026-11-26");
    const noOptIn = canDonate(
      { gender: "male", neverDonated: true, plateletOptIn: false },
      "platelets", now, S, "1995-05-01",
    );
    expect(noOptIn.ok).toBe(false);
  });
  it("age boundaries via canDonate: exactly 18 ok, exactly 66 blocked", () => {
    const now = dateToMs("2026-11-26");
    const base = { gender: "male" as const, neverDonated: true, plateletOptIn: true };
    expect(canDonate(base, "whole_blood", now, S, "2008-11-26").ok).toBe(true);
    expect(canDonate(base, "whole_blood", now, S, "1960-11-25").ok).toBe(false);
  });
});
