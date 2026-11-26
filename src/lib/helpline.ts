/**
 * Helpline (D-R3): the team helpline number lives in the Convex `settings`
 * table (fallbackContactPhone, set by the super-admin — DEP-05). It is
 * deliberately NOT part of public.appConfig and never appears in the client
 * bundle (tests/helpline-bundle.test.ts scans for number literals).
 *
 * - Signed in: the `support.helpline` Convex query (server rate-limited).
 * - Signed out: `GET /public/helpline` on the Convex site URL, fetched ONLY
 *   when the visitor taps the helpline button (D-R3), cached for 24 h.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "convex/react";
import { normalizeBdPhone } from "./phone";
import { refs } from "./refs";
import { convexSiteUrl, isAuthConfigured } from "./auth-client";

export type Helpline = {
  /** Canonical +880… number from settings. */
  phone: string;
  /** tel: link for call buttons. */
  telUrl: string;
};

export function helplineFromPhone(phone: string | null | undefined): Helpline | null {
  const normalized = phone ? normalizeBdPhone(phone) : null;
  return normalized ? { phone: normalized, telUrl: `tel:${normalized}` } : null;
}

/** Signed-in helpline (specs §6.5). Null until loaded / when unset. */
export function useHelpline(enabled: boolean): Helpline | null {
  const result = useQuery(refs.helpline, enabled && isAuthConfigured ? {} : "skip");
  return helplineFromPhone(result?.phone);
}

const CACHE_KEY = "udvasito.helpline";
const CACHE_MS = 24 * 3_600_000;

/** Signed-out path: fetch on tap only; 24 h device cache (D-R3). */
export async function fetchHelplinePublic(): Promise<Helpline | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw) as { phone: string; at: number };
      if (Date.now() - cached.at < CACHE_MS) return helplineFromPhone(cached.phone);
    }
  } catch {
    // Cache is an optimisation; fall through to the network.
  }
  if (!convexSiteUrl) return null;
  try {
    const res = await fetch(`${convexSiteUrl}/public/helpline`);
    if (!res.ok) return null;
    const body = (await res.json()) as { phone?: string };
    const helpline = helplineFromPhone(body.phone);
    if (helpline) {
      await AsyncStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ phone: helpline.phone, at: Date.now() }),
      );
    }
    return helpline;
  } catch {
    return null;
  }
}
