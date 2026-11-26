/**
 * Practice-area helpers (D-R4, specs §3 P-10 / §6.4 F-912). Practice
 * accounts sign in with a Practice ID (P-01…) + a 6-digit PIN as an
 * email+password credential on a reserved, undeliverable domain:
 * the ID is the local part, the PIN is the password. The domain can
 * never receive mail and can never collide with a real account.
 */
export const PRACTICE_EMAIL_DOMAIN = "practice.udvasito.invalid";
export const PRACTICE_ID_PATTERN = /^P-\d{2,3}$/;
export const PIN_PATTERN = /^\d{6}$/; // VAL-27
export const MAX_PRACTICE_ACCOUNTS = 10;

export function practiceEmailFor(practiceId: string): string {
  return `${practiceId.toLowerCase()}@${PRACTICE_EMAIL_DOMAIN}`;
}

/** "P-07" from "p-07@practice.udvasito.invalid", else null. */
export function practiceIdFromEmail(email: string): string | null {
  const lower = email.trim().toLowerCase();
  if (!lower.endsWith(`@${PRACTICE_EMAIL_DOMAIN}`)) return null;
  const local = lower.slice(0, -PRACTICE_EMAIL_DOMAIN.length - 1).toUpperCase();
  return PRACTICE_ID_PATTERN.test(local) ? local : null;
}

export function isPracticeEmail(email: string): boolean {
  return practiceIdFromEmail(email) !== null;
}

export function isValidPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

/** Next free Practice ID (P-01…P-10) from the ones already in use. */
export function nextPracticeId(used: string[]): string | null {
  for (let n = 1; n <= MAX_PRACTICE_ACCOUNTS; n++) {
    const candidate = `P-${String(n).padStart(2, "0")}`;
    if (!used.includes(candidate)) return candidate;
  }
  return null;
}

/** 6-digit PIN from a random source in [0, 1) — leading zeros kept. */
export function generatePin(random: () => number): string {
  return String(Math.floor(random() * 1_000_000)).padStart(6, "0");
}
