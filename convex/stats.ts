import {
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
  type GenericMutationCtx,
} from "convex/server";
import type { DataModel } from "./schemaTypes";
import { adminMutationV, adminQueryV } from "./_lib/auth";
import { getSetting } from "./_lib/settings";
import {
  bloodPool,
  coverageByHour,
  dhakaDayKey,
  dutyIntervals,
  funnelFromRows,
  laDayKey,
  registrationsByDay,
  speedFromRows,
} from "./rules/stats";

/**
 * Stats snapshots (specs §6.6, ADR-002, F-901): computed every 5 min by
 * cron into `statsSnapshots` — the dashboard (SCR-A01) and
 * GET /public/stats read ONLY these rows, never live scans. Every
 * number is computed from source data by convex/rules/stats.ts (PRD
 * §2.2 definitions) and practice data is ALWAYS excluded here: this
 * module loads isDemo=false rows only. The practice funnel lives in
 * admin/demo.ts, computed from isDemo=true rows, labelled "Practice".
 */

const DAY_MS = 86_400_000;
type MCtx = GenericMutationCtx<DataModel>;

async function upsertSnapshot(
  ctx: MCtx,
  key: "public" | "admin",
  data: unknown,
  now: number,
) {
  const existing = await ctx.db
    .query("statsSnapshots")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (existing) await ctx.db.patch(existing._id, { data, computedAt: now });
  else await ctx.db.insert("statsSnapshots", { key, data, computedAt: now });
}

async function upsertUsageCounter(
  ctx: MCtx,
  day: string,
  service: string,
  metric: string,
  value: number,
) {
  const rows = await ctx.db
    .query("usageCounters")
    .withIndex("by_service_day", (q) => q.eq("service", service).eq("day", day))
    .collect();
  const row = rows.find((r) => r.metric === metric);
  if (row) await ctx.db.patch(row._id, { value });
  else await ctx.db.insert("usageCounters", { day, service, metric, value });
}

/** internal.stats.computeSnapshots — the 5-minute cron (specs §6.6). */
export const computeSnapshots = internalMutationGeneric({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const [profiles, donors, volunteers, requests, responses, reveals, events, moderation, notifications, aiCalls] =
      await Promise.all([
        ctx.db.query("profiles").collect(),
        ctx.db.query("donorProfiles").collect(),
        ctx.db.query("volunteerProfiles").collect(),
        ctx.db.query("requests").collect(),
        ctx.db.query("responses").collect(),
        ctx.db.query("contactReveals").collect(),
        ctx.db.query("events").collect(),
        ctx.db.query("moderationItems").collect(),
        ctx.db.query("notifications").collect(),
        ctx.db.query("aiCalls").collect(),
      ]);
    const realProfiles = profiles.filter((p) => !p.isDemo);
    const realDonors = donors.filter((d) => !d.isDemo);
    const realVolunteers = volunteers.filter((vp) => !vp.isDemo);
    const realRequests = requests.filter((r) => !r.isDemo);
    const realResponses = responses.filter((r) => !r.isDemo);
    const realReveals = reveals.filter((r) => !r.isDemo);
    const profileById = new Map(realProfiles.map((p) => [p._id, p]));

    // ── Public snapshot (specs §6.5) ──
    const pool = bloodPool(realDonors, now);
    const funnelAll = funnelFromRows(
      realRequests.map((r) => ({ id: r._id as string })),
      realResponses,
      new Set(realReveals.map((r) => r.requestId as string).filter(Boolean)),
    );
    const publicData = {
      donorsByGroup: Object.fromEntries(
        Object.entries(pool.byGroup).map(([g, v]) => [g, v.live]),
      ),
      donorsLive: pool.donorsLive,
      requestsHelped: realRequests.filter(
        (r) => r.status === "closed" && r.closeReason === "fulfilled",
      ).length,
      donationsConfirmed: funnelAll.donationsConfirmedRequests,
      updatedAt: now,
    };

    // ── Admin snapshot (SCR-A01) ──
    const freshnessDays = await getSetting<number>(ctx, "availabilityNudgeDays");
    const pilotDistrictIds = await getSetting<string[]>(ctx, "pilotDistrictIds");
    const activeDonorRows = realDonors.filter(
      (d) => profileById.get(d.profileId)?.status === "active",
    );
    const freshDonors = activeDonorRows.filter(
      (d) => d.availabilityConfirmedAt >= now - freshnessDays * DAY_MS,
    );
    const campaignCounts = new Map<string, number>();
    for (const p of realProfiles) {
      if (p.campaignCode) {
        campaignCounts.set(p.campaignCode, (campaignCounts.get(p.campaignCode) ?? 0) + 1);
      }
    }
    const onDutyNow = new Map<string, number | null>();
    for (const vp of realVolunteers) {
      if (vp.status === "approved" && vp.onDuty) {
        onDutyNow.set(vp._id as string, vp.onDutySince ?? null);
      }
    }
    const dutyEvents = events
      .filter((e) => e.name === "volunteer_duty_changed" && !e.isDemo)
      .map((e) => ({
        vpId: (e.props as { vpId?: string } | undefined)?.vpId,
        onDuty: Boolean((e.props as { onDuty?: boolean } | undefined)?.onDuty),
        at: e._creationTime,
      }));
    const coverage = coverageByHour(dutyIntervals(dutyEvents, onDutyNow, now), now, 7);

    const aiLimits = await getSetting<{ liteDaily: number; flashDaily: number }>(ctx, "ai.limits");
    const aiModels = await getSetting<{ lite: string; flash: string }>(ctx, "ai.models");
    const aiFeatures = await getSetting<Record<string, boolean>>(ctx, "ai.features");
    const quotaRows = await ctx.db.query("aiQuota").collect();
    const todayQuota = quotaRows.filter((q) => q.day === laDayKey(now));
    const aiCallsToday = todayQuota.reduce((sum, q) => sum + q.count, 0);
    const liteCallsToday = aiModels.lite
      ? todayQuota.filter((q) => q.model === aiModels.lite).reduce((s, q) => s + q.count, 0)
      : 0;
    const litePct = aiLimits.liteDaily > 0 ? (liteCallsToday / aiLimits.liteDaily) * 100 : 0;

    const speedRows = realRequests.map((r) => ({
      id: r._id as string,
      createdAt: r._creationTime,
      urgency: r.urgency,
      districtId: r.districtId as string,
    }));
    const adminData = {
      liveNow: {
        openRequests: realRequests.filter((r) => r.status === "live").length,
        coveredRequests: realRequests.filter((r) => r.status === "covered").length,
        waitingOver15Min: realRequests.filter(
          (r) => r.status === "live" && r.unitsConfirmed === 0 && r._creationTime < now - 15 * 60_000,
        ).length,
        volunteersOnDuty: onDutyNow.size,
      },
      bloodPool: pool.byGroup,
      donorsLive: pool.donorsLive,
      speed: {
        last7Days: speedFromRows(speedRows, realResponses, now - 7 * DAY_MS, pilotDistrictIds),
        last30Days: speedFromRows(speedRows, realResponses, now - 30 * DAY_MS, pilotDistrictIds),
      },
      funnel: funnelAll,
      participation: {
        donorsLive: pool.donorsLive,
        registrationsByDay: registrationsByDay(realDonors.map((d) => d._creationTime), now, 30),
        newDonors30Days: realDonors.filter((d) => d._creationTime >= now - 30 * DAY_MS).length,
        campaignSignups: [...campaignCounts.entries()]
          .map(([code, count]) => ({ code, count }))
          .sort((a, b) => b.count - a.count),
        availabilityFreshnessPct:
          activeDonorRows.length > 0 ? (freshDonors.length / activeDonorRows.length) * 100 : null,
      },
      volunteerCoverage: coverage,
      alerts: {
        openModerationItems: moderation.filter((m) => !m.isDemo && m.status === "open").length,
        ai: {
          enabledFeatures: Object.entries(aiFeatures).filter(([, on]) => on).map(([name]) => name),
          callsToday: aiCallsToday,
          liteCallsToday,
          liteDailyLimit: aiLimits.liteDaily,
          liteUsagePct: litePct,
          // PRD §6.3: at 80% the assistant/appeal fall back automatically.
          fallback80Active: litePct >= 80,
        },
      },
      updatedAt: now,
    };

    await upsertSnapshot(ctx, "public", publicData, now);
    await upsertSnapshot(ctx, "admin", adminData, now);

    // Daily usage counters (F-911 source rows), refreshed in the same
    // pass: today's Dhaka-day activity, upserted by (day, service, metric).
    const today = dhakaDayKey(now);
    await upsertUsageCounter(ctx, today, "requests", "published",
      realRequests.filter((r) => dhakaDayKey(r._creationTime) === today).length);
    await upsertUsageCounter(ctx, today, "notifications", "sent",
      notifications.filter((n) => !n.isDemo && n.status === "sent" && dhakaDayKey(n._creationTime) === today).length);
    await upsertUsageCounter(ctx, today, "ai", "calls",
      aiCalls.filter((c) => !c.isDemo && dhakaDayKey(c._creationTime) === today).length);
    return { computedAt: now };
  },
});

/** internal.stats.getPublicSnapshot — read by GET /public/stats. */
export const getPublicSnapshot = internalQueryGeneric({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("statsSnapshots")
      .withIndex("by_key", (q) => q.eq("key", "public"))
      .unique();
    return row ? { data: row.data, computedAt: row.computedAt } : null;
  },
});

/** admin.dashboard (specs §6.4, SCR-A01): the admin snapshot, or null
 *  while the first computation has not run yet. */
export const dashboard = adminQueryV({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("statsSnapshots")
      .withIndex("by_key", (q) => q.eq("key", "admin"))
      .unique();
    if (!row) return null;
    return { data: row.data as Record<string, unknown>, computedAt: row.computedAt };
  },
});

/** admin.recomputeStats (specs §6.4): schedule a fresh computation. */
export const recomputeStats = adminMutationV({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(
      0,
      makeFunctionReference<"mutation">("stats:computeSnapshots"),
      {},
    );
    return null;
  },
});
