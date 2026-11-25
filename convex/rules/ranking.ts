/**
 * Candidate ranking — PURE TypeScript. Contract: specs §6.10 / PRD §5.3.
 * P0 ships the place-tier ordering skeleton; the full filter set (quiet
 * hours, caps, blocks, verified-only, travel range, no-show tie-breakers)
 * is implemented in P2 when matching goes live (roadmap P2, F-301).
 */
export type RankCandidate = {
  donorProfileId: string;
  upazilaId: string;
  districtId: string;
  divisionId: string;
  lastActiveAt: number;
  alertsLast7Days: number;
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
    if (b.lastActiveAt !== a.lastActiveAt) return b.lastActiveAt - a.lastActiveAt;
    return a.alertsLast7Days - b.alertsLast7Days;
  });
}
