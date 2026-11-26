/**
 * Alert policy — PURE TypeScript. PRD §5.3 filter step: a donor is only
 * alerted when they are under their daily alert cap (S-20, per-donor value
 * seeded from the setting) and outside their quiet hours (S-21, per-donor
 * window) — unless the request is urgent ("now") AND the donor opted in
 * to urgent overrides. All clock maths is Asia/Dhaka, where quiet hours
 * and "per day" are defined.
 */

const DAY_MS = 86_400_000;

/** Minutes since midnight in Asia/Dhaka for a UTC timestamp. */
export function dhakaMinutesOfDay(now: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(now));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return (get("hour") % 24) * 60 + get("minute");
}

/** UTC timestamp of the current Asia/Dhaka calendar day's start. */
export function startOfDhakaDay(now: number): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  return Date.parse(`${get("year")}-${get("month")}-${get("day")}T00:00:00+06:00`);
}

function parseHHmm(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Is `now` inside the quiet window? Windows may wrap past midnight. */
export function isQuietHours(now: number, startHHmm: string, endHHmm: string): boolean {
  const start = parseHHmm(startHHmm);
  const end = parseHHmm(endHHmm);
  if (start === end) return false;
  const minutes = dhakaMinutesOfDay(now);
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}

export type AlertDecision = {
  now: number;
  /** Alerts already sent to this donor today (Asia/Dhaka day). */
  alertsToday: number;
  /** The donor's daily cap (S-20). */
  capPerDay: number;
  quietStart: string;
  quietEnd: string;
  urgency: "now" | "today" | "later";
  /** Donor opted in to urgent alerts during quiet hours (S-21). */
  urgentOverride: boolean;
};

/** PRD §5.3 step 1: daily cap and quiet hours gate every alert. */
export function alertAllowed(d: AlertDecision): boolean {
  if (d.alertsToday >= d.capPerDay) return false;
  if (isQuietHours(d.now, d.quietStart, d.quietEnd)) {
    return d.urgency === "now" && d.urgentOverride;
  }
  return true;
}

/** No-shows that still count for ranking (S-37 window, e.g. last 90 days). */
export function noShowCountWithin(noShowAt: number[], now: number, windowDays: number): number {
  const cutoff = now - windowDays * DAY_MS;
  return noShowAt.filter((t) => t >= cutoff).length;
}

/** Drop no-show timestamps outside the S-37 window (schema keeps ≤ window). */
export function pruneNoShows(noShowAt: number[], now: number, windowDays: number): number[] {
  const cutoff = now - windowDays * DAY_MS;
  return noShowAt.filter((t) => t >= cutoff);
}
