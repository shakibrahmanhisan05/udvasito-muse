/**
 * Rules-first intake parser — PURE TypeScript. Contract: specs §6.10.
 *
 * Extracts blood-request fields from free text in Bangla, English and
 * Banglish. This is the FIRST pass everywhere (on the device, and again
 * on the server inside intake.parse); the Gemini action is only asked
 * for fields this parser leaves missing (F-206). It never guesses: a
 * field it cannot find stays null and is reported in `missing`.
 *
 * Hospital matching uses ONLY the caller-supplied refData (from the
 * `hospitals` table — names + aliases), never a hard-coded list. Area
 * matching uses the caller-supplied place names (places table) plus,
 * when no area is mentioned, the matched hospital's own area when the
 * caller provides one (the server passes it only for metro-thana
 * hospitals, where "the hospital's area" is how people name the place).
 */
import { toLatinDigits } from "./redaction";

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
  hospitals: {
    _id: string;
    nameEn: string;
    nameBn: string;
    aliases: string[];
    /** The hospital's own area name, when the caller can stand behind it. */
    area?: string;
  }[];
  /** Place names people write in messages (upazila/thana level). */
  areas?: { nameEn: string; nameBn: string }[];
};

const ALL_FIELDS: (keyof IntakeFields)[] = [
  "bloodGroup", "component", "isDengue", "units", "hospitalId", "area", "neededByKind",
];

/** Normalise for matching: Bangla digits → Latin, Latin → lower case. */
function norm(text: string): string {
  return toLatinDigits(text).toLowerCase().replace(/\s+/g, " ").trim();
}

function tokens(text: string): string[] {
  // \p{M} matters: Bangla vowel signs are combining marks — without them
  // "এভারকেয়ার" would shatter into fragments at every sign.
  return norm(text).split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);
}

/** Token match with a light suffix tolerance (Bangla locative -এ/-তে,
 *  English plurals): one side a prefix of the other, min length 4. */
function tokenMatch(candidate: string, textToken: string): boolean {
  if (candidate === textToken) return true;
  if (candidate.length >= 4 && textToken.startsWith(candidate)) return true;
  if (textToken.length >= 4 && candidate.startsWith(textToken)) return true;
  return false;
}

// ── Blood group ────────────────────────────────────────────────────────

const BN_GROUP_LETTER: Record<string, string> = {
  "এবি": "AB", "বি": "B", "এ": "A", "ও": "O",
};

function parseBloodGroup(t: string): { value: string | null; confidence: number } {
  // "Group unknown" must win over everything (there is no group token in
  // such messages, but never let a stray letter+sign override it).
  if (
    /গ্রুপ\s*জানি\s*না/.test(t) ||
    /not sure[^.]*\bgroup\b/.test(t) ||
    /\bgroup\b[^.]*\bjani na\b/.test(t)
  ) {
    return { value: "not_sure", confidence: 0.85 };
  }
  if (
    /যেকোনো\s*গ্রুপ/.test(t) ||
    /\bjekono\s+group\b/.test(t) ||
    /\bany\s+(blood\s+)?group\b/.test(t) ||
    /\breplacement\b[^.]*\bany\b/.test(t)
  ) {
    return { value: "any", confidence: 0.85 };
  }
  // Symbolic Latin: B+, AB-, O+ … (also inside "(B+)").
  const sym = t.match(/\b(ab|a|b|o)\s*(\+ve|-ve|\+|-)/);
  if (sym) return { value: `${sym[1]!.toUpperCase()}${sym[2] === "+ve" ? "+" : sym[2] === "-ve" ? "-" : sym[2]}`, confidence: 1 };
  // Symbolic with Bangla letters: বি+, এবি- …
  const symBn = t.match(/(এবি|বি|এ|ও)\s*([+-])/);
  if (symBn) return { value: `${BN_GROUP_LETTER[symBn[1]!]}${symBn[2]}`, confidence: 0.95 };
  // Spelled Bangla: বি পজিটিভ, এ নেগেটিভ …
  const bn = t.match(/(এবি|বি|এ|ও)\s*(পজিটিভ|পজেটিভ|নেগেটিভ|নেগেটিভ)/);
  if (bn) {
    return {
      value: `${BN_GROUP_LETTER[bn[1]!]}${bn[2]!.startsWith("প") ? "+" : "-"}`,
      confidence: 0.9,
    };
  }
  // Spelled English/Banglish: "B positive", "O negative", "AB neg" …
  const en = t.match(/\b(ab|a|b|o)\s+(positive|negative|pos|neg)\b/);
  if (en) {
    return {
      value: `${en[1]!.toUpperCase()}${en[2]!.startsWith("pos") ? "+" : "-"}`,
      confidence: 0.9,
    };
  }
  return { value: null, confidence: 0 };
}

// ── Component / dengue ─────────────────────────────────────────────────

function parseComponent(t: string): { value: "whole_blood" | "platelets" | null; confidence: number } {
  if (/প্লাটিলেট|platelet/.test(t)) return { value: "platelets", confidence: 0.95 };
  if (/রক্ত|blood|rokto/.test(t)) return { value: "whole_blood", confidence: 0.6 };
  // A "replacement donor" request is a whole-blood request by definition
  // (the blood bank exchanges the unit) even when the word blood/রক্ত is
  // never written (bn-17).
  if (/রক্তদাতা|\bdonor\b/.test(t)) return { value: "whole_blood", confidence: 0.5 };
  return { value: null, confidence: 0 };
}

function parseDengue(t: string): boolean | null {
  return /ডেঙ্গু|dengue/.test(t) ? true : null;
}

// ── Units ──────────────────────────────────────────────────────────────

const PHONE_STRIP = /(?:\+?880|00880|0)[\s-]?1[3-9](?:[\s-]?\d){8}/g;

function parseUnits(tNoPhone: string): number | null {
  const m =
    tNoPhone.match(/(\d{1,2})\s*(?:ব্যাগ|bags?|units?)(?![\p{L}\p{N}])/u) ??
    tNoPhone.match(/(?:পরিমাণ|bags?|units?)\s*[:：]\s*(\d{1,2})/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 10 ? n : null;
}

// ── Hospital ───────────────────────────────────────────────────────────

/** Tokens that carry no identifying weight in a hospital name. */
const GENERIC_TOKENS = new Set([
  "hospital", "hospitals", "হাসপাতাল", "medical", "college", "কলেজ",
  "clinic", "clinical", "laboratory", "diagnostic", "centre", "center",
]);

function hospitalScore(candidate: string, textNorm: string, textTokens: string[]): number {
  const candTokens = tokens(candidate);
  if (candTokens.length === 0) return 0;
  // A candidate made only of generic tokens ("Medical", "Hospital") can
  // never identify a hospital on its own.
  if (!candTokens.some((ct) => !GENERIC_TOKENS.has(ct))) return 0;
  const candNorm = norm(candidate);
  if (candNorm.length >= 4 && textNorm.includes(candNorm)) return 1;
  let totalWeight = 0;
  let matchedWeight = 0;
  let matchedDistinctive = 0;
  let totalDistinctive = 0;
  for (const ct of candTokens) {
    const generic = GENERIC_TOKENS.has(ct);
    const w = generic ? 0.4 : 1;
    totalWeight += w;
    if (!generic) totalDistinctive++;
    if (textTokens.some((tt) => tokenMatch(ct, tt))) {
      matchedWeight += w;
      if (!generic) matchedDistinctive++;
    }
  }
  // A candidate with no distinctive token matched can never win — this is
  // what stops "local clinic" from matching "… Clinical Laboratory".
  if (matchedDistinctive === 0) return 0;
  const ratio = matchedWeight / totalWeight;
  if (ratio >= 0.6) return ratio;
  // Partial distinctive coverage (e.g. ইম্পেরিয়াল হাসপাতাল for
  // "অ্যাপোলো ইম্পেরিয়াল") still counts, at its true ratio.
  if (totalDistinctive >= 2 && matchedDistinctive / totalDistinctive >= 0.5) return ratio;
  if (candTokens.length === 1 && matchedDistinctive === 1) return 0.9;
  return 0;
}

function parseHospital(
  textNorm: string,
  textTokens: string[],
  refData: IntakeRefData,
): { id: string | null; score: number; area?: string } {
  const ranked = rankHospitals(textNorm, textTokens, refData);
  return ranked[0] ?? { id: null, score: 0 };
}

/** All hospitals the text plausibly names, best first (score > 0.3). */
export function rankHospitals(
  textNorm: string,
  textTokens: string[],
  refData: IntakeRefData,
): { id: string; score: number; area?: string }[] {
  const out: { id: string; score: number; area?: string }[] = [];
  for (const h of refData.hospitals) {
    const candidates = [h.nameEn, h.nameBn, ...h.aliases];
    let score = 0;
    for (const c of candidates) {
      score = Math.max(score, hospitalScore(c, textNorm, textTokens));
    }
    if (score > 0.3) out.push({ id: h._id, score, area: h.area });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Match a hospital NAME (e.g. one the AI extracted) back to a refData
 * hospital — specs §6.1: "hospital names matched" after the AI call.
 * Exact normalised match first, then token overlap. Null when unsure:
 * the AI never gets to invent a hospital.
 */
export function findHospitalByName(
  name: string,
  refData: IntakeRefData,
): { id: string; area?: string } | null {
  const target = norm(name);
  if (!target) return null;
  const targetTokens = tokens(name);
  let best: { id: string; area?: string; score: number } | null = null;
  for (const h of refData.hospitals) {
    for (const cand of [h.nameEn, h.nameBn, ...h.aliases]) {
      const candNorm = norm(cand);
      let score = 0;
      if (candNorm === target) score = 1;
      else if (candNorm.length >= 4 && target.includes(candNorm)) score = 0.95;
      else if (target.length >= 4 && candNorm.includes(target)) score = 0.9;
      else {
        const candTokens = tokens(cand);
        if (candTokens.length > 0 && targetTokens.length > 0) {
          const matched = candTokens.filter((ct) =>
            targetTokens.some((tt) => tokenMatch(ct, tt)),
          ).length;
          score = Math.min(matched / candTokens.length, matched / targetTokens.length);
        }
      }
      if (score >= 0.6 && (best === null || score > best.score)) {
        best = { id: h._id, area: h.area, score };
      }
    }
  }
  return best ? { id: best.id, area: best.area } : null;
}

/** Named candidates for the parse response (specs §6.1): the hospitals
 *  the text plausibly refers to, best first, at most `limit`. */
export function hospitalCandidates(
  text: string,
  refData: IntakeRefData,
  limit = 3,
): { _id: string; nameEn: string; nameBn: string; score: number }[] {
  const ranked = rankHospitals(norm(text), tokens(text), refData);
  const byId = new Map(refData.hospitals.map((h) => [h._id, h]));
  return ranked.slice(0, limit).map((r) => {
    const h = byId.get(r.id)!;
    return { _id: h._id, nameEn: h.nameEn, nameBn: h.nameBn, score: r.score };
  });
}

// ── Area ───────────────────────────────────────────────────────────────

function parseAreaMention(textNorm: string, textTokens: string[], refData: IntakeRefData): string | null {
  const areas = [...(refData.areas ?? [])].sort(
    (a, b) => b.nameEn.length - a.nameEn.length,
  );
  for (const a of areas) {
    const en = norm(a.nameEn);
    if (en && new RegExp(`(^|[^\\p{L}])${escapeRegExp(en)}([^\\p{L}]|$)`).test(textNorm)) {
      return a.nameEn;
    }
    const bn = norm(a.nameBn);
    // Bangla: exact token, or the text token carries a locative suffix
    // (আগ্রাবাদে, পাঁচলাইশে). Never the reverse — "করিম" (a name) must not
    // match করিমগঞ্জ, and "পরশু" (day after tomorrow) must not match
    // পরশুরাম.
    if (bn && textTokens.some((tt) => tt === bn || (bn.length >= 4 && tt.startsWith(bn)))) {
      return a.nameEn;
    }
  }
  return null;
}

// ── Needed-by ──────────────────────────────────────────────────────────

function parseNeededBy(t: string, textTokens: string[]): { value: IntakeFields["neededByKind"]; confidence: number } {
  const hasToken = (tok: string) => textTokens.includes(tok);
  // Day after tomorrow — its own kind ("datetime": a specific date).
  if (
    /আগামী\s*পরশু/.test(t) || hasToken("পরশু") ||
    /\bporshu\b/.test(t) || /day after tomorrow/.test(t)
  ) {
    return { value: "datetime", confidence: 0.9 };
  }
  if (/\d{4}-\d{2}-\d{2}/.test(t)) return { value: "datetime", confidence: 0.8 };
  // Tomorrow beats "urgent" (bn-01: জরুরি ভিত্তিতে … আগামীকাল সকালে).
  if (
    /আগামীকাল|আগামিকাল/.test(t) ||
    /\bagamikal\b/.test(t) || /\btomorrow\b/.test(t)
  ) {
    return { value: "tomorrow", confidence: 0.9 };
  }
  // Today (whole-token আজ forms so কাজ/আজগুবি never match).
  if (
    /(^|[\s,।:;—-])(আজকেই|আজকে|আজই|আজকের|আজ)(?=[\s,।:;—-]|$)/.test(t) ||
    /\bajkei?\b/.test(t) || /\btoday\b/.test(t) || /\btonight\b/.test(t) ||
    /this evening/.test(t)
  ) {
    return { value: "today", confidence: 0.9 };
  }
  // Now.
  if (
    /এখনই|এখনি/.test(t) || /\bekhoni?\b/.test(t) || /\bekhon\b/.test(t) ||
    /right now/.test(t) || /\bnow\b/.test(t)
  ) {
    return { value: "now", confidence: 0.9 };
  }
  // Urgency words alone still mean "as soon as possible".
  if (/জরুরি|urgent/.test(t)) return { value: "now", confidence: 0.6 };
  return { value: null, confidence: 0 };
}

// ── Main entry ─────────────────────────────────────────────────────────

export function parseIntake(
  text: string,
  _lang: "en" | "bn",
  refData: IntakeRefData,
): IntakeResult {
  const t = norm(text);
  const textTokens = tokens(text);
  const tNoPhone = t.replace(PHONE_STRIP, " ");

  const group = parseBloodGroup(t);
  const component = parseComponent(t);
  const isDengue = parseDengue(t);
  const units = parseUnits(tNoPhone);
  const hospital = parseHospital(t, textTokens, refData);
  const areaMention = parseAreaMention(t, textTokens, refData);
  const neededBy = parseNeededBy(t, textTokens);

  const fields: IntakeFields = {
    bloodGroup: group.value,
    component: component.value,
    isDengue,
    units,
    hospitalId: hospital.id,
    area: areaMention ?? hospital.area ?? null,
    neededByKind: neededBy.value,
  };
  const confidence: Partial<Record<keyof IntakeFields, number>> = {};
  if (group.value) confidence.bloodGroup = group.confidence;
  if (component.value) confidence.component = component.confidence;
  if (isDengue) confidence.isDengue = 0.95;
  if (units !== null) confidence.units = 0.95;
  if (hospital.id) confidence.hospitalId = hospital.score;
  if (fields.area) confidence.area = areaMention ? 0.9 : 0.7;
  if (neededBy.value) confidence.neededByKind = neededBy.confidence;

  return {
    fields,
    confidence,
    missing: ALL_FIELDS.filter((f) => fields[f] === null),
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
