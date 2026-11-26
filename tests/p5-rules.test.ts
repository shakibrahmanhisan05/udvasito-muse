import { describe, expect, it } from "vitest";
import {
  containsPhoneNumber,
  extractContactPhone,
  redact,
  toLatinDigits,
} from "../convex/rules/redaction";
import { buildIntakePayload, parseGeminiResponse } from "../convex/ai/gemini";
import {
  dhakaDayKey, dhakaDayStart, dutyIntervals, funnelFromRows, laDayKey, laDayStart, median,
  registrationsByDay,
} from "../convex/rules/stats";
import {
  generatePin, isValidPin, nextPracticeId, practiceEmailFor, practiceIdFromEmail,
} from "../convex/_lib/practice";

/**
 * P5 rules tests — the P4-review carry-overs F2/F3.
 *
 * F2: PRD §6.2 enumerates spaces/dashes/Bangla digits, but pasted
 * Facebook posts write numbers with dots, parentheses, double spaces,
 * slashes and fully-spaced digits. Those forms survived redact() into
 * the AI payload. The separator class is now widened; these tests pin
 * every variant the reviewer probed, asserted against the EXACT
 * outbound payload (buildIntakePayload), like the P4 zero-leak test.
 *
 * F3: parseGeminiResponse voided the AI reply only on contiguous
 * Latin digits — a spaced or Bangla-digit phone in an AI field (area
 * merges verbatim) was not voided. Voiding now uses the same widened,
 * digit-normalising detector.
 */

const NUMBER = "01812345678";
const NUMBER_DIGITS = "1812345678";
const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const toBn = (s: string) => s.replace(/\d/g, (d) => BN_DIGITS[Number(d)]);

const SEPARATOR_FORMS: [string, string][] = [
  ["dots", "01812.345.678"],
  ["parentheses", "(01812) 345678"],
  ["double spaces", "01812  345678"],
  ["slash", "01812/345678"],
  ["fully spaced digits", "0 1 8 1 2 3 4 5 6 7 8"],
  ["dots with +880", "+880.1812.345.678"],
  ["spaced +880", "+880 1812 345 678"],
  ["bangla digits, dots", toBn("01812.345.678")],
  ["bangla digits, fully spaced", toBn("0 1 8 1 2 3 4 5 6 7 8")],
  ["mixed separators", "01812-345.678"],
];

describe("F2 — redaction separator variants (P4 review)", () => {
  for (const [label, form] of SEPARATOR_FORMS) {
    it(`removes the ${label} form and it never reaches the payload`, () => {
      const out = redact(`রক্ত লাগবে, যোগাযোগ: ${form} (বাবা)`);
      expect(out.removed.phones).toBe(1);
      const payload = JSON.stringify(buildIntakePayload(out.text, "2026-12-05"));
      expect(payload).toContain("[phone]");
      // No digit run of the number survives in either script.
      expect(toLatinDigits(payload)).not.toContain(NUMBER_DIGITS);
      expect(payload).not.toContain(toBn(NUMBER_DIGITS));
      expect(containsPhoneNumber(out.text)).toBe(false);
    });

    it(`extractContactPhone recovers the ${label} form`, () => {
      expect(extractContactPhone(`যোগাযোগ ${form}`)).toBe(NUMBER);
    });
  }

  it("containsPhoneNumber sees every variant, in either script", () => {
    for (const [, form] of SEPARATOR_FORMS) {
      expect(containsPhoneNumber(form)).toBe(true);
    }
    expect(containsPhoneNumber(NUMBER)).toBe(true);
    expect(containsPhoneNumber(toBn(NUMBER))).toBe(true);
  });

  it("does not eat dates, landlines or ward numbers", () => {
    expect(containsPhoneNumber("01.03.2026")).toBe(false);
    expect(containsPhoneNumber("02-33320063")).toBe(false); // dashed landline (F5: accepted survival)
    expect(containsPhoneNumber("ward 5, bed 12")).toBe(false);
    const out = redact("ভর্তি তারিখ 01.03.2026, ওয়ার্ড 5");
    expect(out.removed.phones).toBe(0);
    expect(out.text).toContain("01.03.2026");
  });

  it("absorbs dash-grouped ID numbers (P4 review F5, cheap case)", () => {
    const out = redact("NID 1234-5678-9012-3");
    expect(out.removed.ids).toBe(1);
    expect(out.text).toContain("[id]");
    expect(out.text).not.toContain("1234-5678");
  });
});


describe("F3 — AI-response voiding sees spaced / Bangla-digit phones (P4 review)", () => {
  function bodyWith(fields: Record<string, unknown>): unknown {
    return {
      candidates: [
        { content: { parts: [{ text: JSON.stringify(fields) }] } },
      ],
    };
  }
  const base = {
    bloodGroup: "B+",
    component: "whole_blood",
    isDengue: false,
    units: 2,
    hospitalName: null,
    area: "Kotwali",
    neededBy: { kind: "today", isoDateTime: null },
  };

  it("a clean response still parses", () => {
    const out = parseGeminiResponse(bodyWith(base));
    expect(out?.bloodGroup).toBe("B+");
    expect(out?.area).toBe("Kotwali");
  });

  for (const [label, form] of SEPARATOR_FORMS) {
    it(`voids the whole response when the area carries the ${label} form`, () => {
      expect(parseGeminiResponse(bodyWith({ ...base, area: form }))).toBeNull();
    });
  }

  it("voids on a Bangla-digit phone in hospitalName", () => {
    expect(
      parseGeminiResponse(bodyWith({ ...base, hospitalName: `CMCH ${toBn(NUMBER)}` })),
    ).toBeNull();
  });

  it("voids on a spaced +880 phone in any field", () => {
    expect(
      parseGeminiResponse(bodyWith({ ...base, area: "call +880 1812 345 678" })),
    ).toBeNull();
  });
});

describe("stats helpers (rules/stats)", () => {
  it("dhaka/la day keys match hand-computed values", () => {
    const ts = Date.parse("2026-12-05T06:00:00.000Z"); // 12:00 Dhaka, Dec 4 22:00 PST
    expect(dhakaDayKey(ts)).toBe("2026-12-05");
    expect(dhakaDayStart(ts)).toBe(Date.parse("2026-12-04T18:00:00.000Z"));
    expect(laDayKey(ts)).toBe("2026-12-04");
    // LA day start: December is PST (UTC-8) → 08:00Z; July is PDT (UTC-7) → 07:00Z.
    expect(laDayStart(ts)).toBe(Date.parse("2026-12-04T08:00:00.000Z"));
    expect(laDayStart(Date.parse("2026-07-15T12:00:00.000Z"))).toBe(Date.parse("2026-07-15T07:00:00.000Z"));
    expect(median([30, 45, 60, 120])).toBe(52.5);
    expect(median([5])).toBe(5);
    expect(median([])).toBeNull();
  });

  it("registrationsByDay zero-fills and buckets by Dhaka day", () => {
    const now = Date.parse("2026-12-05T06:00:00.000Z");
    const rows = registrationsByDay([now - 5 * 86_400_000, now - 5 * 86_400_000, now - 40 * 86_400_000], now, 30);
    expect(rows).toHaveLength(30);
    expect(rows.reduce((s, r) => s + r.count, 0)).toBe(2); // the 40-day-old one is outside
    expect(rows[rows.length - 1].day).toBe("2026-12-05");
    expect(rows.find((r) => r.day === "2026-11-30")?.count).toBe(2);
  });

  it("dutyIntervals pairs events and closes conservatively", () => {
    const t = (h: number) => Date.parse("2026-12-04T00:00:00.000Z") + h * 3_600_000;
    const intervals = dutyIntervals(
      [
        { vpId: "a", onDuty: true, at: t(2) },
        { vpId: "a", onDuty: false, at: t(6) },
        { vpId: "b", onDuty: true, at: t(3) }, // b still on duty
        { onDuty: true, at: t(1) }, // pre-P5 event without vpId — ignored
      ],
      new Map([["b", t(3)]]),
      t(10),
    );
    expect(intervals).toEqual([
      { start: t(2), end: t(6) },
      { start: t(3), end: t(10) },
    ]);
  });

  it("funnel confirmation rate is null when no contact was shared", () => {
    const out = funnelFromRows([{ id: "r1" }], [], new Set());
    expect(out.published).toBe(1);
    expect(out.confirmationResponseRate).toBeNull();
  });
});

describe("practice helpers (_lib/practice, D-R4)", () => {
  it("email ↔ ID round-trips; foreign emails rejected", () => {
    expect(practiceEmailFor("P-07")).toBe("p-07@practice.udvasito.invalid");
    expect(practiceIdFromEmail("p-07@practice.udvasito.invalid")).toBe("P-07");
    expect(practiceIdFromEmail("P-07@practice.udvasito.invalid")).toBe("P-07");
    expect(practiceIdFromEmail("judge@gmail.com")).toBeNull();
    expect(practiceIdFromEmail("p-7@practice.udvasito.invalid")).toBeNull();
    expect(practiceIdFromEmail("admin@practice.udvasito.invalid")).toBeNull();
  });

  it("PINs are exactly 6 digits (VAL-27); ids allocate P-01..P-10", () => {
    expect(isValidPin("012345")).toBe(true);
    expect(isValidPin("12345")).toBe(false);
    expect(isValidPin("1234567")).toBe(false);
    expect(isValidPin("12a456")).toBe(false);
    expect(generatePin(() => 0)).toBe("000000");
    expect(generatePin(() => 0.9999999)).toBe("999999");
    expect(nextPracticeId([])).toBe("P-01");
    expect(nextPracticeId(["P-01", "P-03"])).toBe("P-02");
    expect(nextPracticeId(["P-01", "P-02", "P-03", "P-04", "P-05", "P-06", "P-07", "P-08", "P-09", "P-10"])).toBeNull();
  });
});
