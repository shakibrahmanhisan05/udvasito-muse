import { cronJobs, makeFunctionReference } from "convex/server";

/**
 * Scheduled jobs (specs §6.6, ADR-009). Registered phase by phase — a cron
 * is only added when the internal function it calls exists and is tested:
 * - P1: none (waves are scheduled per-request with ctx.scheduler)
 * - P2: lifecycle.autoClose, lifecycle.confirmationPrompt sweep,
 *       availability resume (hourly)
 * - P3: retention/deletion completion (daily)
 * - P5: stats snapshots (every 5 min), usage counters (daily)
 */
const crons = cronJobs();

// Hourly (specs §6.6): end pauses (→ available + NTF-13), end suspensions
// whose time is up, expire stale phone verifications.
crons.hourly(
  "lifecycle-hourly-sweep",
  { minuteUTC: 0 },
  makeFunctionReference<"mutation">("lifecycle:hourlySweep"),
  {},
);

// P5 (F-901): stats snapshots every 5 minutes (specs §6.6) — the admin
// dashboard and GET /public/stats read only these rows.
crons.interval(
  "stats-snapshots",
  { minutes: 5 },
  makeFunctionReference<"mutation">("stats:computeSnapshots"),
  {},
);

// P3 (F-603): the daily retention job — account deletions per PRD §5.9,
// S-35 personal-field purge, S-26 slip deletion, S-36 AI log retention,
// event rollups. 03:00 Asia/Dhaka = 21:00 UTC.
crons.daily(
  "retention-daily",
  { hourUTC: 21, minuteUTC: 0 },
  makeFunctionReference<"mutation">("retention:daily"),
  {},
);

export default crons;
