/**
 * X03 bundle budget check (specs §7.1): the web entry bundle must be
 * ≤ 600 KB gzipped. Run after `npm run build:web`:
 *   node scripts/measure-bundle.mjs
 * Exit 1 when over budget (CI: .github/workflows/bundle-report.yml).
 */
import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const BUDGET = 600 * 1024;
const dir = join(process.cwd(), "dist", "_expo", "static", "js", "web");
const entries = readdirSync(dir).filter((f) => f.startsWith("entry-") && f.endsWith(".js"));
if (entries.length === 0) {
  console.error("No entry bundle found — run `npm run build:web` first.");
  process.exit(2);
}
let worst = 0;
for (const name of entries) {
  const raw = readFileSync(join(dir, name));
  const gz = gzipSync(raw).length;
  worst = Math.max(worst, gz);
  console.log(`${name}: raw ${raw.length} B, gzip ${gz} B (${(gz / 1024).toFixed(1)} KiB)`);
}
console.log(`Budget (specs §7.1): ${BUDGET} B gzip (600 KiB)`);
if (worst > BUDGET) {
  console.error(`OVER BUDGET by ${worst - BUDGET} B — see docs/dev/P6-REPORT.md (X03).`);
  process.exit(1);
}
console.log("Within budget.");
