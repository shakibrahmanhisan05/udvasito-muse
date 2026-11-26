import { describe, expect, it } from "vitest";
import { validateReason, validateVolunteerApplication } from "../convex/rules/validation";
import { farmingSignals } from "../convex/rules/limits";

/**
 * P3 pure-rule unit tests: VAL-16 (volunteer application), VAL-18
 * (typed reasons) and the F-803 farming heuristic.
 */

describe("validateVolunteerApplication (VAL-16)", () => {
  it("accepts one area and a 10–300 char motivation", () => {
    expect(
      validateVolunteerApplication({
        areaCount: 1,
        motivation: "I want to help people.",
      }),
    ).toMatchObject({ ok: true });
    expect(
      validateVolunteerApplication({
        areaCount: 3,
        motivation: "x".repeat(300),
      }),
    ).toMatchObject({ ok: true });
  });
  it("rejects no areas and out-of-range motivations", () => {
    expect(
      validateVolunteerApplication({ areaCount: 0, motivation: "I want to help people." }),
    ).toMatchObject({ ok: false, field: "areas" });
    expect(
      validateVolunteerApplication({ areaCount: 1, motivation: "short" }),
    ).toMatchObject({ ok: false, field: "motivation" });
    expect(
      validateVolunteerApplication({ areaCount: 1, motivation: "x".repeat(301) }),
    ).toMatchObject({ ok: false, field: "motivation" });
  });
});

describe("validateReason (VAL-18)", () => {
  it("requires 5–200 chars after trimming", () => {
    expect(validateReason("Called to coordinate")).toMatchObject({ ok: true });
    expect(validateReason("  ok reason here  ")).toMatchObject({ ok: true });
    expect(validateReason("call")).toMatchObject({ ok: false, field: "reason" });
    expect(validateReason("x".repeat(201))).toMatchObject({ ok: false, field: "reason" });
    expect(validateReason("     ")).toMatchObject({ ok: false, field: "reason" });
  });
});

describe("farmingSignals (F-803)", () => {
  const base = { unitsConfirmed: 0 };
  it("flags three distinct blood groups", () => {
    expect(
      farmingSignals([
        { ...base, bloodGroup: "O+" },
        { ...base, bloodGroup: "A+" },
        { ...base, bloodGroup: "B+" },
      ]),
    ).toContain("many_blood_groups");
  });
  it("flags three distinct hospitals", () => {
    expect(
      farmingSignals([
        { ...base, bloodGroup: "O+", hospitalId: "h1" as never },
        { ...base, bloodGroup: "O+", hospitalId: "h2" as never },
        { ...base, bloodGroup: "O+", hospitalId: "h3" as never },
      ]),
    ).toContain("many_hospitals");
  });
  it("flags three expired-never-fulfilled requests", () => {
    const expired = { ...base, bloodGroup: "O+", closeReason: "expired" };
    expect(farmingSignals([expired, expired, expired])).toContain(
      "requests_never_fulfilled",
    );
  });
  it("a genuine repeat need raises nothing", () => {
    const genuine = {
      ...base,
      bloodGroup: "O+",
      hospitalId: "h1" as never,
      closeReason: "all_arrived",
      unitsConfirmed: 2,
    };
    expect(farmingSignals([genuine, genuine, genuine])).toEqual([]);
  });
});
