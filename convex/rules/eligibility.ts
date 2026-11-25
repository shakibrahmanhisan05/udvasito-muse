/**
 * Donor eligibility — PURE TypeScript, no Convex imports (CLAUDE.md rule 10).
 * Rules: PRD §5.1 / specs §5.4. All numbers come from settings (S-01…S-07).
 */
export type BloodComponent = "whole_blood" | "platelets";
export type Gender = "male" | "female" | "other" | "unspecified";

export type EligibilitySettings = {
  minAge: number;
  maxDonorAge: number;
  intervalWholeMaleDays: number;
  intervalWholeOtherDays: number;
  intervalPlateletDays: number;
  intervalPlateletToWholeDays: number;
};

export type DonorForEligibility = {
  gender: Gender;
  neverDonated: boolean;
  lastDonationDate?: string; // "YYYY-MM-DD" (Asia/Dhaka)
  lastDonationType?: BloodComponent;
};

const DAY_MS = 86_400_000;

/** Parse a "YYYY-MM-DD" calendar date (Asia/Dhaka) to a UTC timestamp. */
export function dateToMs(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

export function wholeBloodIntervalDays(gender: Gender, s: EligibilitySettings): number {
  return gender === "male" ? s.intervalWholeMaleDays : s.intervalWholeOtherDays;
}

/**
 * Derived values (specs §5.4):
 * eligibleFrom        = last whole-blood + whole interval, or last platelet + S-07
 * eligibleFromPlatelets = last platelet + S-06, or last whole-blood + whole interval
 * Never donated → 0 (eligible immediately).
 */
export function computeEligibility(
  donor: DonorForEligibility,
  settings: EligibilitySettings,
): { eligibleFrom: number; eligibleFromPlatelets: number } {
  if (donor.neverDonated || !donor.lastDonationDate || !donor.lastDonationType) {
    return { eligibleFrom: 0, eligibleFromPlatelets: 0 };
  }
  const last = dateToMs(donor.lastDonationDate);
  const wholeDays = wholeBloodIntervalDays(donor.gender, settings);
  if (donor.lastDonationType === "whole_blood") {
    const next = last + wholeDays * DAY_MS;
    return { eligibleFrom: next, eligibleFromPlatelets: next };
  }
  // Last donation was platelets.
  return {
    eligibleFrom: last + settings.intervalPlateletToWholeDays * DAY_MS,
    eligibleFromPlatelets: last + settings.intervalPlateletDays * DAY_MS,
  };
}

/** Age in whole years on `now`, computed in the Asia/Dhaka calendar. */
export function ageOn(dateOfBirth: string, now: number): number {
  const [by, bm, bd] = dateOfBirth.split("-").map(Number);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  let age = get("year") - by;
  const m = get("month");
  const d = get("day");
  if (m < bm || (m === bm && d < bd)) age--;
  return age;
}

export type CanDonateResult =
  | { ok: true }
  | { ok: false; reason: "age" | "cooldown" | "platelets"; date?: number };

export function canDonate(
  donor: DonorForEligibility & { plateletOptIn: boolean },
  component: BloodComponent,
  now: number,
  settings: EligibilitySettings,
  dateOfBirth: string,
): CanDonateResult {
  const age = ageOn(dateOfBirth, now);
  if (age < settings.minAge || age > settings.maxDonorAge) {
    return { ok: false, reason: "age" };
  }
  if (component === "platelets" && !donor.plateletOptIn) {
    return { ok: false, reason: "platelets" };
  }
  const { eligibleFrom, eligibleFromPlatelets } = computeEligibility(donor, settings);
  const from = component === "platelets" ? eligibleFromPlatelets : eligibleFrom;
  if (now < from) return { ok: false, reason: "cooldown", date: from };
  return { ok: true };
}
