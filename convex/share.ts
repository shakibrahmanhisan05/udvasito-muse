import {
  actionGeneric,
  internalMutationGeneric,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";
import { fail } from "./_lib/errors";
import { assertActive } from "./_lib/auth";
import { featureOn, getSetting } from "./_lib/settings";
import { recordEvent } from "./_lib/events";
import { eqRange } from "./_lib/db";
import { COMPONENT_LABEL, formatTimeDhaka } from "./_lib/notify";
import { extractContactPhone, redact } from "./rules/redaction";
import { geminiUrl } from "./ai/gemini";
import {
  appealPolishAcceptable,
  buildAppealText,
  shareCardImageUrl,
  type AppealData,
} from "./rules/appeal";

/**
 * F-1002/F-1005 share card (specs §6.2 requests.shareCard, §3.2
 * SCR-M05) — behind features.sharedLinks. The owner gets the public
 * link, the specced appeal text and the card image URL. The image is a
 * Cloudinary template URL when configured, otherwise the bundled
 * og-image (the honest template fallback). The phone number is NEVER
 * in the image; it joins the TEXT only when the owner explicitly opts
 * in, appended by code after any AI step. The optional AI polish
 * (ai.features.appeal) rephrases the REDACTED template text only; its
 * output is accepted only if it keeps the link + group and contains
 * no phone-like number — otherwise the template stands.
 */
export const APP_ORIGIN = "https://udvasito.vercel.app";

function losAngelesDay(now: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(new Date(now));
}

export const guard = internalMutationGeneric({
  args: { subject: v.string(), requestId: v.id("requests") },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", args.subject))
      .unique();
    if (!profile) fail("ERR_UNAUTHENTICATED");
    assertActive(profile!);
    if (!(await featureOn(ctx, "sharedLinks"))) {
      fail("ERR_VALIDATION", {}, "feature");
    }
    const request = await ctx.db.get(args.requestId);
    if (
      !request ||
      request.isDemo !== profile!.isDemo ||
      request.requesterId !== profile!._id
    ) {
      fail("ERR_NOT_FOUND");
    }
    const hospital = request!.hospitalId
      ? await ctx.db.get(request!.hospitalId)
      : undefined;
    const upazila = await ctx.db.get(request!.upazilaId);
    const [aiFeatures, aiModels, aiLimits] = await Promise.all([
      getSetting<Record<string, boolean>>(ctx, "ai.features"),
      getSetting<{ lite: string; flash: string }>(ctx, "ai.models"),
      getSetting<{ liteDaily: number; liteRpm: number; flashDaily: number }>(ctx, "ai.limits"),
    ]);
    const model = aiModels.lite;
    const day = losAngelesDay(Date.now());
    const quotaRow = await ctx.db
      .query("aiQuota")
      .withIndex("by_day_model", eqRange([["day", day], ["model", model]]))
      .unique();
    return {
      profileId: profile!._id,
      isDemo: profile!.isDemo,
      ownerPhone: profile!.phone,
      slug: request!.publicSlug,
      units: request!.unitsNeeded,
      bloodGroup: request!.bloodGroup,
      component: request!.component,
      hospitalName: hospital?.nameEn ?? request!.hospitalFreeText ?? "",
      areaName: upazila?.nameEn ?? "",
      neededBy: request!.neededBy,
      aiAppealOn: aiFeatures.appeal === true,
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
    requestId: v.id("requests"),
    aiUsed: v.boolean(),
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
        feature: "appeal",
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
    await recordEvent(ctx, "request_shared", {
      requestId: args.requestId,
      actorRole: "member",
      props: { aiUsed: args.aiUsed },
      isDemo: args.isDemo,
    });
    return null;
  },
});

const guardRef = makeFunctionReference<"mutation">("share:guard");
const recordRef = makeFunctionReference<"mutation">("share:record");
const reserveRef = makeFunctionReference<"mutation">("intake:reserveQuota");

const APPEAL_POLISH_PROMPT =
  "You polish a short public blood-donation appeal for social media. " +
  "Keep every fact exactly as given (blood group, bags, component, hospital, area, time and the link). " +
  "Do not add any phone number or name. Reply with the polished appeal text only, in the same language as the input.";

/** requests.shareCard (specs §6.2) — owner only, features.sharedLinks. */
export const shareCard = actionGeneric({
  args: {
    requestId: v.id("requests"),
    lang: v.union(v.literal("en"), v.literal("bn")),
    includeMyNumber: v.boolean(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) fail("ERR_UNAUTHENTICATED");
    const g = await ctx.runMutation(guardRef, {
      subject: identity!.subject,
      requestId: args.requestId,
    });

    const link = `${APP_ORIGIN}/r/${g.slug}`;
    const data: AppealData = {
      units: g.units,
      bloodGroup: g.bloodGroup,
      componentLabel: COMPONENT_LABEL[args.lang][g.component] ?? g.component,
      hospitalName: g.hospitalName,
      areaName: g.areaName,
      timeText: formatTimeDhaka(g.neededBy),
      link,
    };
    let text = buildAppealText(data, args.lang);
    const imageUrl =
      shareCardImageUrl(
        {
          cloudName: process.env.CLOUDINARY_CLOUD_NAME,
          templateId: process.env.CLOUDINARY_CARD_TEMPLATE,
        },
        data,
      ) ?? `${APP_ORIGIN}/og-image.png`;

    // Optional AI polish — redacted template text only; the owner's
    // number is never part of it (it is appended below, by code).
    let aiUsed = false;
    let aiLog:
      | {
          model: string;
          ok: boolean;
          errorKind?: string;
          inputRedacted: string;
          output: string;
          latencyMs: number;
        }
      | undefined;
    const apiKey = process.env.GEMINI_API_KEY;
    if (g.aiAppealOn && g.model && apiKey && g.quotaUsed < g.liteDaily) {
      const reserved = await ctx.runMutation(reserveRef, {
        day: g.day,
        model: g.model,
        limit: g.liteDaily,
      });
      if (reserved) {
        const redacted = redact(text);
        const started = Date.now();
        let ok = false;
        let errorKind: string | undefined;
        let output = "";
        try {
          const res = await fetch(geminiUrl(g.model, apiKey), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: APPEAL_POLISH_PROMPT }] },
              contents: [{ parts: [{ text: redacted.text }] }],
              generation_config: { temperature: 0.4 },
            }),
          });
          if (!res.ok) {
            errorKind = `http_${res.status}`;
          } else {
            const body = (await res.json()) as {
              candidates?: { content?: { parts?: { text?: string }[] } }[];
            };
            output = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
            if (
              output &&
              appealPolishAcceptable(output, data, extractContactPhone(output) !== null)
            ) {
              text = output.trim();
              aiUsed = true;
              ok = true;
            } else {
              errorKind = "rejected_output";
            }
          }
        } catch {
          errorKind = "fetch_failed";
        }
        aiLog = {
          model: g.model,
          ok,
          errorKind,
          inputRedacted: redacted.text,
          output,
          latencyMs: Date.now() - started,
        };
      }
    }

    if (args.includeMyNumber) {
      // The owner's explicit opt-in (share.addMyNumber, off by
      // default) — appended by code, never through the AI or image.
      text = `${text}\n${g.ownerPhone}`;
    }

    await ctx.runMutation(recordRef, {
      profileId: g.profileId,
      isDemo: g.isDemo,
      requestId: args.requestId,
      aiUsed,
      ai: aiLog,
    });
    return { imageUrl, text, link };
  },
});
