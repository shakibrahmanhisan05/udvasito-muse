import {
  actionGeneric,
  internalMutationGeneric,
  makeFunctionReference,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";
import { fail } from "./_lib/errors";
import { assertActive } from "./_lib/auth";
import { featureOn, getSetting } from "./_lib/settings";
import { recordEvent } from "./_lib/events";
import { eqRange } from "./_lib/db";
import { redact } from "./rules/redaction";
import { geminiUrl } from "./ai/gemini";
import {
  bestFaqMatch,
  looksPersonalMedical,
  type FaqCandidate,
} from "./rules/faqMatch";

/**
 * F-604 "Can I donate?" assistant (specs §6.4, SCR-M08) — behind
 * features.assistant. Strictly FAQ-bound:
 *  - answers are ALWAYS an approved faqEntries row's own text;
 *  - the question is redacted before anything else touches it;
 *  - deterministic token matching answers first; the optional AI
 *    step (ai.features.assistant) may only pick an entry id from the
 *    approved list — its output is validated against that list and
 *    the returned answer is still the entry's text;
 *  - personal-health questions with no confident FAQ answer deflect
 *    to mode "doctor" (ask a doctor / the blood bank);
 *  - S-29: at most assistantQuestionsPerDay questions per member per
 *    Dhaka day, then mode "limit".
 * With no approved entries (the FAQ is still draft pending medical
 * review), every question honestly lands on "nomatch".
 */

function dhakaDayStart(now: number): number {
  const dhakaDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
  }).format(new Date(now));
  return Date.parse(`${dhakaDate}T00:00:00+06:00`);
}

function losAngelesDay(now: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(new Date(now));
}

type ApprovedEntry = FaqCandidate & { answerEn: string; answerBn: string };

type GuardResult = {
  profileId: import("./schemaTypes").Id<"profiles">;
  isDemo: boolean;
  entries: ApprovedEntry[];
  perDay: number;
  askedToday: number;
  aiAssistantOn: boolean;
  model: string;
  liteDaily: number;
  day: string;
  quotaUsed: number;
};

async function approvedEntries(ctx: {
  db: import("convex/server").GenericDatabaseReader<import("./schemaTypes").DataModel>;
}): Promise<ApprovedEntry[]> {
  const rows = await ctx.db
    .query("faqEntries")
    .withIndex("by_status", (q) => q.eq("status", "approved"))
    .collect();
  return rows.map((r) => ({
    id: r._id as string,
    questionEn: r.questionEn,
    questionBn: r.questionBn,
    answerEn: r.answerEn,
    answerBn: r.answerBn,
    tags: r.tags,
  }));
}

/** assistant.faqList (specs §6.4) — public; approved entries only. */
export const faqList = queryGeneric({
  args: {
    lang: v.union(v.literal("en"), v.literal("bn")),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!(await featureOn(ctx, "assistant"))) return [];
    const entries = await approvedEntries(ctx);
    const needle = args.search?.trim().toLowerCase();
    return entries
      .filter(
        (e) =>
          !needle ||
          e.questionEn.toLowerCase().includes(needle) ||
          e.questionBn.toLowerCase().includes(needle),
      )
      .map((e) => ({
        id: e.id,
        question: args.lang === "bn" ? e.questionBn : e.questionEn,
        answer: args.lang === "bn" ? e.answerBn : e.answerEn,
        tags: e.tags,
      }));
  },
});

export const guard = internalMutationGeneric({
  args: { subject: v.string() },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", args.subject))
      .unique();
    if (!profile) fail("ERR_UNAUTHENTICATED");
    assertActive(profile!);
    if (!(await featureOn(ctx, "assistant"))) {
      fail("ERR_VALIDATION", {}, "feature");
    }
    const [perDay, aiFeatures, aiModels, aiLimits] = await Promise.all([
      getSetting<number>(ctx, "assistantQuestionsPerDay"),
      getSetting<Record<string, boolean>>(ctx, "ai.features"),
      getSetting<{ lite: string; flash: string }>(ctx, "ai.models"),
      getSetting<{ liteDaily: number; liteRpm: number; flashDaily: number }>(ctx, "ai.limits"),
    ]);
    const dayStart = dhakaDayStart(Date.now());
    const todays = await ctx.db
      .query("events")
      .withIndex("by_name", (q) => q.eq("name", "assistant_asked"))
      .collect();
    const askedToday = todays.filter(
      (e) =>
        e._creationTime >= dayStart &&
        (e.props as { profileId?: string } | undefined)?.profileId ===
          (profile!._id as string),
    ).length;
    const model = aiModels.lite;
    const day = losAngelesDay(Date.now());
    const quotaRow = await ctx.db
      .query("aiQuota")
      .withIndex("by_day_model", eqRange([["day", day], ["model", model]]))
      .unique();
    return {
      profileId: profile!._id,
      isDemo: profile!.isDemo,
      entries: await approvedEntries(ctx),
      perDay,
      askedToday,
      aiAssistantOn: aiFeatures.assistant === true,
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
    mode: v.string(),
    ai: v.optional(
      v.object({
        model: v.string(),
        ok: v.boolean(),
        errorKind: v.optional(v.string()),
        inputRedacted: v.string(),
        output: v.string(),
        latencyMs: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    if (args.ai) {
      await ctx.db.insert("aiCalls", {
        feature: "assistant",
        model: args.ai.model,
        ok: args.ai.ok,
        errorKind: args.ai.errorKind,
        inputRedacted: args.ai.inputRedacted,
        output: args.ai.output,
        latencyMs: args.ai.latencyMs,
        profileId: args.profileId,
        isDemo: args.isDemo,
      });
    }
    await recordEvent(ctx, "assistant_asked", {
      actorRole: "member",
      props: { profileId: args.profileId, mode: args.mode },
      isDemo: args.isDemo,
    });
    return null;
  },
});

const guardRef = makeFunctionReference<"mutation">("assistant:guard");
const recordRef = makeFunctionReference<"mutation">("assistant:record");
const reserveRef = makeFunctionReference<"mutation">("intake:reserveQuota");

const ASSISTANT_PICK_PROMPT =
  "You match a user's question to a reviewed FAQ list. Reply with JSON only: " +
  '{"faqId": "<id of the single best-matching FAQ entry>"} or {"faqId": null} ' +
  "when none of the entries answers the question. Never invent an id.";

/** assistant.ask (specs §6.4) — member; AI problems never throw. */
export const ask = actionGeneric({
  args: {
    question: v.string(),
    lang: v.union(v.literal("en"), v.literal("bn")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) fail("ERR_UNAUTHENTICATED");
    const question = args.question.trim();
    if (question.length < 3 || question.length > 300) {
      fail("ERR_VALIDATION", {}, "question"); // VAL-21
    }
    const g = (await ctx.runMutation(guardRef, {
      subject: identity!.subject,
    })) as GuardResult;

    if (g.askedToday >= g.perDay) {
      return { mode: "limit" as const, limit: g.perDay };
    }

    const redacted = redact(question).text;
    const finish = async (
      mode: "faq" | "doctor" | "nomatch",
      entry?: ApprovedEntry,
      ai?: {
        model: string;
        ok: boolean;
        errorKind?: string;
        inputRedacted: string;
        output: string;
        latencyMs: number;
      },
    ) => {
      await ctx.runMutation(recordRef, {
        profileId: g.profileId,
        isDemo: g.isDemo,
        mode,
        ai,
      });
      if (entry) {
        return {
          mode,
          answer: args.lang === "bn" ? entry.answerBn : entry.answerEn,
          faqId: entry.id,
        };
      }
      return { mode };
    };

    // 1) Deterministic match over approved entries.
    const match = bestFaqMatch(redacted, g.entries);
    if (match) {
      const entry = g.entries.find((e) => e.id === match.id)!;
      return await finish("faq", entry);
    }

    // 2) Personal health with no confident FAQ answer → doctor.
    if (looksPersonalMedical(redacted)) {
      return await finish("doctor");
    }

    // 3) Optional AI pick — an entry id only, validated against the
    // approved list; the answer text is always the entry's own.
    const apiKey = process.env.GEMINI_API_KEY;
    if (
      g.aiAssistantOn &&
      g.model &&
      apiKey &&
      g.entries.length > 0 &&
      g.quotaUsed < g.liteDaily
    ) {
      const reserved = await ctx.runMutation(reserveRef, {
        day: g.day,
        model: g.model,
        limit: g.liteDaily,
      });
      if (reserved) {
        const candidates = g.entries
          .map((e) => `${e.id} :: ${e.questionEn} | ${e.questionBn}`)
          .join("\n");
        const started = Date.now();
        let ok = false;
        let errorKind: string | undefined;
        let output = "";
        let picked: ApprovedEntry | undefined;
        try {
          const res = await fetch(geminiUrl(g.model, apiKey), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: ASSISTANT_PICK_PROMPT }] },
              contents: [
                { parts: [{ text: `FAQ entries:\n${candidates}\n\nQuestion: ${redacted}` }] },
              ],
              generation_config: {
                temperature: 0,
                response_mime_type: "application/json",
              },
            }),
          });
          if (!res.ok) {
            errorKind = `http_${res.status}`;
          } else {
            const body = (await res.json()) as {
              candidates?: { content?: { parts?: { text?: string }[] } }[];
            };
            output = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
            const parsed = JSON.parse(output) as { faqId?: string | null };
            if (parsed.faqId) {
              picked = g.entries.find((e) => e.id === parsed.faqId);
              if (!picked) errorKind = "unknown_faq_id";
              else ok = true;
            } else {
              ok = true; // an honest "none" from the picker
            }
          }
        } catch {
          errorKind = "fetch_failed";
        }
        const aiLog = {
          model: g.model,
          ok,
          errorKind,
          inputRedacted: redacted,
          output,
          latencyMs: Date.now() - started,
        };
        if (picked) return await finish("faq", picked, aiLog);
        return await finish("nomatch", undefined, aiLog);
      }
    }

    // 4) Honest no-match (also the state while the FAQ is all draft).
    return await finish("nomatch");
  },
});
