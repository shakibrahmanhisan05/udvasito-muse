import { cronJobs } from "convex/server";

/**
 * Scheduled jobs (specs §6.6, ADR-009). Registered phase by phase — a cron is
 * only added when the internal function it calls exists and is tested:
 * - P1: none (waves are scheduled per-request with ctx.scheduler)
 * - P2: lifecycle.autoClose, lifecycle.confirmationPrompt sweep,
 *       availability resume (hourly)
 * - P3: retention/deletion completion (daily)
 * - P5: stats snapshots (every 5 min), usage counters (daily)
 */
const crons = cronJobs();

export default crons;
