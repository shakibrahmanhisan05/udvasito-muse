/**
 * DEP-09 intake evaluation — shared by tests/p4-intake.test.ts (which
 * asserts the roadmap P4 thresholds) and scripts/intake-eval.ts (which
 * writes docs/intake-eval.md). One implementation, so the numbers in
 * the doc are exactly the numbers the test enforces.
 *
 * RefData is built from the SAME sources the server uses at runtime:
 * data/hospitals.csv (the hospitals table seed) and data/places.json
 * (the places table seed). A hospital's `area` is its upazila's English
 * name, passed only when that upazila is a metro thana — mirroring
 * intake.refData on the server.
 *
 * Scoring (documented in docs/intake-eval.md):
 *  - 7 fields per case: bloodGroup, component, units, hospital, area,
 *    neededBy, isDengue. A field scores 1 when correct, else 0; a
 *    correctly-empty field (expected null, parsed null) scores 1.
 *  - neededBy: the parser's kinds are coarser than the fixture labels —
 *    now→{now}, today→{today, today_evening},
 *    tomorrow→{tomorrow, tomorrow_morning, tomorrow_evening},
 *    datetime→{day_after_tomorrow}.
 *  - isDengue: the parser returns true or null (it never asserts a
 *    negative); expected false scores correct when the parser did not
 *    claim dengue — the request form's dengue flag defaults off, so
 *    null and false are the same product state.
 */
import { readFileSync } from "node:fs";
import { parseCsv } from "./import-hospitals";
import type { IntakeFields, IntakeRefData } from "../convex/rules/intakeParser";

export type IntakeCase = {
  id: string;
  lang: string;
  text: string;
  expected: {
    bloodGroup: string | null;
    component: string | null;
    units: number | null;
    hospital: string | null;
    area: string | null;
    neededBy: string | null;
    isDengue: boolean;
  };
};

export function loadIntakeCases(): IntakeCase[] {
  const raw = readFileSync("tests/fixtures/intake.jsonl", "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as IntakeCase);
}

type PlaceRow = {
  level: string;
  code: string;
  parentCode: string | null;
  nameEn: string;
  nameBn: string;
  isMetroThana: boolean;
};

export function buildEvalRefData(): IntakeRefData {
  const places = JSON.parse(readFileSync("data/places.json", "utf8")) as PlaceRow[];
  const byName = new Map(places.map((p) => [p.nameEn, p]));
  const hospitalRows = parseCsv(readFileSync("data/hospitals.csv", "utf8"));
  const hospitals = hospitalRows
    .filter((r) => r.active === "true")
    .map((r) => {
      const upazila = byName.get(r.upazila!);
      return {
        _id: r.nameEn!,
        nameEn: r.nameEn!,
        nameBn: r.nameBn!,
        aliases: (r.aliases ?? "").split(";").map((a) => a.trim()).filter(Boolean),
        area: upazila?.isMetroThana ? upazila.nameEn : undefined,
      };
    });
  // Areas are scoped to the districts the hospitals actually serve (the
  // server does the same) — a nationwide list invites false positives
  // from far-away place names that resemble ordinary words.
  const servedDistricts = new Set(
    hospitalRows.map((r) => byName.get(r.district!)?.code).filter(Boolean),
  );
  const areas = places
    .filter((p) => p.level === "upazila" && p.parentCode !== null && servedDistricts.has(p.parentCode))
    .map((p) => ({ nameEn: p.nameEn, nameBn: p.nameBn }));
  return { hospitals, areas };
}

export const EVAL_FIELDS = [
  "bloodGroup", "component", "units", "hospital", "area", "neededBy", "isDengue",
] as const;
export type EvalField = (typeof EVAL_FIELDS)[number];

const NEEDED_BY_BUCKETS: Record<string, string[]> = {
  now: ["now"],
  today: ["today", "today_evening"],
  tomorrow: ["tomorrow", "tomorrow_morning", "tomorrow_evening"],
  datetime: ["day_after_tomorrow"],
};

export function scoreFields(
  expected: IntakeCase["expected"],
  fields: IntakeFields,
  hospitalNameById: Map<string, string>,
): Record<EvalField, boolean> {
  const hospitalName = fields.hospitalId
    ? (hospitalNameById.get(fields.hospitalId) ?? null)
    : null;
  return {
    bloodGroup: fields.bloodGroup === expected.bloodGroup,
    component: fields.component === expected.component,
    units: fields.units === expected.units,
    hospital: hospitalName === expected.hospital,
    area: fields.area === expected.area,
    neededBy:
      fields.neededByKind !== null &&
      expected.neededBy !== null &&
      (NEEDED_BY_BUCKETS[fields.neededByKind] ?? []).includes(expected.neededBy),
    isDengue: expected.isDengue ? fields.isDengue === true : fields.isDengue !== true,
  };
}

export type EvalSummary = {
  total: number;
  correct: number;
  accuracy: number;
  perField: Record<EvalField, { correct: number; total: number; accuracy: number }>;
  perCase: { id: string; correct: number; total: number; wrong: EvalField[] }[];
};

export function summarise(
  cases: IntakeCase[],
  results: Map<string, Record<EvalField, boolean>>,
): EvalSummary {
  const perField = Object.fromEntries(
    EVAL_FIELDS.map((f) => [f, { correct: 0, total: 0, accuracy: 0 }]),
  ) as EvalSummary["perField"];
  const perCase: EvalSummary["perCase"] = [];
  let correct = 0;
  let total = 0;
  for (const c of cases) {
    const r = results.get(c.id)!;
    const wrong: EvalField[] = [];
    let caseCorrect = 0;
    for (const f of EVAL_FIELDS) {
      perField[f].total++;
      total++;
      if (r[f]) {
        perField[f].correct++;
        caseCorrect++;
        correct++;
      } else {
        wrong.push(f);
      }
    }
    perCase.push({ id: c.id, correct: caseCorrect, total: EVAL_FIELDS.length, wrong });
  }
  for (const f of EVAL_FIELDS) {
    perField[f].accuracy = perField[f].correct / perField[f].total;
  }
  return { total, correct, accuracy: correct / total, perField, perCase };
}
