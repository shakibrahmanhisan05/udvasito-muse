/**
 * copy:extract (CLAUDE.md §4) — P0 version: verifies that src/i18n/en.json
 * and bn.json carry exactly the same keys (specs §1.6: every string exists
 * in both languages) and prints the key count. The full specs-table parser
 * grows with each phase's screens; it NEVER overwrites a Bangla value that
 * already exists (reviewed Bangla is sacred — CLAUDE.md §4).
 */
import en from "../src/i18n/en.json";
import bn from "../src/i18n/bn.json";

function flatten(obj: unknown, prefix = "", out = new Map<string, string>()): Map<string, string> {
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  } else {
    out.set(prefix, String(obj));
  }
  return out;
}

const enFlat = flatten(en);
const bnFlat = flatten(bn);
const missingBn = [...enFlat.keys()].filter((k) => !bnFlat.has(k));
const missingEn = [...bnFlat.keys()].filter((k) => !enFlat.has(k));

console.log(`copy:extract — ${enFlat.size} keys in en.json, ${bnFlat.size} in bn.json`);
if (missingBn.length || missingEn.length) {
  for (const k of missingBn) console.error(`MISSING in bn.json: ${k}`);
  for (const k of missingEn) console.error(`MISSING in en.json: ${k}`);
  process.exit(1);
}
console.log("copy:extract — en/bn key parity OK");
