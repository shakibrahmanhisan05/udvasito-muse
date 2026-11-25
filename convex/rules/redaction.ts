/**
 * Redaction — PURE TypeScript. PRD §6.2: runs before EVERY AI call.
 * Removes phone numbers (Latin + Bangla digits), emails, ID-like numbers,
 * text after name labels, and known diagnosis words. The full rule set and
 * the 500-message zero-leak test are completed in P4 (roadmap P4); this P0
 * version already covers the PRD §6.2 categories 1, 2 (labels), 3 and 4.
 */
const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";
export function toLatinDigits(text: string): string {
  return text.replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d)));
}

const DIAGNOSIS_WORDS = [
  "cancer", "ক্যান্সার", "dialysis", "ডায়ালাইসিস", "thalassaemia", "thalassemia",
  "থ্যালাসেমিয়া", "surgery", "অপারেশন", "hiv", "এইচআইভি", "hepatitis", "হেপাটাইটিস",
  "leukemia", "লিউকেমিয়া", "tumour", "tumor", "টিউমার",
];

const NAME_LABELS = ["রোগীর নাম", "রোগী", "নাম", "patient", "name", "mr.", "mrs.", "জনাব", "বেগম"];

export type RedactionResult = {
  text: string;
  removed: { phones: number; names: number; diagnoses: number; emails: number; ids: number };
};

export function redact(input: string): RedactionResult {
  const removed = { phones: 0, names: 0, diagnoses: 0, emails: 0, ids: 0 };
  let text = toLatinDigits(input);

  text = text.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, () => {
    removed.emails++;
    return "[removed]";
  });
  // Bangladeshi mobile numbers: +8801…, 8801…, 01… (spaces/dashes allowed).
  text = text.replace(/(?:\+?880|0)[\s-]?1[3-9](?:[\s-]?\d){8}/g, () => {
    removed.phones++;
    return "[phone]";
  });
  // National-ID-like runs of 10/13/17 digits.
  text = text.replace(/\b\d{10}(?:\d{3}(?:\d{4})?)?\b/g, (m) => {
    if (m.length === 10 || m.length === 13 || m.length === 17) {
      removed.ids++;
      return "[id]";
    }
    return m;
  });
  // Text after a name label, up to comma / line break — single pass with an
  // alternation (longest labels first) so placeholders are never re-matched.
  const labelRe = new RegExp(
    `(${NAME_LABELS.map(escapeRegExp).join("|")}\\s*[:：]?\\s*)[^,\\n]+`,
    "gi",
  );
  text = text.replace(labelRe, (_m, prefix: string) => {
    removed.names++;
    return `${prefix}[name]`;
  });
  for (const word of DIAGNOSIS_WORDS) {
    const re = new RegExp(escapeRegExp(word), "gi");
    text = text.replace(re, () => {
      removed.diagnoses++;
      return "[removed]";
    });
  }
  return { text, removed };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
