/**
 * telegramAdmin.ts — ops-only Telegram webhook registration (internal).
 *
 * Why this exists: registering the webhook needs the bot token AND the
 * webhook secret together in one Telegram API call. Both live only in the
 * deployment's environment variables (entered by the project owner in the
 * Convex dashboard; they never pass through chat, logs, or any client).
 * These internal actions read them server-side and make the call,
 * returning only Telegram's ok flag and description — never the token,
 * the secret, or the authenticated API URL.
 *
 * The webhook URL is derived from BETTER_AUTH_URL, which is the
 * deployment's .convex.site origin in every environment.
 *
 * Run:    npx convex run telegramAdmin:registerWebhook
 * Verify: npx convex run telegramAdmin:webhookInfo
 */
import { internalActionGeneric } from "convex/server";

type TelegramConfig = {
  token?: string;
  secret?: string;
  base?: string;
  missing: string[];
};

function readConfig(): TelegramConfig {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const base = process.env.BETTER_AUTH_URL;
  const missing: string[] = [];
  if (!token) missing.push("TELEGRAM_BOT_TOKEN");
  if (!secret) missing.push("TELEGRAM_WEBHOOK_SECRET");
  if (!base) missing.push("BETTER_AUTH_URL");
  return { token, secret, base, missing };
}

type TelegramReply = { ok?: boolean; description?: string };

async function telegramJson(res: Response): Promise<TelegramReply | null> {
  return (await res.json().catch(() => null)) as TelegramReply | null;
}

export const registerWebhook = internalActionGeneric({
  args: {},
  handler: async () => {
    const { token, secret, base, missing } = readConfig();
    if (missing.length > 0 || !token || !secret || !base) {
      return { ok: false, missing, description: "missing environment variables" };
    }
    const url = `${base.replace(/\/$/, "")}/telegram/webhook`;
    let res: Response;
    try {
      res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url,
          secret_token: secret,
          allowed_updates: ["message"],
        }),
      });
    } catch {
      // Sanitised on purpose: a fetch error may embed the request URL,
      // which contains the bot token. Never let it reach logs or callers.
      return {
        ok: false,
        missing: [] as string[],
        description: "network error contacting Telegram",
      };
    }
    const json = await telegramJson(res);
    return {
      ok: json?.ok === true,
      missing: [] as string[],
      description: json?.description ?? `HTTP ${res.status}`,
    };
  },
});

export const webhookInfo = internalActionGeneric({
  args: {},
  handler: async () => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      return { ok: false, missing: ["TELEGRAM_BOT_TOKEN"] as string[] };
    }
    let res: Response;
    try {
      res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    } catch {
      // Sanitised on purpose — see registerWebhook.
      return {
        ok: false,
        missing: [] as string[],
        description: "network error contacting Telegram",
      };
    }
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
      result?: {
        url?: string;
        pending_update_count?: number;
        last_error_date?: number;
        last_error_message?: string;
      };
    } | null;
    if (!json?.ok) {
      return {
        ok: false,
        missing: [] as string[],
        description: json?.description ?? `HTTP ${res.status}`,
      };
    }
    const r = json.result ?? {};
    return {
      ok: true,
      missing: [] as string[],
      url: r.url ?? "",
      pendingUpdateCount: r.pending_update_count ?? 0,
      lastErrorDate: r.last_error_date ?? null,
      lastErrorMessage: r.last_error_message ?? null,
    };
  },
});
