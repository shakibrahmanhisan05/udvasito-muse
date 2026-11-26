/**
 * F-604 FAQ matching rules (pure). The assistant is FAQ-bound: it can
 * only ever return an APPROVED entry's own answer. Matching is
 * deterministic token overlap (works for Bangla and English — tokens
 * are Unicode letter/digit runs); the optional AI step may only pick
 * an entry id from the same approved list, never write an answer.
 */

export type FaqCandidate = {
  id: string;
  questionEn: string;
  questionBn: string;
  tags: string[];
};

const STOPWORDS = new Set([
  "a", "an", "the", "i", "me", "my", "can", "do", "does", "is", "it",
  "to", "of", "if", "what", "how", "when", "should", "am", "are", "be",
  "আমি", "কি", "কী", "না", "হয়", "এর", "এবং",
]);

export function faqTokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (tok) => tok.length > 1 && !STOPWORDS.has(tok),
  );
}

function entryTokenSet(entry: FaqCandidate): Set<string> {
  return new Set([
    ...faqTokens(entry.questionEn),
    ...faqTokens(entry.questionBn),
    ...entry.tags.flatMap((tag) => faqTokens(tag)),
  ]);
}

export type FaqMatch = { id: string; score: number; shared: number };

/**
 * Best deterministic match, or null. A confident match needs at
 * least 2 shared content tokens and an overlap score ≥ 0.5 (shared
 * tokens over the smaller side) — below that, the assistant must not
 * guess: the AI picker or an honest no-match follows.
 */
export function bestFaqMatch(question: string, entries: FaqCandidate[]): FaqMatch | null {
  const questionTokens = new Set(faqTokens(question));
  if (questionTokens.size === 0) return null;
  let best: FaqMatch | null = null;
  for (const entry of entries) {
    const entryTokens = entryTokenSet(entry);
    if (entryTokens.size === 0) continue;
    let shared = 0;
    for (const tok of questionTokens) {
      if (entryTokens.has(tok)) shared += 1;
    }
    const score = shared / Math.min(questionTokens.size, entryTokens.size);
    if (!best || score > best.score) best = { id: entry.id, score, shared };
  }
  if (!best || best.score < 0.5 || best.shared < 2) return null;
  return best;
}

/**
 * Personal-health deflection (mode "doctor"): first-person phrasing
 * plus a personal condition/context word, in either language. Runs
 * only when no approved FAQ entry confidently answers — the FAQ
 * itself contains first-person questions, and those win.
 */
const PERSONAL_MARKERS = ["i have", "i am", "i'm", "my ", "আমার", "আমি "];
const CONDITION_WORDS = [
  "diabetes", "pregnant", "medicine", "medication", "haemoglobin",
  "hemoglobin", "blood pressure", "cancer", "hiv", "hepatitis",
  "tattoo", "piercing", "surgery", "fever", "sick", "unwell",
  "ডায়াবেটিস", "গর্ভবতী", "ওষুধ", "হিমোগ্লোবিন", "রক্তচাপ",
  "ক্যান্সার", "ট্যাটু", "অসুস্থ", "জ্বর",
];

export function looksPersonalMedical(question: string): boolean {
  const text = ` ${question.toLowerCase()} `;
  const personal = PERSONAL_MARKERS.some((m) => text.includes(m));
  if (!personal) return false;
  return CONDITION_WORDS.some((w) => text.includes(w));
}
