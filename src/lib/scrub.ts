/**
 * PII scrubber for Sentry (CLAUDE.md rule 3, specs §7.4). Removes, from
 * any string anywhere in an event or breadcrumb:
 *  - Bangladeshi phone numbers — the SAME shape the server redaction
 *    engine removes (convex/rules/redaction.ts PHONE_SHAPE): Latin or
 *    Bangla digits, +880 / 00880 / 0 forms, with spaces, dots, parens,
 *    slashes or dashes between digit groups;
 *  - email addresses;
 *  - credentials: Bearer tokens, JWTs, and labelled secrets
 *    (`token: …`, `api_key=…`, `password: …`).
 * In objects, values under credential-shaped KEYS (token, secret,
 * password, authorization, api key, cookie) are redacted wholesale,
 * whatever they contain. Pure and unit-tested (tests/scrub.test.ts).
 */
const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";

export function toLatinDigits(text: string): string {
  return text.replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d)));
}

const PHONE_PATTERN = /(?:\+?880|00880|0)[\s()./-]*1[\s()./-]*[3-9](?:[\s()./-]*\d){8}/g;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const LABELLED_SECRET_PATTERN =
  /\b(api[-_ ]?key|access[-_ ]?token|auth[-_ ]?token|client[-_ ]?secret|secret|password|passwd|token|key)\b(\s*[:=]\s*)\S+/gi;

export function scrubPhoneNumbers(text: string): string {
  return toLatinDigits(text).replace(PHONE_PATTERN, "[phone]");
}

export function scrubString(text: string): string {
  return scrubPhoneNumbers(text)
    .replace(EMAIL_PATTERN, "[email]")
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(JWT_PATTERN, "[token]")
    .replace(LABELLED_SECRET_PATTERN, "$1$2[redacted]");
}

const SENSITIVE_KEY = /(token|secret|password|passwd|authorization|api[-_]?key|cookie)/i;

/** Deep-scrub an arbitrary event payload (strings anywhere inside). */
export function scrubValue<T>(value: T): T {
  if (typeof value === "string") return scrubString(value) as T;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : scrubValue(v);
    }
    return out as T;
  }
  return value;
}
