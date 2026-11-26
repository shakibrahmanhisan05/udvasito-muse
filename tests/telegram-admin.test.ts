import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../convex/schema";
import * as telegramAdminModule from "../convex/telegramAdmin";

const modules = {
  "../convex/_generated/api.ts": async () => ({}),
  "../convex/telegramAdmin.ts": async () => telegramAdminModule,
};

const registerWebhook =
  makeFunctionReference<"action">("telegramAdmin:registerWebhook");
const webhookInfo = makeFunctionReference<"action">("telegramAdmin:webhookInfo");

const ENV_KEYS = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "BETTER_AUTH_URL",
] as const;

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

function setEnv() {
  process.env.TELEGRAM_BOT_TOKEN = "123456:FAKE-TOKEN";
  process.env.TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.BETTER_AUTH_URL = "https://example.convex.site";
}

afterEach(() => {
  clearEnv();
  vi.unstubAllGlobals();
});

describe("telegramAdmin.registerWebhook", () => {
  it("reports every missing env var and calls nothing", async () => {
    clearEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const t = convexTest(schema, modules);
    const res = await t.action(registerWebhook, {});
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual([
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_WEBHOOK_SECRET",
      "BETTER_AUTH_URL",
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts url + secret_token to Telegram and returns no secrets", async () => {
    setEnv();
    let seenUrl = "";
    let seenBody: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      seenUrl = url;
      seenBody = JSON.parse(String(init?.body ?? "{}"));
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, description: "Webhook was set" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const t = convexTest(schema, modules);
    const res = await t.action(registerWebhook, {});
    expect(res.ok).toBe(true);
    expect(res.description).toBe("Webhook was set");
    expect(seenUrl).toBe(
      "https://api.telegram.org/bot123456:FAKE-TOKEN/setWebhook",
    );
    expect(seenBody.url).toBe("https://example.convex.site/telegram/webhook");
    expect(seenBody.secret_token).toBe("test-webhook-secret");
    const serialised = JSON.stringify(res);
    expect(serialised).not.toContain("FAKE-TOKEN");
    expect(serialised).not.toContain("test-webhook-secret");
  });

  it("sanitises network errors so the token URL never leaks", async () => {
    setEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(
          "fetch failed: https://api.telegram.org/bot123456:FAKE-TOKEN/setWebhook",
        );
      }),
    );
    const t = convexTest(schema, modules);
    const res = await t.action(registerWebhook, {});
    expect(res.ok).toBe(false);
    expect(res.description).toBe("network error contacting Telegram");
    expect(JSON.stringify(res)).not.toContain("FAKE-TOKEN");
  });

  it("surfaces Telegram's refusal honestly", async () => {
    setEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({ ok: false, description: "Unauthorized" }),
      })),
    );
    const t = convexTest(schema, modules);
    const res = await t.action(registerWebhook, {});
    expect(res.ok).toBe(false);
    expect(res.description).toBe("Unauthorized");
  });
});

describe("telegramAdmin.webhookInfo", () => {
  it("requires the bot token", async () => {
    clearEnv();
    const t = convexTest(schema, modules);
    const res = await t.action(webhookInfo, {});
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual(["TELEGRAM_BOT_TOKEN"]);
  });

  it("returns the registered url and pending count", async () => {
    setEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: {
            url: "https://example.convex.site/telegram/webhook",
            pending_update_count: 0,
          },
        }),
      })),
    );
    const t = convexTest(schema, modules);
    const res = await t.action(webhookInfo, {});
    expect(res.ok).toBe(true);
    expect(res.url).toBe("https://example.convex.site/telegram/webhook");
    expect(res.pendingUpdateCount).toBe(0);
  });
});
