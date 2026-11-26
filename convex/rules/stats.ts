/**
 * Stats aggregation — PURE TypeScript (specs §6.10 style). The Convex
 * side (convex/stats.ts) loads rows and feeds plain shapes in; every
 * number on the admin dashboard (SCR-A01) and the public stats is
 * computed here from source data — no separately maintained counters
 * (US-A01 AC). Definitions follow PRD §2.2 exactly.
 *
 * Calendar days are Asia/Dhaka (product rule); the AI quota day is
 * America/Los_Angeles (the provider's reset, PRD §6.3).
 */

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

const DHAKA_OFFSET_MS = 6 * 3_600_000; // UTC+6, no DST (Bangladesh since 2009)
const DAY_MS = 86_400_000;

function partsIn(tz: string, ts: number): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(ts));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** "YYYY-MM-DD" in Asia/Dhaka. */
export function dhakaDayKey(ts: number): string {
  const { y, m, d } = partsIn("Asia/Dhaka", ts);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Start (00:00 Asia/Dhaka) of the Dhaka day containing ts. */
export function dhakaDayStart(ts: number): number {
  const { y, m, d } = partsIn("Asia/Dhaka", ts);
  return Date.UTC(y, m - 1, d) - DHAKA_OFFSET_MS;
}

/** "YYYY-MM-DD" in America/Los_Angeles — the Gemini quota day. */
export function laDayKey(ts: number): string {
  const { y, m, d } = partsIn("America/Los_Angeles", ts);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Offset (ms) of a timezone at an instant, via Intl parts. */
function tzOffsetMs(tz: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Start (00:00 America/Los_Angeles) of the LA day containing ts —
 * two-pass offset resolution; exact except inside the DST switch
 * hour, twice a year.
 */
export function laDayStart(ts: number): number {
  const { y, m, d } = partsIn("America/Los_Angeles", ts);
  const utcMidnight = Date.UTC(y, m - 1, d);
  const firstPass = utcMidnight - tzOffsetMs("America/Los_Angeles", utcMidnight);
  return utcMidnight - tzOffsetMs("America/Los_Angeles", firstPass);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ── Blood pool (SCR-A01 card 2, public donorsByGroup) ────────────────

export type DonorRow = {
  bloodGroup: string;
  live: boolean;
  availability: string;
  eligibleFrom: number;
};

export function bloodPool(donors: DonorRow[], now: number) {
  const byGroup = Object.fromEntries(
    BLOOD_GROUPS.map((g) => [g, { live: 0, availableNow: 0 }]),
  ) as Record<BloodGroup, { live: number; availableNow: number }>;
  let donorsLive = 0;
  for (const donor of donors) {
    if (!donor.live) continue;
    donorsLive++;
    const bucket = byGroup[donor.bloodGroup as BloodGroup];
    if (!bucket) continue; // "unknown" can never be live (donorLive.ts)
    bucket.live++;
    if (donor.availability === "available" && donor.eligibleFrom <= now) {
      bucket.availableNow++;
    }
  }
  return { byGroup, donorsLive };
}

// ── Funnel (PRD §2.2, SCR-A01 card 4) ────────────────────────────────

export type FunnelRequestRow = { id: string };
export type FunnelResponseRow = {
  requestId: string;
  openedAt?: number;
  acceptedAt?: number;
  outcomeRequesterAt?: number;
  outcomeDonorAt?: number;
  outcomeDonor?: string;
};

export function funnelFromRows(
  requests: FunnelRequestRow[],
  responses: FunnelResponseRow[],
  revealRequestIds: ReadonlySet<string>,
) {
  const byRequest = new Map<string, FunnelResponseRow[]>();
  for (const r of responses) {
    const list = byRequest.get(r.requestId) ?? [];
    list.push(r);
    byRequest.set(r.requestId, list);
  }
  let donorsNotified = 0, alertOpened = 0, donorAccepted = 0;
  let reportedByRequester = 0, confirmedByDonor = 0, anyAnswer = 0;
  let donationsConfirmedRequests = 0;
  for (const req of requests) {
    const rs = byRequest.get(req.id) ?? [];
    if (rs.length > 0) donorsNotified++;
    if (rs.some((r) => r.openedAt !== undefined)) alertOpened++;
    if (rs.some((r) => r.acceptedAt !== undefined)) donorAccepted++;
    if (rs.some((r) => r.outcomeRequesterAt !== undefined)) reportedByRequester++;
    if (rs.some((r) => r.outcomeDonorAt !== undefined)) confirmedByDonor++;
    if (rs.some((r) => r.outcomeDonor === "donated")) donationsConfirmedRequests++;
    if (rs.some((r) => r.outcomeRequesterAt !== undefined || r.outcomeDonorAt !== undefined)) {
      anyAnswer++;
    }
  }
  const contactShared = requests.filter((r) => revealRequestIds.has(r.id)).length;
  return {
    published: requests.length,
    donorsNotified,
    alertOpened,
    donorAccepted,
    contactShared,
    reportedByRequester,
    confirmedByDonor,
    /** PRD §2.2: any "Did it happen?" answer ÷ requests with contact_shared. */
    confirmationResponseRate: contactShared > 0 ? anyAnswer / contactShared : null,
    /** Requests with at least one donor-confirmed donation (G2). */
    donationsConfirmedRequests,
  };
}

// ── Speed (G1, SCR-A01 card 3) ───────────────────────────────────────

export type SpeedRequestRow = {
  id: string;
  createdAt: number;
  urgency: string;
  districtId: string;
};
export type SpeedResponseRow = {
  requestId: string;
  wave: number;
  notifiedAt: number;
  acceptedAt?: number;
};

export function speedFromRows(
  requests: SpeedRequestRow[],
  responses: SpeedResponseRow[],
  windowStart: number,
  pilotDistrictIds: readonly string[],
) {
  const firstWave = new Map<string, number>();
  const firstAccept = new Map<string, number>();
  for (const r of responses) {
    if (r.wave >= 1) {
      const cur = firstWave.get(r.requestId);
      if (cur === undefined || r.notifiedAt < cur) firstWave.set(r.requestId, r.notifiedAt);
    }
    if (r.acceptedAt !== undefined) {
      const cur = firstAccept.get(r.requestId);
      if (cur === undefined || r.acceptedAt < cur) firstAccept.set(r.requestId, r.acceptedAt);
    }
  }
  const waveDeltas: number[] = [];
  const acceptDeltas: number[] = [];
  for (const req of requests) {
    if (req.createdAt < windowStart) continue;
    const waved = firstWave.get(req.id);
    if (waved !== undefined) waveDeltas.push(waved - req.createdAt);
    // PRD §2.2: first acceptance is over "Now" requests in the pilot
    // district (all districts while pilotDistrictIds is unseeded).
    if (req.urgency === "now" &&
        (pilotDistrictIds.length === 0 || pilotDistrictIds.includes(req.districtId))) {
      const accepted = firstAccept.get(req.id);
      if (accepted !== undefined) acceptDeltas.push(accepted - req.createdAt);
    }
  }
  return {
    medianFirstWaveMs: median(waveDeltas),
    medianFirstAcceptMs: median(acceptDeltas),
    wavedRequests: waveDeltas.length,
    acceptedRequests: acceptDeltas.length,
  };
}

// ── Participation (G3, SCR-A01 card 5) ───────────────────────────────

/** New donor registrations per Dhaka day, zero-filled, oldest first. */
export function registrationsByDay(createdAts: number[], now: number, days = 30) {
  const todayStart = dhakaDayStart(now);
  const out: { day: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = todayStart - i * DAY_MS;
    out.push({ day: dhakaDayKey(start), count: 0 });
  }
  const indexByDay = new Map(out.map((row, i) => [row.day, i]));
  for (const ts of createdAts) {
    const idx = indexByDay.get(dhakaDayKey(ts));
    if (idx !== undefined) out[idx].count++;
  }
  return out;
}

// ── Volunteer coverage (SCR-A01 card 6) ──────────────────────────────

export type DutyEventRow = { vpId?: string; onDuty: boolean; at: number };

/**
 * Rebuild duty intervals per volunteer from `volunteer_duty_changed`
 * events. Events before P5 carry no vpId and are ignored (coverage can
 * only be attributed per volunteer from P5 on). A volunteer currently
 * on duty closes their open interval at `now` (or contributes
 * [onDutySince, now] when no event opened one); a volunteer currently
 * off duty closes any open interval at their last event (conservative:
 * coverage is never invented).
 */
export function dutyIntervals(
  events: DutyEventRow[],
  currentlyOnDuty: ReadonlyMap<string, number | null>,
  now: number,
): { start: number; end: number }[] {
  const byVp = new Map<string, DutyEventRow[]>();
  for (const e of events) {
    if (!e.vpId) continue;
    const list = byVp.get(e.vpId) ?? [];
    list.push(e);
    byVp.set(e.vpId, list);
  }
  const intervals: { start: number; end: number }[] = [];
  const vpIds = new Set([...byVp.keys(), ...currentlyOnDuty.keys()]);
  for (const vpId of vpIds) {
    const list = (byVp.get(vpId) ?? []).sort((a, b) => a.at - b.at);
    let open: number | null = null;
    for (const e of list) {
      if (e.onDuty) {
        if (open === null) open = e.at;
      } else if (open !== null) {
        intervals.push({ start: open, end: e.at });
        open = null;
      }
    }
    const onDutySince = currentlyOnDuty.get(vpId);
    const isOnDuty = currentlyOnDuty.has(vpId);
    if (isOnDuty) {
      if (open !== null) intervals.push({ start: open, end: now });
      else if (onDutySince !== null && onDutySince !== undefined) {
        intervals.push({ start: onDutySince, end: now });
      }
    } else if (open !== null && list.length > 0) {
      intervals.push({ start: open, end: list[list.length - 1].at });
    }
  }
  return intervals.filter((i) => i.end > i.start);
}

/** For each Dhaka hour 0–23: on how many of the last `days` days was at
 *  least one volunteer on duty during that hour? Plus the gap hours
 *  (never covered) and the total uncovered day-hour slots. */
export function coverageByHour(
  intervals: { start: number; end: number }[],
  now: number,
  days = 7,
) {
  const byHour = new Array<number>(24).fill(0);
  let uncoveredSlots = 0;
  const todayStart = dhakaDayStart(now);
  for (let d = 0; d < days; d++) {
    const dayStart = todayStart - d * DAY_MS;
    for (let h = 0; h < 24; h++) {
      const slotStart = dayStart + h * 3_600_000;
      const slotEnd = slotStart + 3_600_000;
      const covered = intervals.some((i) => i.start < slotEnd && i.end > slotStart);
      if (covered) byHour[h]++;
      else uncoveredSlots++;
    }
  }
  const gapHours = byHour.map((count, h) => (count === 0 ? h : -1)).filter((h) => h >= 0);
  return { byHour, gapHours, uncoveredSlots, days };
}
