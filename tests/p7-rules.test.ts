import { describe, expect, it } from "vitest";
import {
  dupGroupKey,
  findDuplicate,
  responsePriority,
  strongerResponseState,
  type DupCandidate,
} from "../convex/rules/duplicates";

/**
 * Pure-rule tests for F-208/F-707 (tests/p7.test.ts covers the
 * DB-facing behaviour end to end).
 */
const T0 = Date.parse("2026-12-07T06:00:00.000Z");
const HOUR = 3_600_000;

function cand(partial: Partial<DupCandidate>): DupCandidate {
  return {
    id: "r1",
    requesterId: "someone-else",
    bloodGroup: "B+",
    hospitalId: "h1",
    upazilaId: "u1",
    createdAt: T0,
    publicSlug: "slug",
    ...partial,
  };
}

describe("findDuplicate (R12 rule)", () => {
  const args = {
    bloodGroup: "B+",
    hospitalId: "h1",
    upazilaId: "u1",
    since: T0 - 24 * HOUR,
    excludeRequesterId: "me",
  };

  it("matches same group + hospital inside the window", () => {
    expect(findDuplicate([cand({})], args)?.id).toBe("r1");
  });

  it("never matches the requester's own request", () => {
    expect(findDuplicate([cand({ requesterId: "me" })], args)).toBeUndefined();
  });

  it("respects the window edge and the group", () => {
    expect(findDuplicate([cand({ createdAt: T0 - 25 * HOUR })], args)).toBeUndefined();
    expect(findDuplicate([cand({ bloodGroup: "A+" })], args)).toBeUndefined();
    expect(findDuplicate([cand({ hospitalId: "h2" })], args)).toBeUndefined();
  });

  it("without a hospital, the upazila is the key — a hospital elsewhere does not match", () => {
    const noHospital = { ...args, hospitalId: undefined };
    expect(findDuplicate([cand({ hospitalId: undefined })], noHospital)?.id).toBe("r1");
    expect(findDuplicate([cand({ hospitalId: "h9", upazilaId: "u2" })], noHospital)).toBeUndefined();
  });

  it("returns the most recent match", () => {
    const older = cand({ id: "old", createdAt: T0 - 2 * HOUR });
    const newer = cand({ id: "new", createdAt: T0 - 1 * HOUR });
    expect(findDuplicate([older, newer], args)?.id).toBe("new");
  });
});

describe("merge state resolution (V06)", () => {
  it("a confirmed slot outranks every weaker state", () => {
    for (const s of ["accepted", "standby", "opened", "notified", "not_responding", "withdrew", "declined"]) {
      expect(strongerResponseState("confirmed", s)).toBe("confirmed");
      expect(strongerResponseState(s, "confirmed")).toBe("confirmed");
    }
  });

  it("priority is a total order consistent with responsePriority", () => {
    const order = ["confirmed", "accepted", "standby", "opened", "notified", "not_responding", "withdrew"];
    for (let i = 0; i < order.length - 1; i++) {
      expect(responsePriority(order[i])).toBeGreaterThan(responsePriority(order[i + 1]));
    }
  });

  it("group keys separate hospitals but share group+place", () => {
    expect(dupGroupKey({ bloodGroup: "B+", hospitalId: "h1", upazilaId: "u1" }))
      .toBe(dupGroupKey({ bloodGroup: "B+", hospitalId: "h1", upazilaId: "u9" }));
    expect(dupGroupKey({ bloodGroup: "B+", upazilaId: "u1" }))
      .not.toBe(dupGroupKey({ bloodGroup: "B+", hospitalId: "h1", upazilaId: "u1" }));
  });
});

import {
  appealPolishAcceptable,
  buildAppealText,
  shareCardImageUrl,
  type AppealData,
} from "../convex/rules/appeal";

const APPEAL: AppealData = {
  units: 2,
  bloodGroup: "B+",
  componentLabel: "Whole blood",
  hospitalName: "Chattogram Medical College Hospital",
  areaName: "Panchlaish",
  timeText: "7 Dec, 6:00 pm",
  link: "https://udvasito.vercel.app/r/abc123XYZ0",
};

describe("appeal text + card (F-1005 rules)", () => {
  it("builds the specced EN template with every slot filled", () => {
    const text = buildAppealText(APPEAL, "en");
    expect(text).toBe(
      "URGENT: 2 bag B+ Whole blood needed at Chattogram Medical College Hospital, Panchlaish by 7 Dec, 6:00 pm. If you can donate, tap: https://udvasito.vercel.app/r/abc123XYZ0",
    );
    expect(buildAppealText(APPEAL, "bn")).not.toContain("{{");
  });

  it("card URL is null until Cloudinary is configured (fallback path)", () => {
    expect(shareCardImageUrl({}, APPEAL)).toBeNull();
    expect(shareCardImageUrl({ cloudName: "demo" }, APPEAL)).toBeNull();
    const url = shareCardImageUrl({ cloudName: "demo", templateId: "udvasito/card" }, APPEAL)!;
    expect(url.startsWith("https://res.cloudinary.com/demo/image/upload/")).toBe(true);
    expect(url).toContain("B%2B"); // the + of B+ is encoded, not a space
    expect(url).not.toContain("8801"); // never a phone number
  });

  it("AI polish is accepted only with link + group intact and no phone", () => {
    const good = `Please help: B+ whole blood needed urgently — ${APPEAL.link}`;
    expect(appealPolishAcceptable(good, APPEAL, false)).toBe(true);
    expect(appealPolishAcceptable(good, APPEAL, true)).toBe(false); // phone found
    expect(appealPolishAcceptable("Please help B+ donors", APPEAL, false)).toBe(false); // link lost
    expect(appealPolishAcceptable(`Help needed ${APPEAL.link}`, APPEAL, false)).toBe(false); // group lost
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("learn + dengue content (F-1003/F-1004)", () => {
  const root = join(__dirname, "..", "src", "content", "generated");
  for (const lang of ["en", "bn"]) {
    for (const page of ["learn", "dengue"]) {
      it(`${lang}/${page} generated, drafted-honest, phone-free`, () => {
        const doc = JSON.parse(readFileSync(join(root, lang, `${page}.json`), "utf8")) as {
          meta: Record<string, string>;
          blocks: { type: string; text?: string; items?: string[] }[];
        };
        expect(doc.blocks.length).toBeGreaterThan(3);
        // DEP-03: until the medical review lands, the page must say so.
        expect(doc.meta.reviewedBy).toContain("DRAFT");
        const allText = doc.blocks
          .map((b) => [b.text ?? "", ...(b.items ?? [])].join(" "))
          .join(" ");
        expect(allText).not.toMatch(/01[3-9]\d{8}/); // no phone numbers in content
        expect(allText.length).toBeGreaterThan(200);
      });
    }
  }
});

import { bestFaqMatch, looksPersonalMedical } from "../convex/rules/faqMatch";

describe("faqMatch rules (F-604)", () => {
  const entries = [
    {
      id: "age",
      questionEn: "How old do I need to be to donate blood?",
      questionBn: "রক্ত দিতে হলে আমার বয়স কত হতে হবে?",
      tags: ["eligibility", "age"],
    },
    {
      id: "weight",
      questionEn: "How much do I need to weigh to donate?",
      questionBn: "রক্ত দিতে হলে আমার ওজন কত হতে হবে?",
      tags: ["eligibility", "weight"],
    },
  ];

  it("matches paraphrases with enough shared content tokens", () => {
    expect(bestFaqMatch("How old do I need to be to donate blood?", entries)?.id).toBe("age");
    expect(bestFaqMatch("what weight to donate", entries)?.id).toBe("weight");
    expect(bestFaqMatch("রক্ত দিতে হলে আমার বয়স কত হতে হবে?", entries)?.id).toBe("age");
  });

  it("refuses weak or empty matches instead of guessing", () => {
    expect(bestFaqMatch("donate", entries)).toBeNull();
    expect(bestFaqMatch("What is the meaning of life?", entries)).toBeNull();
    expect(bestFaqMatch("???", entries)).toBeNull();
    expect(bestFaqMatch("How old do I need to be?", [])).toBeNull();
  });

  it("personal-medical detection needs first person + a condition word", () => {
    expect(looksPersonalMedical("I have diabetes, should I donate?")).toBe(true);
    expect(looksPersonalMedical("আমার ডায়াবেটিস আছে, আমি কি রক্ত দিতে পারব?")).toBe(true);
    expect(looksPersonalMedical("Can someone with diabetes donate?")).toBe(false);
    expect(looksPersonalMedical("I have a question about donating")).toBe(false);
  });
});

// ── F-905 CSV safety (rules/csv) ────────────────────────────────────
import { buildCsv, csvCell, parseCsv } from "../convex/rules/csv";

describe("csv formula-injection safety (SCR-A13)", () => {
  it("prefixes cells starting with = + - @ or tab", () => {
    expect(csvCell("=2+5")).toBe("'=2+5");
    expect(csvCell("+8801712345678")).toBe("'+8801712345678");
    expect(csvCell("-10")).toBe("'-10");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("Normal name")).toBe("Normal name");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(null)).toBe("");
  });

  it("quotes cells containing commas, quotes or newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(buildCsv([["name", "note"], ["Rahim", "=cmd"]])).toBe(
      "name,note\r\nRahim,'=cmd\r\n",
    );
  });

  it("parseCsv round-trips quoted cells and CRLF", () => {
    const rows = parseCsv('name,phone\r\n"Rahim, Jr.",01711111111\r\n');
    expect(rows).toEqual([
      ["name", "phone"],
      ["Rahim, Jr.", "01711111111"],
    ]);
  });
});
