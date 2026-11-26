/**
 * Helpline (D-R3): the team helpline number lives in the Convex `settings`
 * table (fallbackContactPhone, set by the super-admin — DEP-05) and is
 * served by the dedicated `GET /public/helpline` endpoint (P1). It is
 * deliberately NOT part of public.appConfig, which never carries phone
 * numbers. Until the endpoint exists, useHelpline() returns null and no
 * helpline button renders (specs §1.9: no dead controls).
 */
import { normalizeBdPhone } from "./phone";

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

/**
 * useHelpline() — TODO(P1, D-R3): fetch GET /public/helpline (Convex HTTP
 * action) with a 24 h cache; the response shape is { phone: string }.
 */
export function useHelpline(): Helpline | null {
  return null;
}
