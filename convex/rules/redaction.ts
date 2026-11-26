/**
 * Redaction — PURE TypeScript. PRD §6.2: runs before EVERY AI call, on the
 * server, and its output is the ONLY text an AI service ever sees. The
 * original is never logged (PRD §6.2 rule 5); `aiCalls.inputRedacted`
 * stores this output.
 *
 * Rules (PRD §6.2):
 *  1. Bangladeshi phone numbers — +880 / 880 / 01 forms, separated by
 *     spaces, dashes, dots, parentheses or slashes (any run length,
 *     incl. fully spaced digits), Latin or Bangla digits. The contact
 *     number itself is recovered by CODE from the original text
 *     (`extractContactPhone`), never by AI.
 *  2. The text after a name label (রোগী, রোগীর নাম, রোগীর, নাম, Patient,
 *     Name, Mr., Mrs., জনাব, বেগম, Banglish "rogir") up to the next comma
 *     or line break. Labels must be whole words/tokens — "নাম" inside
 *     "নামাজ" (prayer) must NOT trigger removal.
 *  3. Known diagnosis/condition words from the maintained list below.
 *     Dengue is deliberately NOT in the list: whether a request is a
 *     dengue case is operational data the intake needs (isDengue), and
 *     PRD §6.2's examples do not include it.
 *  4. Email addresses and national-ID-like numbers (10/13/17 digits,
 *     contiguous or in spaced groups).
 */
const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";
export function toLatinDigits(text: string): string {
  return text.replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d)));
}

const DIAGNOSIS_WORDS = [
  "cancer", "ক্যান্সার", "dialysis", "ডায়ালাইসিস", "thalassaemia", "thalassemia",
  "থ্যালাসেমিয়া", "surgery", "অপারেশন", "hiv", "এইচআইভি", "hepatitis", "হেপাটাইটিস",
  "leukemia", "লিউকেমিয়া", "tumour", "tumor", "টিউমার",
  "stroke", "স্ট্রোক", "diabetes", "ডায়াবেটিস", "tuberculosis", "যক্ষ্মা",
  "pregnant", "pregnancy", "গর্ভবতী", "অন্তঃসত্ত্বা",
];

/** Latin-script diagnosis words need word boundaries ("hiv" in "chives"). */
function isLatinWord(s: string): boolean {
  return /^[a-z]+$/i.test(s);
}

// Bangla labels: longest first so "রোগীর নাম" wins over "রোগী"/"নাম".
const NAME_LABELS_BN = ["রোগীর নাম", "রোগী", "রোগীর", "নাম", "জনাব", "বেগম"];
// Latin labels: matched case-insensitively on word boundaries. Banglish
// "rogir nam" (= রোগীর নাম) is a label; bare "rogi/rogir" is a mid-sentence
// noun in Banglish ("rogir jonno rokto lagbe") and must NOT trigger.
const NAME_LABELS_LATIN = ["patient", "patient's", "name", "mr.", "mrs.", "rogir nam"];

export type RedactionResult = {
  text: string;
  removed: { phones: number; names: number; diagnoses: number; emails: number; ids: number };
};

/** Bangladeshi mobile pattern (after digit normalisation): the number
 *  itself, allowing separators between digits. Separators are space,
 *  dash, dot, parentheses and slash, in any run length — pasted Facebook
 *  posts (the primary intake source) write numbers as 01812.345.678,
 *  (01812) 345678, 01812  345678, 01812/345678 and even fully spaced
 *  0 1 8 1 2 3 4 5 6 7 8 (P4 review F2). PRD §6.2's enumerated set
 *  (spaces, dashes, Bangla digits) is a subset of this class. */
const PHONE_SHAPE = /(?:\+?880|00880|0)[\s()./-]*1[\s()./-]*[3-9](?:[\s()./-]*\d){8}/;
const PHONE_RE = new RegExp(PHONE_SHAPE.source, "g");

/**
 * True when the text contains a Bangladeshi mobile number in ANY of the
 * forms redact() removes — Latin or Bangla digits, any separator run.
 * Used to void AI responses that echo a number back (convex/ai/gemini).
 */
export function containsPhoneNumber(text: string): boolean {
  return PHONE_SHAPE.test(toLatinDigits(text));
}

/**
 * Extract the first Bangladeshi mobile number from RAW text (any digit
 * script, spaces/dashes allowed) and return it normalised to the
 * 01XXXXXXXXX Latin-digit form — or null. This is the ONLY way a contact
 * number is ever taken from free text (specs §6.10: by regex, never AI).
 */
export function extractContactPhone(input: string): string | null {
  const latin = toLatinDigits(input);
  const m = latin.match(PHONE_SHAPE);
  if (!m) return null;
  let digits = m[0].replace(/[^\d]/g, "");
  if (digits.startsWith("00880")) digits = digits.slice(5);
  else if (digits.startsWith("880")) digits = digits.slice(3);
  if (!digits.startsWith("0")) digits = `0${digits}`;
  return digits.length === 11 ? digits : null;
}

export function redact(input: string): RedactionResult {
  const removed = { phones: 0, names: 0, diagnoses: 0, emails: 0, ids: 0 };
  let text = toLatinDigits(input);

  // Rule 4a — emails.
  text = text.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, () => {
    removed.emails++;
    return "[removed]";
  });

  // Rule 1 — phone numbers.
  text = text.replace(PHONE_RE, () => {
    removed.phones++;
    return "[phone]";
  });

  // Rule 4b — national-ID-like numbers: 10/13/17 digits, contiguous…
  text = text.replace(/\b\d{10}(?:\d{3}(?:\d{4})?)?\b/g, (m) => {
    if (m.length === 10 || m.length === 13 || m.length === 17) {
      removed.ids++;
      return "[id]";
    }
    return m;
  });
  // …or written in spaced/dashed/dotted groups ("1234 5678 9012 34567",
  // "1234-5678-9012-3" — the dashed form is P4 review F5, absorbed here).
  text = text.replace(/\b\d[\d .-]{11,}\d\b/g, (m) => {
    const digits = m.replace(/[^\d]/g, "");
    if (digits.length === 10 || digits.length === 13 || digits.length === 17) {
      removed.ids++;
      return "[id]";
    }
    return m;
  });

  // Rule 2 — text after a name label, up to comma / line break / danda.
  // Bangla labels must be whole tokens: preceded by start/space/punct and
  // followed by a separator, so নামাজ/নামকরণ never trigger removal.
  const bnLabelRe = new RegExp(
    `(^|[\\s,।(])(${NAME_LABELS_BN.map(escapeRegExp).join("|")})(\\s*[:：]?\\s+|\\s*[:：]\\s*)[^,\\n।]+`,
    "gm",
  );
  text = text.replace(bnLabelRe, (_m, pre: string, label: string, sep: string) => {
    removed.names++;
    return `${pre}${label}${sep}[name]`;
  });
  const latinLabelRe = new RegExp(
    `\\b(${NAME_LABELS_LATIN.map(escapeRegExp).join("|")})(\\s*[:.]?\\s+|\\s*:\\s*)[^,\\n]+`,
    "gi",
  );
  text = text.replace(latinLabelRe, (_m, label: string, sep: string) => {
    removed.names++;
    return `${label}${sep}[name]`;
  });

  // Rule 3 — diagnosis/condition words.
  for (const word of DIAGNOSIS_WORDS) {
    const re = isLatinWord(word)
      ? new RegExp(`\\b${escapeRegExp(word)}\\b`, "gi")
      : new RegExp(escapeRegExp(word), "gi");
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
