/**
 * Candidate ranking — PURE TypeScript. Contract: specs §6.10 / PRD §5.3.
 * Order (PRD §5.3 steps 2–3): place tier (same thana → neighbours within
 * S-32 → same district → same division → wider), then exact group before
 * compatible, most recently active, fewer alerts in the last 7 days, and
 * finally lower no-show count inside the S-37 window.
 */
export type RankCandidate = {
  donorProfileId: string;
  upazilaId: string;
  districtId: string;
  divisionId: string;
  lastActiveAt: number;
  alertsLast7Days: number;
  /** Exact group match for the request (compatible-group donors rank after). */
  exactGroup?: boolean;
  /** No-shows inside the S-37 window (lower is better). */
  noShowCount?: number;
};

export type RankRequest = {
  upazilaId: string;
  districtId: string;
  divisionId: string;
  neighbourUpazilaIds: string[];
};

/** Great-circle distance in km between two lat/lng points. */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function placeTier(candidate: RankCandidate, request: RankRequest): number {
  if (candidate.upazilaId === request.upazilaId) return 0;
  if (request.neighbourUpazilaIds.includes(candidate.upazilaId)) return 1;
  if (candidate.districtId === request.districtId) return 2;
  if (candidate.divisionId === request.divisionId) return 3;
  return 4;
}

export function rankCandidates(
  candidates: RankCandidate[],
  request: RankRequest,
): RankCandidate[] {
  return [...candidates].sort((a, b) => {
    const tier = placeTier(a, request) - placeTier(b, request);
    if (tier !== 0) return tier;
    const exact = Number(b.exactGroup ?? true) - Number(a.exactGroup ?? true);
    if (exact !== 0) return exact;
    if (b.lastActiveAt !== a.lastActiveAt) return b.lastActiveAt - a.lastActiveAt;
    if (a.alertsLast7Days !== b.alertsLast7Days) return a.alertsLast7Days - b.alertsLast7Days;
    return (a.noShowCount ?? 0) - (b.noShowCount ?? 0);
  });
}
