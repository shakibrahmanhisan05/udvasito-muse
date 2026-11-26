import {
  actionGeneric,
  internalMutationGeneric,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel } from "./schemaTypes";
import { fail } from "./_lib/errors";
import { assertActive, memberQueryV } from "./_lib/auth";
import { getSetting } from "./_lib/settings";
import { limitOrThrow } from "./_lib/ratelimit";
import { recordEvent } from "./_lib/events";
import { eqRange } from "./_lib/db";
import {
  hospitalCandidates,
  parseIntake,
  type IntakeFields,
  type IntakeRefData,
} from "./rules/intakeParser";
import { extractContactPhone, redact } from "./rules/redaction";
import {
  buildIntakePayload,
  geminiUrl,
  mergeAiFields,
  missingRequired,
  parseGeminiResponse,
} from "./ai/gemini";

/**
 * Intake (specs §6.1/§6.2, F-206/F-902/F-1103, PRD §6.2/§6.3).
 *
 * Flow of intake.parse: VAL-13 → guard (auth, G6 active gate, 10/h rate
 * limit) → contact phone extracted by REGEX from the original text →
 * rules parser → only if a required field is still missing AND the
 * feature switch is on AND the daily quota (aiQuota, PRD §6.3) and the
 * per-request cap (S-29) allow it: the REDACTED text goes to Gemini
 * Flash-Lite, its JSON is validated and merged into the gaps only.
 * AI problems are NEVER thrown — they come back as aiError and the
 * rules result still stands, with the user's text kept by the client.
 */

type AnyCtx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>;

/** Reference data for the parser, from the caller's own partition. */
async function buildRefData(ctx: AnyCtx, isDemo: boolean): Promise<IntakeRefData> {
  const rows = await ctx.db
    .query("hospitals")
    .withIndex("by_district", eqRange([["isDemo", isDemo], ["active", true]]))
    .collect();
  const hospitals: IntakeRefData["hospitals"] = [];
  const districtIds = new Set<string>();
  for (const row of rows) {
    districtIds.add(String(row.districtId));
    const upazila = await ctx.db.get(row.upazilaId);
    hospitals.push({
      _id: String(row._id),
      nameEn: row.nameEn,
      nameBn: row.nameBn,
      aliases: row.aliases,
      area: upazila?.isMetroThana ? upazila.nameEn : undefined,
    });
  }
  const upazilas = await ctx.db
    .query("places")
    .withIndex("by_level_parent", (q) => q.eq("level", "upazila"))
    .collect();
  const areas = upazilas
    .filter((p) => p.parentId !== undefined && districtIds.has(String(p.parentId)))
    .map((p) => ({ nameEn: p.nameEn, nameBn: p.nameBn }));
  return { hospitals, areas };
}

/** intake.refData (specs §6.2) — what the on-device rules parser needs. */
export const refData = memberQueryV({
  args: {},
  handler: async (ctx) => {
    return await buildRefData(ctx, ctx.profile.isDemo);
  },
});

function losAngelesDay(now: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(new Date(now));
}

function dhakaToday(now: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
  }).format(new Date(now));
}

/**
 * internal.intake.guard — the action's server-side gatekeeper: profile +
 * G6 + rate limit + everything the pure part of parse needs, in one
 * mutation (the rate limiter only runs in mutations).
 */
export const guard = internalMutationGeneric({
  args: { subject: v.string(), clientId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", args.subject))
      .unique();
    if (!profile) fail("ERR_UNAUTHENTICATED");
    assertActive(profile!);
    await limitOrThrow(ctx, "intakeParse", profile!._id);

    const [aiFeatures, aiModels, aiLimits, perRequest] = await Promise.all([
      getSetting<Record<string, boolean>>(ctx, "ai.features"),
      getSetting<{ lite: string; flash: string }>(ctx, "ai.models"),
      getSetting<{ liteDaily: number; liteRpm: number; flashDaily: number }>(ctx, "ai.limits"),
      getSetting<number>(ctx, "aiIntakeCallsPerRequest"),
    ]);
    const model = aiModels.lite;
    const day = losAngelesDay(Date.now());
    const quotaRow = await ctx.db
      .query("aiQuota")
      .withIndex("by_day_model", eqRange([["day", day], ["model", model]]))
      .unique();
    let clientCalls = 0;
    if (args.clientId) {
      const calls = await ctx.db.query("aiCalls").collect();
      clientCalls = calls.filter(
        (c) =>
          c.feature === "intake" &&
          c.profileId === profile!._id &&
          c.clientId === args.clientId,
      ).length;
    }
    return {
      profileId: profile!._id,
      isDemo: profile!.isDemo,
      refData: await buildRefData(ctx, profile!.isDemo),
      aiIntakeOn: aiFeatures.intake === true,
      model,
      liteDaily: aiLimits.liteDaily,
      perRequestCap: perRequest,
      day,
      quotaUsed: quotaRow?.count ?? 0,
      clientCalls,
    };
  },
});

/** internal.intake.reserveQuota — atomic check-and-increment (PRD §6.3). */
export const reserveQuota = internalMutationGeneric({
  args: { day: v.string(), model: v.string(), limit: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("aiQuota")
      .withIndex("by_day_model", eqRange([["day", args.day], ["model", args.model]]))
      .unique();
    if (row) {
      if (row.count >= args.limit) return false;
      await ctx.db.patch(row._id, { count: row.count + 1 });
    } else {
      if (args.limit <= 0) return false;
      await ctx.db.insert("aiQuota", { day: args.day, model: args.model, count: 1 });
    }
    return true;
  },
});

/** internal.intake.recordAiCall — the S-36 AI log row (redacted input
 *  only, PRD §6.2 rule 5) + the ai_call event. */
export const recordAiCall = internalMutationGeneric({
  args: {
    profileId: v.id("profiles"),
    isDemo: v.boolean(),
    model: v.string(),
    ok: v.boolean(),
    errorKind: v.optional(v.string()),
    inputRedacted: v.string(),
    output: v.string(),
    latencyMs: v.number(),
    clientId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("aiCalls", {
      feature: "intake",
      model: args.model,
      ok: args.ok,
      errorKind: args.errorKind,
      inputRedacted: args.inputRedacted,
      output: args.output,
      latencyMs: args.latencyMs,
      profileId: args.profileId,
      isDemo: args.isDemo,
      clientId: args.clientId,
    });
    await recordEvent(ctx, "ai_call", {
      actorRole: "member",
      props: { feature: "intake", ok: args.ok },
      isDemo: args.isDemo,
    });
    return null;
  },
});

const guardRef = makeFunctionReference<"mutation">("intake:guard");
const reserveRef = makeFunctionReference<"mutation">("intake:reserveQuota");
const recordRef = makeFunctionReference<"mutation">("intake:recordAiCall");

const ALL_FIELDS: (keyof IntakeFields)[] = [
  "bloodGroup", "component", "isDengue", "units", "hospitalId", "area", "neededByKind",
];

/** intake.parse (specs §6.1) — action; AI failures return, never throw. */
export const parse = actionGeneric({
  args: {
    text: v.string(),
    lang: v.union(v.literal("en"), v.literal("bn")),
    source: v.union(v.literal("voice"), v.literal("text"), v.literal("paste")),
    clientId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) fail("ERR_UNAUTHENTICATED");
    const text = args.text.trim();
    if (text.length < 5 || text.length > 2000) fail("ERR_VALIDATION", {}, "text");

    const guard = await ctx.runMutation(guardRef, {
      subject: identity!.subject,
      clientId: args.clientId,
    });

    // The contact number comes from the ORIGINAL text, by regex, here on
    // the server — it is never sent to the AI and never AI-produced.
    const extractedPhone = extractContactPhone(args.text) ?? undefined;

    const rules = parseIntake(args.text, args.lang, guard.refData);
    let fields: IntakeFields = rules.fields;
    let aiUsed = false;
    let aiError: "disabled" | "quota" | "unavailable" | undefined;

    if (missingRequired(fields).length > 0) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!guard.aiIntakeOn) {
        aiError = "disabled";
      } else if (!guard.model || !apiKey) {
        // No model configured (ai.models.lite is empty until spike S4's
        // pick is seeded) or no key in env — honest "unavailable".
        aiError = "unavailable";
      } else if (guard.quotaUsed >= guard.liteDaily) {
        aiError = "quota";
      } else if (args.clientId && guard.clientCalls >= guard.perRequestCap) {
        aiError = "quota"; // S-29: this draft already used its AI calls.
      } else {
        const reserved = await ctx.runMutation(reserveRef, {
          day: guard.day,
          model: guard.model,
          limit: guard.liteDaily,
        });
        if (!reserved) {
          aiError = "quota";
        } else {
          const redacted = redact(args.text);
          const started = Date.now();
          let ok = false;
          let errorKind: string | undefined;
          let output = "";
          try {
            const res = await fetch(geminiUrl(guard.model, apiKey), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(
                buildIntakePayload(redacted.text, dhakaToday(Date.now())),
              ),
            });
            if (!res.ok) {
              errorKind = `http_${res.status}`;
            } else {
              const ai = parseGeminiResponse(await res.json());
              if (ai) {
                fields = mergeAiFields(fields, ai, guard.refData);
                aiUsed = true;
                ok = true;
                output = JSON.stringify(ai);
              } else {
                errorKind = "invalid_response";
              }
            }
          } catch {
            errorKind = "fetch_failed";
          }
          await ctx.runMutation(recordRef, {
            profileId: guard.profileId,
            isDemo: guard.isDemo,
            model: guard.model,
            ok,
            errorKind,
            inputRedacted: redacted.text,
            output,
            latencyMs: Date.now() - started,
            clientId: args.clientId,
          });
          if (!ok) aiError = "unavailable";
        }
      }
    }

    const partial: Partial<IntakeFields> = {};
    for (const f of ALL_FIELDS) {
      if (fields[f] !== null) {
        (partial as Record<string, unknown>)[f] = fields[f];
      }
    }
    return {
      fields: partial,
      hospitalCandidates: hospitalCandidates(args.text, guard.refData),
      missing: ALL_FIELDS.filter((f) => fields[f] === null),
      aiUsed,
      ...(aiError ? { aiError } : {}),
      ...(extractedPhone ? { extractedPhone } : {}),
    };
  },
});
