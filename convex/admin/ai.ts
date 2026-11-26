import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { adminMutationV, adminQueryV } from "../_lib/auth";
import { fail } from "../_lib/errors";
import { getSetting } from "../_lib/settings";
import { writeAudit } from "../_lib/audit";
import { laDayStart } from "../rules/stats";

/**
 * AI controls & log (specs §6.4, F-902, SCR-A07). The per-feature
 * switches write the SAME `ai.features` settings object the P4
 * fallback logic reads (intake.ts / gemini.ts), so turning a feature
 * off here degrades it to the rules-only path immediately — no
 * deploy. Usage is counted against the LA quota day (Google resets
 * at midnight Pacific, §2.5) from the aiCalls table P4 writes; the
 * log shows the REDACTED inputs and outputs exactly as stored
 * (retention S-36 enforced by the daily cron). Practice and real
 * calls share one quota, so usage counts BOTH and the log shows
 * both (each row badged isDemo) — an admin investigating quota burn
 * must see practice calls too. The log contains no phone numbers by
 * construction (redaction happens before the call, §5.6).
 */
const FEATURES = ["intake", "duplicate", "assistant", "appeal", "summary"] as const;
const PREVIEW_CHARS = 200;
const MAX_SCAN = 1000;

export const status = adminQueryV({
  args: {},
  handler: async (ctx) => {
    const features = (await getSetting(ctx, "ai.features")) as Record<string, boolean>;
    const models = (await getSetting(ctx, "ai.models")) as { lite: string; flash: string };
    const limits = (await getSetting(ctx, "ai.limits")) as {
      liteDaily: number;
      liteRpm: number;
      flashDaily: number;
    };
    const now = Date.now();
    const dayStart = laDayStart(now);
    // aiCalls has no creation index; the table is quota-capped daily,
    // so a bounded collect + range filter is exact and cheap.
    const calls = (await ctx.db.query("aiCalls").collect()).filter(
      (c) => c._creationTime >= dayStart && c._creationTime < dayStart + 86_400_000,
    );

    const perFeature = FEATURES.map((feature) => {
      const mine = calls.filter((c) => c.feature === feature);
      const failures = mine.filter((c) => !c.ok);
      const lastFailure = failures.sort((a, b) => b._creationTime - a._creationTime)[0];
      return {
        feature,
        enabled: features[feature] !== false,
        callsToday: mine.length,
        failuresToday: failures.length,
        lastError: lastFailure?.errorKind ?? null,
      };
    });
    const liteCalls = models.lite ? calls.filter((c) => c.model === models.lite).length : 0;
    const flashCalls = models.flash ? calls.filter((c) => c.model === models.flash).length : 0;
    const litePct = limits.liteDaily > 0 ? (liteCalls / limits.liteDaily) * 100 : 0;
    return {
      features: perFeature,
      models,
      unconfigured: models.lite === "" && models.flash === "",
      usage: {
        lite: { calls: liteCalls, limit: limits.liteDaily, pct: litePct },
        flash: { calls: flashCalls, limit: limits.flashDaily, pct: limits.flashDaily > 0 ? (flashCalls / limits.flashDaily) * 100 : 0 },
        rpmLimit: limits.liteRpm,
      },
      // PRD §6.3: at 80% of the Lite daily quota the optional Flash
      // step is skipped — surfaced here so admins see it coming.
      fallback80Active: litePct >= 80,
      retentionDays: await getSetting(ctx, "aiLogRetentionDays"),
    };
  },
});

export const setFeature = adminMutationV({
  args: { feature: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    if (!(FEATURES as readonly string[]).includes(args.feature)) {
      fail("ERR_VALIDATION", { feature: args.feature });
    }
    const current = (await getSetting(ctx, "ai.features")) as Record<string, boolean>;
    const next = { ...current, [args.feature]: args.enabled };
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "ai.features"))
      .unique();
    if (row) await ctx.db.patch(row._id, { value: next });
    else await ctx.db.insert("settings", { key: "ai.features", value: next });
    await writeAudit(ctx, {
      actor: ctx.profile,
      action: "ai_feature_changed",
      targetType: "settings",
      targetId: "ai.features",
      meta: { feature: args.feature, enabled: args.enabled },
    });
    return { features: next };
  },
});

export const log = adminQueryV({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("aiCalls").order("desc").take(MAX_SCAN);
    const all = rows.map((row) => ({
      aiCallId: row._id,
      createdAt: row._creationTime,
      feature: row.feature,
      model: row.model,
      ok: row.ok,
      error: row.errorKind ?? null,
      isDemo: row.isDemo,
      inputPreview: row.inputRedacted.slice(0, PREVIEW_CHARS),
      outputPreview: row.output ? row.output.slice(0, PREVIEW_CHARS) : null,
    }));
    const offset = args.paginationOpts.cursor ? Number(args.paginationOpts.cursor) || 0 : 0;
    const page = all.slice(offset, offset + args.paginationOpts.numItems);
    const nextOffset = offset + page.length;
    return { page, isDone: nextOffset >= all.length, continueCursor: String(nextOffset) };
  },
});
