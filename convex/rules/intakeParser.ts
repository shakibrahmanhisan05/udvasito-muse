/**
 * Rules-first intake parser — PURE TypeScript. Contract: specs §6.10.
 * TODO(P4): full implementation (blood-group spellings in EN/BN/Banglish,
 * units, time words, dengue words, hospital aliases from refData) with the
 * DEP-09 test set — roadmap P4, F-206. In P0 this returns the typed empty
 * result so callers can be wired against the real contract; the manual form
 * is always available and AI/rules parsing never blocks posting (PRD §1.3).
 */
export type IntakeFields = {
  bloodGroup: string | null;
  component: "whole_blood" | "platelets" | null;
  isDengue: boolean | null;
  units: number | null;
  hospitalId: string | null;
  area: string | null;
  neededByKind: "now" | "today" | "tomorrow" | "datetime" | null;
};

export type IntakeResult = {
  fields: IntakeFields;
  confidence: Partial<Record<keyof IntakeFields, number>>;
  missing: (keyof IntakeFields)[];
};

export type IntakeRefData = {
  hospitals: { _id: string; nameEn: string; nameBn: string; aliases: string[] }[];
};

const ALL_FIELDS: (keyof IntakeFields)[] = [
  "bloodGroup", "component", "isDengue", "units", "hospitalId", "area", "neededByKind",
];

export function parseIntake(
  _text: string,
  _lang: "en" | "bn",
  _refData: IntakeRefData,
): IntakeResult {
  return {
    fields: {
      bloodGroup: null, component: null, isDengue: null, units: null,
      hospitalId: null, area: null, neededByKind: null,
    },
    confidence: {},
    missing: [...ALL_FIELDS],
  };
}
