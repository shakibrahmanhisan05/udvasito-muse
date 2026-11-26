import { v } from "convex/values";
import type { Doc } from "../schemaTypes";
import { adminMutationV, adminQueryV } from "../_lib/auth";
import { fail } from "../_lib/errors";
import { getSetting } from "../_lib/settings";
import { writeAudit } from "../_lib/audit";
import { dhakaDayKey, laDayStart } from "../rules/stats";

/**
 * Usage monitor (specs §6.4, F-911, SCR-A13/A08): every free-tier
 * service with its measured usage vs its free limit where an API
 * exists — otherwise a provider-dashboard link, with manual entries
 * (setManualEntry) for the numbers only a human can read off a
 * dashboard (e.g. EAS MAU). Warnings follow S-30 (usageWarnPct /
 * usageCriticalPct). Degradation order when a limit nears
 * (roadmap §2.5): AI extras first, then images, then non-essential
 * pages — the core request path is NEVER switched off.
 *
 * Free-tier reference numbers (ADRs, researched 2026-11-23): Convex
 * free = 1M function calls/month, 0.5 GB database, 1 GB file
 * storage; Gemini Flash-Lite ≈ 500 requests/day (ai.limits), Flash
 * ≈ 20/day; EAS Update = 1,000 monthly active users; Expo Push and
 * Web Push are free and unmetered.
 */
const CONVEX_FILE_LIMIT_BYTES = 1_000_000_000;
const CONVEX_FUNCTION_LIMIT = 1_000_000;
const EAS_MAU_LIMIT = 1_000;

type RowStatus = "ok" | "warn" | "critical" | null;

export const get = adminQueryV({
  args: {},
  handler: async (ctx) => {
    const warnPct = (await getSetting(ctx, "usageWarnPct")) as number;
    const criticalPct = (await getSetting(ctx, "usageCriticalPct")) as number;
    const limits = (await getSetting(ctx, "ai.limits")) as { liteDaily: number; flashDaily: number };
    const models = (await getSetting(ctx, "ai.models")) as { lite: string; flash: string };
    const now = Date.now();
    const day = dhakaDayKey(now);

    // by_service_day is (service, day) — no day-first index exists, so
    // today's counters are gathered per known service via the index.
    const counterRows: Doc<"usageCounters">[] = [];
    for (const service of ["requests", "notifications", "convex", "vercel", "cloudinary", "eas"]) {
      const rowsForService = await ctx.db
        .query("usageCounters")
        .withIndex("by_service_day", (q) => q.eq("service", service).eq("day", day))
        .collect();
      counterRows.push(...rowsForService);
    }
    const counter = (service: string, metric: string) =>
      counterRows.find((r) => r.service === service && r.metric === metric)?.value;

    // Gemini: measured exactly from aiCalls on the LA quota day.
    const dayStart = laDayStart(now);
    const aiCalls = (await ctx.db.query("aiCalls").collect()).filter(
      (c) => c._creationTime >= dayStart && c._creationTime < dayStart + 86_400_000,
    );
    const liteCalls = models.lite ? aiCalls.filter((c) => c.model === models.lite).length : 0;
    const flashCalls = models.flash ? aiCalls.filter((c) => c.model === models.flash).length : 0;

    // Slip storage: measured from the _storage system table.
    const withSlips = await ctx.db
      .query("requests")
      .filter((q) => q.neq(q.field("slipFileId"), undefined))
      .collect();
    let slipBytes = 0;
    for (const request of withSlips) {
      if (!request.slipFileId) continue;
      const meta = await ctx.db.system.get("_storage", request.slipFileId);
      slipBytes += meta?.size ?? 0;
    }
    const eventsCount = (await ctx.db.query("events").collect()).length;

    const statusFor = (used: number | null, limit: number | null): RowStatus => {
      if (used === null || limit === null || limit <= 0) return null;
      const pct = (used / limit) * 100;
      return pct >= criticalPct ? "critical" : pct >= warnPct ? "warn" : "ok";
    };
    const row = (
      service: string,
      used: number | null,
      limit: number | null,
      unit: string,
      source: "measured" | "manual" | "dashboard",
      dashboardUrl?: string,
      note?: string,
    ) => ({
      service,
      used,
      limit,
      unit,
      pct: used !== null && limit ? Math.round((used / limit) * 1000) / 10 : null,
      status: statusFor(used, limit),
      source,
      dashboardUrl: dashboardUrl ?? null,
      note: note ?? null,
    });

    const manual = (service: string, metric: string) => counter(service, metric) ?? null;
    const rows = [
      row("gemini-lite", liteCalls, limits.liteDaily, "calls today (LA day)", "measured"),
      row("gemini-flash", flashCalls, limits.flashDaily, "calls today (LA day)", "measured"),
      row("notifications", counter("notifications", "sent") ?? 0, null, "sent today", "measured", undefined,
        "Expo Push + Web Push are free and unmetered."),
      row("requests", counter("requests", "published") ?? 0, null, "published today", "measured"),
      row("slip-storage", slipBytes, CONVEX_FILE_LIMIT_BYTES, "bytes of hospital slips", "measured"),
      row("events", eventsCount, null, "event rows (observability)", "measured"),
      row("convex-functions", manual("convex", "functionCalls"), CONVEX_FUNCTION_LIMIT,
        "function calls this month", manual("convex", "functionCalls") !== null ? "manual" : "dashboard",
        "https://dashboard.convex.dev"),
      row("vercel", manual("vercel", "bandwidthGb"), null, "bandwidth GB this month",
        manual("vercel", "bandwidthGb") !== null ? "manual" : "dashboard", "https://vercel.com/dashboard"),
      row("cloudinary", manual("cloudinary", "credits"), null, "credits this month",
        manual("cloudinary", "credits") !== null ? "manual" : "dashboard", "https://console.cloudinary.com"),
      row("eas-updates", manual("eas", "mau"), EAS_MAU_LIMIT, "monthly active users",
        manual("eas", "mau") !== null ? "manual" : "dashboard", "https://expo.dev"),
    ];
    return {
      day,
      warnPct,
      criticalPct,
      rows,
      degradationOrder: ["ai-extras", "images", "non-essential-pages"],
      corePathProtected: true,
    };
  },
});

/** Manual usage entry (SCR-A08): for numbers only a dashboard shows. */
export const setManualEntry = adminMutationV({
  args: {
    service: v.string(),
    metric: v.string(),
    value: v.number(),
  },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.value) || args.value < 0) {
      fail("ERR_VALIDATION", { value: String(args.value) });
    }
    const day = dhakaDayKey(Date.now());
    const existing = await ctx.db
      .query("usageCounters")
      .withIndex("by_service_day", (q) => q.eq("service", args.service).eq("day", day))
      .collect();
    const match = existing.find((r) => r.metric === args.metric);
    if (match) await ctx.db.patch(match._id, { value: args.value });
    else await ctx.db.insert("usageCounters", { day, service: args.service, metric: args.metric, value: args.value });
    await writeAudit(ctx, {
      actor: ctx.profile,
      action: "usage_manual_entry",
      targetType: "usageCounters",
      targetId: args.service,
      meta: { metric: args.metric, value: args.value, day },
    });
    return { day };
  },
});
