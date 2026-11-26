/**
 * Bangladeshi phone numbers (specs §1.2 src/lib/phone.ts; needed by P1
 * onboarding + phone verification). Pure helpers — the single place that
 * knows the BD number shapes, reused by the Sentry scrubber's patterns.
 *
 * Accepted input: 01XXXXXXXXX, 8801XXXXXXXXX, +8801XXXXXXXXX, with spaces,
 * dashes, or Bangla digits. Canonical output: +8801XXXXXXXXX (E.164-ish).
 */

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const EN_DIGITS = "0123456789";

export function toEnglishDigits(input: string): string {
  return input.replace(/[০-৯]/g, (d) => EN_DIGITS[BN_DIGITS.indexOf(d)]);
}

export function toBanglaDigits(input: string): string {
  return input.replace(/[0-9]/g, (d) => BN_DIGITS[EN_DIGITS.indexOf(d)]);
}

/** Normalise to +8801XXXXXXXXX, or null if not a BD mobile number. */
export function normalizeBdPhone(input: string): string | null {
  const digits = toEnglishDigits(input).replace(/[\s()-]/g, "");
  const match = /^(?:\+?880|0)(1[3-9]\d{8})$/.exec(digits);
  return match ? `+880${match[1]}` : null;
}

export function isValidBdMobile(input: string): boolean {
  return normalizeBdPhone(input) !== null;
}

/** Display form used in the UI: 01XXX-XXXXXX (never logs; display only). */
export function formatBdPhoneDisplay(canonical: string): string {
  const local = canonical.replace(/^\+880/, "0");
  return local.length === 11 ? `${local.slice(0, 5)}-${local.slice(5)}` : canonical;
}
