/**
 * Form validation — PURE TypeScript + zod (specs §4, §6.10). Imported by the
 * app for instant field errors and re-run by every Convex mutation (the
 * server never trusts client validation). Each failure carries the VAL rule
 * id + case so the client can show the exact `validation.*` i18n string.
 */
import { z } from "zod";

export type ValidationFailure = { ok: false; field: string; messageKey: string };
export type ValidationResult = { ok: true } | ValidationFailure;

const failAt = (field: string, messageKey: string): ValidationFailure => ({
  ok: false,
  field,
  messageKey,
});

// ── Phone (VAL-03) — same algorithm as src/lib/phone.ts (client copy). ──
const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const EN_DIGITS = "0123456789";

export function toEnglishDigits(input: string): string {
  return input.replace(/[০-৯]/g, (d) => EN_DIGITS[BN_DIGITS.indexOf(d)]);
}

/** Normalise to +8801XXXXXXXXX, or null if not a BD mobile number. */
export function normalisePhone(input: string): string | null {
  const digits = toEnglishDigits(input).replace(/[\s()-]/g, "");
  const match = /^(?:\+?880|0)(1[3-9]\d{8})$/.exec(digits);
  return match ? `+880${match[1]}` : null;
}

// ── VAL-01 · full name ───────────────────────────────────────────────
const NAME_CHARS = /^[\p{L}\s.'-]+$/u;

export function validateName(value: string, field = "name"): ValidationResult {
  const name = value.trim();
  if (!name) return failAt(field, "validation.val01.empty");
  if (name.length < 2) return failAt(field, "validation.val01.short");
  if (name.length > 60) return failAt(field, "validation.val01.long");
  if (!NAME_CHARS.test(name)) return failAt(field, "validation.val01.chars");
  return { ok: true };
}

// ── VAL-02 · date of birth (underage is a flow, not a field error) ───
export function validateDateOfBirth(
  value: string,
  now: number,
): ValidationResult & { age?: number } {
  if (!value) return failAt("dateOfBirth", "validation.val02.empty");
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return failAt("dateOfBirth", "validation.val02.invalid");
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d ||
    date.getTime() > now
  ) {
    return failAt("dateOfBirth", "validation.val02.invalid");
  }
  // Age in the Asia/Dhaka calendar (same rule as rules/eligibility.ageOn,
  // duplicated here to keep this module dependency-free for the client).
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  let age = get("year") - y;
  if (get("month") < mo || (get("month") === mo && get("day") < d)) age--;
  if (age > 100) return failAt("dateOfBirth", "validation.val02.over100");
  return { ok: true, age };
}

// ── VAL-03 · mobile / contact number ─────────────────────────────────
export function validatePhone(value: string, field = "phone"): ValidationResult {
  if (!value.trim()) return failAt(field, "validation.val03.empty");
  if (!normalisePhone(value)) return failAt(field, "validation.val03.invalid");
  return { ok: true };
}

// ── Request form (VAL-04…VAL-11) ─────────────────────────────────────
export const BLOOD_GROUPS = [
  "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-",
] as const;

export const requestFormSchema = z.object({
  bloodGroup: z.string(),
  component: z.enum(["whole_blood", "platelets"]),
  isDengue: z.boolean(),
  unitsNeeded: z.number(),
  hospitalId: z.string().optional(),
  divisionId: z.string().optional(),
  districtId: z.string().optional(),
  upazilaId: z.string().optional(),
  placeText: z.string().optional(),
  neededBy: z.number(),
  contactPhone: z.string(),
  patientName: z.string().optional(),
  ward: z.string().optional(),
  note: z.string().optional(),
});

export type RequestFormInput = z.infer<typeof requestFormSchema>;

export function validateRequestForm(
  input: RequestFormInput,
  now: number,
): ValidationResult {
  if (![...BLOOD_GROUPS, "any", "not_sure"].includes(input.bloodGroup)) {
    return failAt("bloodGroup", "validation.val04.empty");
  }
  if (input.component === "platelets" && input.bloodGroup === "any") {
    return failAt("bloodGroup", "validation.val05.combo");
  }
  if (!Number.isInteger(input.unitsNeeded) || input.unitsNeeded < 1 || input.unitsNeeded > 10) {
    return failAt("unitsNeeded", "validation.val06.range");
  }
  if (!input.hospitalId) {
    if (!input.districtId || !input.upazilaId) {
      return failAt("place", "validation.val07.empty");
    }
    const placeText = (input.placeText ?? "").trim();
    if (placeText.length < 3 || placeText.length > 80) {
      return failAt("placeText", "validation.val07.placeText");
    }
  }
  if (input.neededBy < now - 5 * 60_000) {
    return failAt("neededBy", "validation.val08.past");
  }
  if (input.neededBy > now + 30 * 86_400_000) {
    return failAt("neededBy", "validation.val08.far");
  }
  const phone = validatePhone(input.contactPhone, "contactPhone");
  if (!phone.ok) return phone;
  if (input.patientName !== undefined) {
    const p = input.patientName.trim();
    if (p.length > 60 || (p.length > 0 && !NAME_CHARS.test(p))) {
      return failAt("patientName", "validation.val09.long");
    }
  }
  if (input.ward !== undefined && input.ward.trim().length > 40) {
    return failAt("ward", "validation.val10.long");
  }
  if (input.note !== undefined) {
    if (input.note.length > 300) return failAt("note", "validation.val11.long");
    // VAL-11: phone numbers are detected and removed from notes.
    if (normalisePhone(input.note) || /01[3-9]\d{8}/.test(toEnglishDigits(input.note))) {
      return failAt("note", "validation.val11.phone");
    }
  }
  return { ok: true };
}

// ── Donor setup (VAL-14a…14d, VAL-15, VAL-22/23) ─────────────────────
export type DonorFormInput = {
  bloodGroup: string;
  gender: string;
  divisionId?: string;
  districtId?: string;
  upazilaId?: string;
  areaText?: string;
  institution?: string;
  neverDonated: boolean;
  lastDonationDate?: string;
  lastDonationType?: string;
  checklist: { weight: boolean; health: boolean; screening: boolean };
  healthConsentVersion: string;
};

export function validateDonorForm(input: DonorFormInput, now: number): ValidationResult {
  if (![...BLOOD_GROUPS, "unknown"].includes(input.bloodGroup)) {
    return failAt("bloodGroup", "validation.val04.empty");
  }
  if (!input.divisionId || !input.districtId || !input.upazilaId) {
    return failAt("place", "validation.val14a.message");
  }
  if (input.areaText !== undefined && input.areaText.length > 80) {
    return failAt("areaText", "validation.val23.message");
  }
  if (input.institution !== undefined && input.institution.length > 80) {
    return failAt("institution", "validation.val22.message");
  }
  if (!["male", "female", "other", "unspecified"].includes(input.gender)) {
    return failAt("gender", "validation.val14d.message");
  }
  if (!input.neverDonated) {
    if (!input.lastDonationDate || !input.lastDonationType) {
      return failAt("lastDonationDate", "validation.val14b.missing");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.lastDonationDate)) {
      return failAt("lastDonationDate", "validation.val14b.missing");
    }
    const t = Date.parse(`${input.lastDonationDate}T00:00:00.000Z`);
    if (!Number.isFinite(t) || t > now || t < Date.parse("1970-01-01T00:00:00.000Z")) {
      return failAt("lastDonationDate", "validation.val14b.future");
    }
  }
  if (!input.checklist.weight || !input.checklist.health || !input.checklist.screening) {
    return failAt("checklist", "validation.val14c.message");
  }
  if (!input.healthConsentVersion) {
    return failAt("healthConsentVersion", "validation.val15.message");
  }
  return { ok: true };
}

// ── VAL-26 · in-person verification code ─────────────────────────────
// ── VAL-18 · reason for admin/volunteer actions (5–200 chars) ───────
export function validateReason(value: string, field = "reason"): ValidationResult {
  const reason = value.trim();
  if (reason.length < 5) return failAt(field, "validation.val18.short");
  if (reason.length > 200) return failAt(field, "validation.val18.long");
  return { ok: true };
}

// ── VAL-16 · volunteer application (≥ 1 area; motivation 10–300) ────
export function validateVolunteerApplication(input: {
  areaCount: number;
  motivation: string;
}): ValidationResult {
  if (input.areaCount < 1) return failAt("areas", "validation.val16.areas");
  const motivation = input.motivation.trim();
  if (motivation.length < 10) return failAt("motivation", "validation.val16.short");
  if (motivation.length > 300) return failAt("motivation", "validation.val16.long");
  return { ok: true };
}

export const IN_PERSON_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function validateInPersonCode(value: string): ValidationResult {
  const code = value.trim().toUpperCase();
  if (
    code.length !== 6 ||
    ![...code].every((c) => IN_PERSON_CODE_ALPHABET.includes(c))
  ) {
    return failAt("code", "validation.val26.message");
  }
  return { ok: true };
}

/** Money words for the non-blocking moderation flag at request create (PRD §5.8). */
export const MONEY_WORDS = ["টাকা", "taka", "bkash", "বিকাশ", "payment", "money", "cash"];

export function containsMoneyWord(text: string | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return MONEY_WORDS.some((w) => lower.includes(w));
}
