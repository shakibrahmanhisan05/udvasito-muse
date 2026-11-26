import { toBanglaDigits } from "./phone";

/**
 * Language-consistent display formatting (X02 Bangla polish).
 * Numbers and dates render with Bangla digits in the Bangla UI and
 * Latin digits in English — one helper so every surface agrees.
 * (Member 3's full human walkthrough of the Bangla UI is a later
 * step; this is the shared formatter it will check against.)
 */

export function formatDigits(value: string | number, lang: string): string {
  const text = String(value);
  return lang === "bn" ? toBanglaDigits(text) : text;
}

/** "3" / "৩" — a plain count in the active language. */
export function formatCount(n: number, lang: string): string {
  return formatDigits(n, lang);
}

const DATE_LOCALES: Record<string, string> = { bn: "bn-BD", en: "en-GB" };

/** Localised date+time, digits localised with the language. */
export function formatDateTime(ts: number, lang: string): string {
  const formatted = new Intl.DateTimeFormat(DATE_LOCALES[lang] ?? "en-GB", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ts));
  return lang === "bn" ? toBanglaDigits(formatted) : formatted;
}

/** Localised time of day (for "Last updated …" style stamps). */
export function formatTime(ts: number, lang: string): string {
  const formatted = new Intl.DateTimeFormat(DATE_LOCALES[lang] ?? "en-GB", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ts));
  return lang === "bn" ? toBanglaDigits(formatted) : formatted;
}
