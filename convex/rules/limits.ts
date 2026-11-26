/**
 * Request limits — PURE TypeScript. PRD §5.8 / S-22.
 */

/** F-803 request-farming detection window (PRD §5.8, "request-farming patterns"). */
export const FARMING_WINDOW_DAYS = 30;
export const FARMING_DISTINCT_GROUPS = 3;
export const FARMING_DISTINCT_HOSPITALS = 3;
export const FARMING_EXPIRED_UNFULFILLED = 3;

/**
 * Request-farming signals over one requester's recent history (F-803,
 * PRD §5.8). A real family emergency repeats the same blood group at
 * the same hospital; farming for numbers hops groups and hospitals or
 * lets every request expire unfulfilled. Returns signal names for the
 * moderation item (empty = nothing suspicious). Heuristic thresholds,
 * like the VAL bounds — the numeric abuse limits themselves (S-22
 * etc.) live in settings.
 */
export function farmingSignals(
  history: {
    bloodGroup: string;
    hospitalId?: string;
    closeReason?: string;
    unitsConfirmed: number;
  }[],
): string[] {
  const signals: string[] = [];
  const groups = new Set(history.map((r) => r.bloodGroup));
  if (groups.size >= FARMING_DISTINCT_GROUPS) signals.push("many_blood_groups");
  const hospitals = new Set(
    history.map((r) => r.hospitalId).filter((h) => h !== undefined),
  );
  if (hospitals.size >= FARMING_DISTINCT_HOSPITALS) {
    signals.push("many_hospitals");
  }
  const expiredUnfulfilled = history.filter(
    (r) => r.closeReason === "expired" && r.unitsConfirmed === 0,
  ).length;
  if (expiredUnfulfilled >= FARMING_EXPIRED_UNFULFILLED) {
    signals.push("requests_never_fulfilled");
  }
  return signals;
}
export type LimitsSettings = {
  openRequestsUnverified: number;
  openRequestsVerified: number;
  requestsPerMonth: number;
  volunteerRequestsPerMonth: number;
};

export type LimitResult =
  | { ok: true }
  | { ok: false; code: "ERR_OPEN_REQUEST_LIMIT" | "ERR_MONTHLY_REQUEST_LIMIT"; params: { count: number } };

export function canCreateRequest(
  profile: { phoneVerified: boolean },
  counts: { open: number; thisMonth: number; isVolunteerPosting: boolean },
  settings: LimitsSettings,
): LimitResult {
  const openLimit = profile.phoneVerified
    ? settings.openRequestsVerified
    : settings.openRequestsUnverified;
  if (counts.open >= openLimit) {
    return { ok: false, code: "ERR_OPEN_REQUEST_LIMIT", params: { count: counts.open } };
  }
  const monthlyLimit = counts.isVolunteerPosting
    ? settings.volunteerRequestsPerMonth
    : settings.requestsPerMonth;
  if (counts.thisMonth >= monthlyLimit) {
    return { ok: false, code: "ERR_MONTHLY_REQUEST_LIMIT", params: { count: counts.thisMonth } };
  }
  return { ok: true };
}
