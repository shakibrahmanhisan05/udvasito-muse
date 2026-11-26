/**
 * Client-side view of public.appConfig (specs §6.1) + gate helpers (G1).
 * The live values come from Convex at runtime (P1 wiring); the bundled
 * fallbacks below mirror the P0 seed defaults so gates behave sanely offline.
 */
export type VerificationConfig = {
  telegram: boolean;
  whatsapp: boolean;
  inPerson: boolean;
  telegramBot: string;
  whatsappNumber: string;
};

export type AppConfig = {
  minimumAppVersion: string;
  latestAppVersion: string;
  consentVersion: string;
  features: Record<string, boolean>;
  practiceAreaEnabled: boolean;
  emailSignInEnabled: boolean;
  apkUrl: string;
  apkSha256: string;
  verification: VerificationConfig;
  aiFeatures: Record<string, boolean>;
};

export const FALLBACK_APP_CONFIG: AppConfig = {
  minimumAppVersion: "0.1.0",
  latestAppVersion: "0.1.0",
  consentVersion: "2026-11-28-pilot",
  features: {},
  practiceAreaEnabled: false,
  emailSignInEnabled: false,
  apkUrl: "",
  apkSha256: "",
  // Mirrors the seeded `verification` setting: Telegram + in-person on,
  // WhatsApp off, no bot username until the admin sets it (RB-5).
  verification: { telegram: true, whatsapp: false, inPerson: true, telegramBot: "", whatsappNumber: "" },
  aiFeatures: {},
};

/** Semver-ish compare for gate G1: is `current` older than `minimum`? */
export function isVersionBelow(current: string, minimum: string): boolean {
  const parse = (v: string) => v.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const [a, b] = [parse(current), parse(minimum)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) < (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) > (b[i] ?? 0)) return false;
  }
  return false;
}
