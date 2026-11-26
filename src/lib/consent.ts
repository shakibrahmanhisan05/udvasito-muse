import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Local consent record for gate G3 (specs §1.5). The server `consents` row
 * is authoritative once signed in; this local record lets the welcome screen
 * be skipped on the same device and checked offline.
 */
const KEY = "udvasito.consent";

export type ConsentRecord = { consentVersion: string; acceptedAt: number; lang: string };

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
