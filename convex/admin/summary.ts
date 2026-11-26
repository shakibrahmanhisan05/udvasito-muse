import { v } from "convex/values";
import {
  actionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
  type GenericQueryCtx,
} from "convex/server";
import type { DataModel } from "../schemaTypes";
import { adminQueryV, assertActive } from "../_lib/auth";
import { fail } from "../_lib/errors";
import { featureOn, getSetting } from "../_lib/settings";
import { redact } from "../rules/redaction";
import { extractContactPhone } from "../rules/redaction";
import { geminiUrl } from "../ai/gemini";

/**
 * Weekly summary (F-908, A10, switch `weeklySummary`) — aggregates
 * only, never personal data (PRD §10: "Numbers only" in, plain
 * language out). `current` returns this week vs last week counts.
 * `narrate` turns those numbers into a short paragraph: a
 * deterministic template by default; Gemini may rephrase it only
 * when the `summary` AI feature is on, a key exists and quota
 * remains — the prompt contains the aggregates JSON and nothing
 * else, and any output carrying a phone-like number is rejected.
 */

const DAY = 86_400_000;
const WEEK = 7 * DAY;

type Aggregates = {
  requestsCreated: number;
  requestsCreatedPrev: number;
  requestsClosed: number;
  requestsClosedPrev: number;
  donationsConfirmed: number;
  donationsConfirmedPrev: number;
  newDonors: number;
  newDonorsPrev: number;
  newMembers: number;
  newMembersPrev: number;
  liveDonorsNow: number;
  openRequestsNow: number;
};

async function computeAggregates(
  ctx: GenericQueryCtx<DataModel>,
  now: number,
): Promise<Aggregates> {
  const db = ctx.db;
  const inWindow = (t: number, start: number, end: number) => t >= start && t < end;
  const thisStart = now - WEEK;
  const prevStart = now - 2 * WEEK;

  const requests = (await db.query("requests").collect()).filter((r) => !r.isDemo);
  const responses = (await db.query("responses").collect()).filter((r) => !r.isDemo);
  const donors = (await db.query("donorProfiles").collect()).filter((d) => !d.isDemo);
  const profiles = (await db.query("profiles").collect()).filter((p) => !p.isDemo);

  const donatedAt = (r: (typeof responses)[number]) =>
    r.outcomeDonor === "donated" ? (r.outcomeDonorAt ?? r._creationTime) : null;

  return {
    requestsCreated: requests.filter((r) => inWindow(r._creationTime, thisStart, now)).length,
    requestsCreatedPrev: requests.filter((r) => inWindow(r._creationTime, prevStart, thisStart)).length,
    requestsClosed: requests.filter(
      (r) => r.closedAt !== undefined && inWindow(r.closedAt, thisStart, now),
    ).length,
    requestsClosedPrev: requests.filter(
      (r) => r.closedAt !== undefined && inWindow(r.closedAt, prevStart, thisStart),
    ).length,
    donationsConfirmed: responses.filter((r) => {
      const at = donatedAt(r);
      return at !== null && inWindow(at, thisStart, now);
    }).length,
    donationsConfirmedPrev: responses.filter((r) => {
      const at = donatedAt(r);
      return at !== null && inWindow(at, prevStart, thisStart);
    }).length,
    newDonors: donors.filter((d) => inWindow(d._creationTime, thisStart, now)).length,
    newDonorsPrev: donors.filter((d) => inWindow(d._creationTime, prevStart, thisStart)).length,
    newMembers: profiles.filter((p) => inWindow(p._creationTime, thisStart, now)).length,
    newMembersPrev: profiles.filter((p) => inWindow(p._creationTime, prevStart, thisStart)).length,
    liveDonorsNow: donors.filter((d) => d.live).length,
    openRequestsNow: requests.filter((r) => r.status === "live" || r.status === "covered").length,
  };
}

/** The deterministic paragraph — always available, AI or not. */
export function summaryParagraph(a: Aggregates): string {
  const trend = (now: number, prev: number) =>
    now === prev ? "the same as" : now > prev ? "up from" : "down from";
  return (
    `This week: ${a.requestsCreated} new requests (${trend(a.requestsCreated, a.requestsCreatedPrev)} ${a.requestsCreatedPrev} last week), ` +
    `${a.donationsConfirmed} confirmed donations (${trend(a.donationsConfirmed, a.donationsConfirmedPrev)} ${a.donationsConfirmedPrev}), ` +
    `${a.requestsClosed} requests closed. ${a.newDonors} new donors and ${a.newMembers} new members joined. ` +
    `Right now: ${a.liveDonorsNow} live donors and ${a.openRequestsNow} open requests.`
  );
}

export const current = adminQueryV({
  args: {},
  handler: async (ctx) => {
    if (!(await featureOn(ctx, "weeklySummary"))) return null;
    const aggregates = await computeAggregates(ctx, Date.now());
    return { aggregates, paragraph: summaryParagraph(aggregates) };
  },
});

function losAngelesDay(now: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(new Date(now));
}

export const guard = internalQueryGeneric({
  args: { subject: v.string() },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", args.subject))
      .unique();
    if (!profile) fail("ERR_UNAUTHENTICATED");
    assertActive(profile!);
    if (profile!.role !== "admin" && profile!.role !== "superadmin") {
      fail("ERR_FORBIDDEN");
    }
    if (!(await featureOn(ctx, "weeklySummary"))) fail("ERR_VALIDATION", {}, "feature");
    const aggregates = await computeAggregates(ctx, Date.now());
    const [aiFeatures, aiModels, aiLimits] = await Promise.all([
      getSetting<Record<string, boolean>>(ctx, "ai.features"),
      getSetting<{ lite: string; flash: string }>(ctx, "ai.models"),
      getSetting<{ liteDaily: number }>(ctx, "ai.limits"),
    ]);
    const model = aiModels.lite;
    const day = losAngelesDay(Date.now());
    const quotaRows = await ctx.db
      .query("aiQuota")
      .withIndex("by_day_model", (q) => q.eq("day", day))
      .collect();
    const quotaRow = quotaRows.find((row) => row.model === model);
    return {
      profileId: profile!._id,
      isDemo: profile!.isDemo,
      aggregates,
      paragraph: summaryParagraph(aggregates),
      aiSummaryOn: aiFeatures.summary === true,
      model,
      liteDaily: aiLimits.liteDaily,
      day,
      quotaUsed: quotaRow?.count ?? 0,
    };
  },
});

export const record = internalMutationGeneric({
  args: {
    profileId: v.id("profiles"),
    isDemo: v.boolean(),
    ai: v.object({
      model: v.string(),
      ok: v.boolean(),
      errorKind: v.optional(v.string()),
      inputRedacted: v.string(),
      output: v.string(),
      latencyMs: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("aiCalls", {
      feature: "summary",
      model: args.ai.model,
      ok: args.ai.ok,
      errorKind: args.ai.errorKind,
      inputRedacted: args.ai.inputRedacted,
      output: args.ai.output,
      latencyMs: args.ai.latencyMs,
      profileId: args.profileId,
      isDemo: args.isDemo,
    });
    return null;
  },
});

const guardRef = makeFunctionReference<"query">("admin/summary:guard");
const recordRef = makeFunctionReference<"mutation">("admin/summary:record");
const reserveRef = makeFunctionReference<"mutation">("intake:reserveQuota");

export const narrate = actionGeneric({
  args: {},
  handler: async (ctx): Promise<{ paragraph: string; aiUsed: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) fail("ERR_UNAUTHENTICATED");
    const g = (await ctx.runQuery(guardRef, { subject: identity!.subject })) as {
      profileId: string;
      isDemo: boolean;
      aggregates: Aggregates;
      paragraph: string;
      aiSummaryOn: boolean;
      model: string;
      liteDaily: number;
      day: string;
      quotaUsed: number;
    };
    let paragraph = g.paragraph;
    let aiUsed = false;
    const apiKey = process.env.GEMINI_API_KEY;
    if (g.aiSummaryOn && g.model && apiKey && g.quotaUsed < g.liteDaily) {
      const reserved = await ctx.runMutation(reserveRef, {
        day: g.day,
        model: g.model,
        limit: g.liteDaily,
      });
      if (reserved) {
        const input = redact(JSON.stringify(g.aggregates)).text;
        const started = Date.now();
        let ok = false;
        let errorKind: string | undefined;
        let output = "";
        try {
          const res = await fetch(geminiUrl(g.model, apiKey), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: {
                parts: [
                  {
                    text: "Rewrite the weekly statistics JSON as one short, warm paragraph for the admin team. Use only the numbers given. Never invent numbers, names or places.",
                  },
                ],
              },
              contents: [{ parts: [{ text: input }] }],
              generation_config: { temperature: 0.3 },
            }),
          });
          if (!res.ok) {
            errorKind = `http_${res.status}`;
          } else {
            const body = (await res.json()) as {
              candidates?: { content?: { parts?: { text?: string }[] } }[];
            };
            output = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
            if (output.trim().length >= 40 && extractContactPhone(output) === null) {
              paragraph = output.trim();
              aiUsed = true;
              ok = true;
            } else {
              errorKind = "rejected_output";
            }
          }
        } catch {
          errorKind = "network";
        }
        await ctx.runMutation(recordRef, {
          profileId: g.profileId as never,
          isDemo: g.isDemo,
          ai: {
            model: g.model,
            ok,
            errorKind,
            inputRedacted: input,
            output,
            latencyMs: Date.now() - started,
          },
        });
      }
    }
    return { paragraph, aiUsed };
  },
});
