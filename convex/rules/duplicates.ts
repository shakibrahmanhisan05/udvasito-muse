/**
 * Duplicate-request rules (F-208 warning + F-707 merge, R12/V06) —
 * pure functions, unit-tested in tests/p7-rules.test.ts.
 *
 * The rule (R12 AC): an open request with the same blood group at the
 * same hospital (or, when no hospital is picked, in the same upazila)
 * inside the S-31 window is "probably the same patient". The warning
 * is rules-only; any AI "looks similar" hint is an optional extra and
 * never decides (PRD §6.4).
 */

export type DupCandidate = {
  id: string;
  requesterId: string;
  bloodGroup: string;
  hospitalId?: string;
  upazilaId: string;
  createdAt: number;
  publicSlug: string;
};

export function findDuplicate(
  candidates: DupCandidate[],
  args: {
    bloodGroup: string;
    hospitalId?: string;
    upazilaId: string;
    since: number;
    excludeRequesterId: string;
  },
): DupCandidate | undefined {
  const matches = candidates.filter((c) => {
    if (c.requesterId === args.excludeRequesterId) return false;
    if (c.bloodGroup !== args.bloodGroup) return false;
    if (c.createdAt < args.since) return false;
    // With a hospital picked, only the same hospital counts; without
    // one, the same upazila is the strongest signal available.
    if (args.hospitalId) return c.hospitalId === args.hospitalId;
    return c.upazilaId === args.upazilaId;
  });
  matches.sort((a, b) => b.createdAt - a.createdAt);
  return matches[0];
}

/** Group key for pair suggestion: same group + same place. */
export function dupGroupKey(c: { bloodGroup: string; hospitalId?: string; upazilaId: string }): string {
  return `${c.bloodGroup}|${c.hospitalId ?? `upazila:${c.upazilaId}`}`;
}

/**
 * When a donor has responses on both requests being merged, exactly
 * one survives on the target. Priority reflects commitment strength:
 * a confirmed slot must never be lost to a mere notification.
 */
const RESPONSE_PRIORITY: Record<string, number> = {
  confirmed: 6,
  accepted: 5,
  standby: 4,
  opened: 3,
  notified: 2,
  not_responding: 1,
  withdrew: 0,
  declined: 0,
};

export function strongerResponseState(a: string, b: string): string {
  return (RESPONSE_PRIORITY[a] ?? 0) >= (RESPONSE_PRIORITY[b] ?? 0) ? a : b;
}

export function responsePriority(state: string): number {
  return RESPONSE_PRIORITY[state] ?? 0;
}
