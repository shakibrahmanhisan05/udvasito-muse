import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * D-R3 / P1-G12: the fallback helpline number must never appear in the
 * client bundle. It is served at runtime (support.helpline for signed-in
 * users, GET /public/helpline on tap for signed-out visitors) and stored
 * only in the Convex `settings` table. Scan every client source file for
 * anything shaped like a BD mobile number.
 *
 * (src/i18n/*.json is excluded: it is specs-mandated copy, and its one
 * example number in validation.val03 is a format example from specs §4,
 * not the helpline. The Convex settings default for fallbackContactPhone
 * is "" — see tests/p0-convex.test.ts for the appConfig no-number scan.)
 */
const PHONE_SHAPE = /(\+?880|0)1[3-9]\d{8}/;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      yield* walk(path);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
      yield path;
    }
  }
}

describe("helpline secrecy (D-R3)", () => {
  it("no BD mobile number literal exists in app/ or src/ client code", () => {
    const offenders: string[] = [];
    for (const dir of ["app", "src"]) {
      for (const file of walk(dir)) {
        if (file.startsWith(join("src", "i18n"))) continue;
        const text = readFileSync(file, "utf8");
        if (PHONE_SHAPE.test(text)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
