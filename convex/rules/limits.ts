/**
 * Request limits — PURE TypeScript. PRD §5.8 / S-22.
 */
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
