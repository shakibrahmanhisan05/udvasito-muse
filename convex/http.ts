import { httpActionGeneric, httpRouter, makeFunctionReference } from "convex/server";
import { authComponent, createAuth } from "./auth";

/**
 * HTTP routes on the Convex site URL.
 * - Better Auth routes are registered here (ADR-003).
 * - POST /telegram/webhook (specs §6.5, F-103): secret-header checked;
 *   the update logic lives in phoneVerification.handleTelegramUpdate so
 *   it is unit-testable. Replies are sent only when TELEGRAM_BOT_TOKEN is
 *   configured — until then the endpoint still processes updates and the
 *   app-side status query reflects the result (honest degraded state).
 * - GET /public/helpline (specs §6.5, D-R3): the helpline number, fetched
 *   on tap only; rate-limited 30/hour/network; never cached.
 * - GET /health (specs §6.5): uptime checks.
 */
const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

const handleTelegramUpdate = makeFunctionReference<"mutation">(
  "phoneVerification:handleTelegramUpdate",
);
const helplineFetch = makeFunctionReference<"mutation">("support:helplineFetch");

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function telegramReply(chatId: number, action: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return;
  let text: string | null = null;
  let replyMarkup: unknown;
  if (action === "prompt_contact") {
    // Button label verbatim from specs §6.5; the prompt line itself is not
    // specified there — kept minimal and bilingual.
    text = "Tap the button below to share your phone number. / নিচের বোতামে ট্যাপ করে আপনার ফোন নম্বর শেয়ার করুন।";
    replyMarkup = {
      keyboard: [
        [{ text: "Share my phone number / আমার ফোন নম্বর শেয়ার করুন", request_contact: true }],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    };
  } else if (action === "verified") {
    text = "✅ Verified — go back to UDVASITO / ✅ যাচাই হয়েছে — উদ্ভাসিতে ফিরে যান";
    replyMarkup = { remove_keyboard: true };
  } else if (action === "own_number") {
    text = "Please share your own number. / অনুগ্রহ করে নিজের নম্বর শেয়ার করুন।";
  }
  if (!text) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, reply_markup: replyMarkup }),
    });
  } catch {
    // A failed reply never fails the webhook (specs §6.5: 200 always).
  }
}

http.route({
  path: "/telegram/webhook",
  method: "POST",
  handler: httpActionGeneric(async (ctx, request) => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!secret || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secret) {
      return new Response("unauthorized", { status: 401 });
    }
    let update: unknown = null;
    try {
      update = await request.json();
    } catch {
      return Response.json({}, { status: 200 });
    }
    try {
      const result = (await ctx.runMutation(handleTelegramUpdate, { update })) as {
        action: string;
        chatId?: number;
      };
      if (result.chatId) await telegramReply(result.chatId, result.action);
    } catch {
      // Processing errors must not make Telegram retry-stampede us.
    }
    return Response.json({}, { status: 200 });
  }),
});

http.route({
  path: "/public/helpline",
  method: "GET",
  handler: httpActionGeneric(async (ctx, request) => {
    const forwarded = request.headers.get("x-forwarded-for") ?? "unknown";
    const ipHash = (await sha256Hex(forwarded.split(",")[0].trim())).slice(0, 32);
    try {
      const { phone } = (await ctx.runMutation(helplineFetch, { ipHash })) as { phone: string };
      if (!phone) {
        return Response.json(
          { error: "not_configured" },
          { status: 404, headers: { "Cache-Control": "no-store" } },
        );
      }
      return Response.json(
        { phone },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    } catch (e) {
      const data = (e as { data?: { code?: string; params?: { minutes?: number } } }).data;
      if (data?.code === "ERR_RATE_LIMITED") {
        return Response.json(
          { retryAfterMin: data.params?.minutes ?? 60 },
          { status: 429, headers: { "Cache-Control": "no-store" } },
        );
      }
      throw e;
    }
  }),
});

http.route({
  path: "/health",
  method: "GET",
  handler: httpActionGeneric(async () => Response.json({ ok: true, time: Date.now() })),
});

export default http;
