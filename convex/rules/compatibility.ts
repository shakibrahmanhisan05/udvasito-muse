/**
 * Blood-group compatibility — PURE TypeScript (CLAUDE.md rule 10).
 * Table: PRD §5.2. Whole blood: exact group in waves 1–2; compatible groups
 * only in the final wave and only when S-11 is on. Platelets: exact ABO/Rh
 * match only. "any" (replacement donor) matches every group; "not_sure"
 * matches none (volunteers handle it).
 */
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];
export type RequestGroup = BloodGroup | "any" | "not_sure";
export type BloodComponent = "whole_blood" | "platelets";

export type CompatibilitySettings = { compatibleInFinalWave: boolean };

const COMPATIBLE_WHOLE: Record<BloodGroup, BloodGroup[]> = {
  "O-": [],
  "O+": ["O-"],
  "A-": ["O-"],
  "A+": ["A-", "O+", "O-"],
  "B-": ["O-"],
  "B+": ["B-", "O+", "O-"],
  "AB-": ["A-", "B-", "O-"],
  "AB+": ["A+", "A-", "B+", "B-", "O+", "O-", "AB-"],
};

export function groupsFor(
  patientGroup: RequestGroup,
  component: BloodComponent,
  isFinalWave: boolean,
  settings: CompatibilitySettings,
): { exact: BloodGroup[]; compatible: BloodGroup[] } {
  if (patientGroup === "not_sure") return { exact: [], compatible: [] };
  if (patientGroup === "any") return { exact: [...BLOOD_GROUPS], compatible: [] };
  if (component === "platelets") return { exact: [patientGroup], compatible: [] };
  const compatible =
    isFinalWave && settings.compatibleInFinalWave ? COMPATIBLE_WHOLE[patientGroup] : [];
  return { exact: [patientGroup], compatible };
}

/** Convenience predicate used by ranking/matching. */
export function isCompatible(
  donorGroup: BloodGroup,
  patientGroup: RequestGroup,
  component: BloodComponent,
  isFinalWave: boolean,
  settings: CompatibilitySettings,
): boolean {
  const { exact, compatible } = groupsFor(patientGroup, component, isFinalWave, settings);
  return exact.includes(donorGroup) || compatible.includes(donorGroup);
}
