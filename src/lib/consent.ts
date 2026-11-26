import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Local consent record for gate G3 (specs §1.5). The server `consents` row
 * is authoritative once signed in; this local record lets the welcome screen
 * be skipped on the same device and checked offline.
 */
const KEY = "udvasito.consent";

export type ConsentRecord = { consentVersion: string; acceptedAt: number; lang: string };

/**
 * Gate G3's decision (specs §1.5, roadmap P6): the local record
 * satisfies the gate only when it names the CURRENT consent version —
 * the one `public.appConfig` serves from the settings table. When the
 * team advances `consentVersion` after the law review (DEP-02), every
 * older local record stops satisfying the gate and the member is sent
 * through the one-time re-consent. Pure + unit-tested.
 */
export function consentSatisfies(
  localVersion: string | null | undefined,
  currentVersion: string,
): boolean {
  return Boolean(localVersion) && localVersion === currentVersion;
}

export async function getLocalConsent(): Promise<ConsentRecord | null> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ConsentRecord;
  } catch {
    return null;
  }
}

export async function setLocalConsent(record: ConsentRecord): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(record));
}
