/**
 * Phone-number scrubber for Sentry (CLAUDE.md rule 3, build-prompts P0 #13).
 * Removes anything shaped like a Bangladeshi phone number — Latin or Bangla
 * digits, +880 / 880 / 01 forms, with spaces or dashes — from any string.
 * Pure and unit-tested (tests/scrub.test.ts).
 */
const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";

export function toLatinDigits(text: string): string {
  return text.replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d)));
}

const PHONE_PATTERN = /(?:\+?880|0)[\s-]?1[3-9](?:[\s-]?\d){8}/g;

export function scrubPhoneNumbers(text: string): string {
  return toLatinDigits(text).replace(PHONE_PATTERN, "[phone]");
}

/** Deep-scrub an arbitrary event payload (strings anywhere inside). */
export function scrubValue<T>(value: T): T {
  if (typeof value === "string") return scrubPhoneNumbers(value) as T;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrubValue(v);
    }
    return out as T;
  }
  return value;
}
