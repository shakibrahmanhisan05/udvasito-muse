import { describe, expect, it } from "vitest";
import {
  assertActive,
  assertDemoIsolation,
  assertRole,
  requireAuthProfile,
  type Profile,
} from "../convex/_lib/auth";

function codeOf(fn: () => unknown): string {
  try {
    fn();
    return "NO_THROW";
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code ?? String(e);
  }
}

const baseProfile = {
  role: "member",
  status: "active",
  isDemo: false,
} as unknown as Profile;

describe("auth wrappers (specs §6.0, build-prompts P0 tests)", () => {
  it("unauthenticated → ERR_UNAUTHENTICATED", async () => {
    const ctx = {
      auth: { getUserIdentity: async () => null },
      db: { query: () => { throw new Error("must not query"); } },
    };
    await expect(requireAuthProfile(ctx as never)).rejects.toMatchObject({
      data: { code: "ERR_UNAUTHENTICATED" },
    });
  });
  it("wrong role → ERR_FORBIDDEN", () => {
    expect(codeOf(() => assertRole(baseProfile, ["admin"]))).toBe("ERR_FORBIDDEN");
    expect(codeOf(() => assertRole(baseProfile, ["member"]))).toBe("NO_THROW");
  });
  it("frozen account → ERR_FROZEN; underage → ERR_UNDERAGE", () => {
    expect(codeOf(() => assertActive({ ...baseProfile, status: "frozen" } as Profile))).toBe("ERR_FROZEN");
    expect(codeOf(() => assertActive({ ...baseProfile, status: "underage_blocked" } as Profile))).toBe("ERR_UNDERAGE");
    expect(codeOf(() => assertActive(baseProfile))).toBe("NO_THROW");
  });
  it("practice/real mix → ERR_DEMO_ISOLATION", () => {
    expect(codeOf(() => assertDemoIsolation(baseProfile, true))).toBe("ERR_DEMO_ISOLATION");
    expect(codeOf(() => assertDemoIsolation(baseProfile, false))).toBe("NO_THROW");
  });
});
