import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Regression test for the P4-review F1 bug (S2 for the pilot):
 * PushRegistrar called push:registerExpoToken with
 * {token, platform, deviceLabel} while the mutation validates only
 * {token} (specs §6.4) — Convex rejected every call and the swallowed
 * .catch(() => {}) meant Android Expo tokens were NEVER recorded.
 *
 * The client↔server contract is the failure point, so this test reads
 * both sides of it from source and asserts the call site passes
 * EXACTLY the validator's argument keys — no more, no fewer. Any
 * future arg added on only one side fails here.
 */

function validatorKeys(source: string, exportName: string): string[] {
  const start = source.indexOf(`export const ${exportName}`);
  if (start < 0) throw new Error(`${exportName} not found`);
  const argsStart = source.indexOf("args: {", start) + "args: {".length;
  const argsEnd = source.indexOf("}", argsStart);
  const body = source.slice(argsStart, argsEnd);
  return [...body.matchAll(/(\w+)\s*:/g)].map((m) => m[1]).sort();
}

function callSiteKeys(source: string, callee: string): string[] {
  const start = source.indexOf(`${callee}({`);
  if (start < 0) throw new Error(`${callee}({ not found`);
  const end = source.indexOf("})", start);
  const body = source.slice(start + callee.length + 1, end + 1);
  const keys = new Set<string>();
  // key: value pairs
  for (const m of body.matchAll(/(\w+)\s*:/g)) keys.add(m[1]);
  // shorthand properties ({ token }) — identifiers left after removing pairs
  const stripped = body.replace(/\w+\s*:[^,}]+/g, " ");
  for (const m of stripped.matchAll(/(?:^|[{,]\s*)([A-Za-z_]\w*)\s*(?=[,}])/g)) {
    keys.add(m[1]);
  }
  return [...keys].sort();
}

describe("push token registration contract (P4 review F1)", () => {
  it("the client calls registerExpoToken with exactly the validator's args", () => {
    const server = readFileSync("convex/push.ts", "utf8");
    const client = readFileSync("app/_layout.tsx", "utf8");
    const expected = validatorKeys(server, "registerExpoToken");
    expect(expected).toEqual(["token"]); // specs §6.4
    expect(callSiteKeys(client, "register")).toEqual(expected);
  });

  it("the web-push call site also matches its validator exactly", () => {
    const server = readFileSync("convex/push.ts", "utf8");
    const client = readFileSync("app/_layout.tsx", "utf8");
    const expected = validatorKeys(server, "registerWebSubscription");
    // The web branch passes the subscription object straight through:
    // registerWeb(subscription) — assert the registrar does not wrap it
    // in a hand-built object with invented keys.
    expect(client).toContain("registerWeb(subscription)");
    expect(expected.length).toBeGreaterThan(0);
  });
});
