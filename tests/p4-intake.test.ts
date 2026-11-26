import { describe, expect, it } from "vitest";
import { parseIntake } from "../convex/rules/intakeParser";
import {
  buildEvalRefData,
  loadIntakeCases,
  scoreFields,
  summarise,
  type EvalField,
} from "../scripts/intake-eval-lib";

/**
 * P4 — DEP-09 intake evaluation, rules-only pass (roadmap P4 DoD:
 * ≥ 60 % of fields correct with rules only; ≥ 85 % with AI on is
 * asserted in scripts/intake-eval.ts / docs/intake-eval.md using the
 * fixture Gemini responses, and the merge itself is tested in
 * tests/p4.test.ts against the real action with a mocked fetch).
 */

const refData = buildEvalRefData();
const hospitalNameById = new Map(refData.hospitals.map((h) => [h._id, h.nameEn]));
const cases = loadIntakeCases();

describe("intake parser — DEP-09 rules-only evaluation", () => {
  it("loads the full 40-case DEP-09 set", () => {
    expect(cases).toHaveLength(40);
  });

  it("rules-only field accuracy is at least 60% (roadmap P4 DoD)", () => {
    const results = new Map<string, Record<EvalField, boolean>>();
    for (const c of cases) {
      const parsed = parseIntake(c.text, c.lang === "bn" ? "bn" : "en", refData);
      results.set(c.id, scoreFields(c.expected, parsed.fields, hospitalNameById));
    }
    const summary = summarise(cases, results);
    // The real number is written to docs/intake-eval.md by
    // scripts/intake-eval.ts; this assertion is the floor, not the result.
    expect(summary.accuracy).toBeGreaterThanOrEqual(0.6);
  });

  it("never invents a hospital for the case that has none (en-08)", () => {
    const c = cases.find((x) => x.id === "en-08")!;
    const parsed = parseIntake(c.text, "en", refData);
    expect(parsed.fields.hospitalId).toBeNull();
    expect(parsed.fields.area).toBe("Halishahar");
  });

  it("leaves units null when the message says the doctor has not decided", () => {
    for (const id of ["bn-05", "bn-16", "en-06"]) {
      const c = cases.find((x) => x.id === id)!;
      const parsed = parseIntake(c.text, c.lang === "bn" ? "bn" : "en", refData);
      expect(parsed.fields.units, id).toBeNull();
    }
  });

  it("reads the platelet count in post-02 as a count, not as units", () => {
    const c = cases.find((x) => x.id === "post-02")!;
    const parsed = parseIntake(c.text, "bn", refData);
    expect(parsed.fields.units).toBe(1);
    expect(parsed.fields.component).toBe("platelets");
    expect(parsed.fields.isDengue).toBe(true);
  });

  it("does not let 'জরুরি' override an explicit tomorrow (bn-01)", () => {
    const c = cases.find((x) => x.id === "bn-01")!;
    const parsed = parseIntake(c.text, "bn", refData);
    expect(parsed.fields.neededByKind).toBe("tomorrow");
  });

  it("parses a structured pasted post (post-06)", () => {
    const c = cases.find((x) => x.id === "post-06")!;
    const parsed = parseIntake(c.text, "bn", refData);
    expect(parsed.fields.bloodGroup).toBe("A-");
    expect(parsed.fields.units).toBe(1);
    expect(parsed.fields.hospitalId).toBe("Chittagong General Hospital");
    expect(parsed.fields.neededByKind).toBe("tomorrow");
  });
});

describe("intake parser — contract basics", () => {
  it("returns the typed empty result for empty text, everything missing", () => {
    const parsed = parseIntake("", "en", refData);
    expect(parsed.fields.bloodGroup).toBeNull();
    expect(parsed.missing).toContain("bloodGroup");
    expect(parsed.missing).toContain("hospitalId");
  });

  it("hospital matching comes from refData only — an unknown hospital is null", () => {
    const parsed = parseIntake(
      "Need B+ blood, 1 bag, at Dhaka Medical College Hospital, today",
      "en",
      refData,
    );
    expect(parsed.fields.hospitalId).toBeNull();
  });
});
