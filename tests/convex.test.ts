import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../convex/schema";
import * as seedModule from "../convex/seed";
import * as publicModule from "../convex/public";
import * as profilesModule from "../convex/profiles";

const modules = {
  // convex-test locates the modules root from a _generated path; the real
  // _generated directory is produced by `npm run convex` (first codegen).
  // Values are lazy loaders, exactly like import.meta.glob produces.
  "../convex/_generated/api.ts": async () => ({}),
  "../convex/seed.ts": async () => seedModule,
  "../convex/public.ts": async () => publicModule,
  "../convex/profiles.ts": async () => profilesModule,
};

const seedSettings = makeFunctionReference<"mutation">("seed:seedSettings");
const appConfig = makeFunctionReference<"query">("public:appConfig");
const me = makeFunctionReference<"query">("profiles:me");

describe("convex backend (convex-test)", () => {
  it("seedSettings is idempotent and seeds every §5.2 row", async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(seedSettings, {});
    expect(first.total).toBeGreaterThanOrEqual(51);
    expect(first.inserted).toBe(first.total);
    const second = await t.mutation(seedSettings, {});
    expect(second.inserted).toBe(0);
  });
  it("public.appConfig returns the seeded gates without any phone number", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(seedSettings, {});
    const cfg = await t.query(appConfig, {});
    expect(cfg.consentVersion).toBe("2026-11-28-pilot");
    expect(cfg.minimumAppVersion).toBe("0.1.0");
    expect(JSON.stringify(cfg)).not.toMatch(/01[3-9]\d{8}/);
  });
  it("profiles.me is null when signed out", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(me, {})).toBeNull();
  });
});
