/**
 * X03 bundle budget check (specs §7.1): "Web app shell JS (gzip)
 * ≤ 600 KB initial; map, assistant and admin code lazy-loaded".
 * Run after `npm run build:web`:
 *   node scripts/measure-bundle.mjs
 * Exit 1 when over budget (CI: .github/workflows/bundle-report.yml).
 *
 * What "initial" means since P7 enabled Expo Router async routes
 * (route-based splitting, web): the browser must download, to render
 * the first screen of `/`:
 *   1. every <script src> in dist/index.html (metro runtime + the
 *      __common chunk + the entry chunk), and
 *   2. the root-layout chunk (app/_layout.tsx — providers + gates),
 *      identified as the _layout-*.js chunk containing the
 *      "/service-worker.js" registration string that only the root
 *      layout carries, and
 *   3. the `/` route chunk — an index-*.js chunk (several routes are
 *      named "index" since P7 added /learn), identified as the one
 *      carrying the landing-only markers "/public/stats" (the impact
 *      fetch) and "landing.hero" (its headline key).
 * Lazy chunks (other routes, Sentry, the Bangla catalogue, push) are
 * reported for information but are NOT part of the initial total —
 * that is the point of the splitting the spec asks for. If the root
 * layout cannot be identified unambiguously the script exits 2
 * rather than guessing.
 */
import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const BUDGET = 600 * 1024;
const root = process.cwd();
const dir = join(root, "dist", "_expo", "static", "js", "web");

let files;
try {
  files = readdirSync(dir).filter((f) => f.endsWith(".js"));
} catch {
  console.error("No dist web JS found — run `npm run build:web` first.");
  process.exit(2);
}
if (files.length === 0) {
  console.error("No JS bundles found — run `npm run build:web` first.");
  process.exit(2);
}

const gz = (name) => gzipSync(readFileSync(join(dir, name))).length;
const sizes = new Map(files.map((f) => [f, gz(f)]));

// 1. Scripts referenced by index.html (in load order).
const html = readFileSync(join(root, "dist", "index.html"), "utf8");
const scriptSrcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
const bootstrap = scriptSrcs
  .map((src) => src.split("/").pop())
  .filter((name) => sizes.has(name));
if (bootstrap.length === 0) {
  console.error("index.html references no known JS bundles — cannot measure.");
  process.exit(2);
}

// 2. Root-layout chunk: the _layout-*.js containing the service-worker
// registration (only app/_layout.tsx registers it).
const layoutChunks = files.filter((f) => f.startsWith("_layout-"));
const rootLayout = layoutChunks.filter((f) =>
  readFileSync(join(dir, f), "utf8").includes("/service-worker.js"),
);
if (rootLayout.length !== 1) {
  console.error(
    `Could not identify exactly one root-layout chunk (found ${rootLayout.length}) — refusing to guess.`,
  );
  process.exit(2);
}

// 3. The `/` route chunk: several routes are named "index" (landing,
// /learn, …), so pick the index-*.js chunk carrying both landing-only
// markers — the impact fetch path and the hero copy key.
const indexChunks = files.filter((f) => f.startsWith("index-"));
const landingChunks = indexChunks.filter((f) => {
  const src = readFileSync(join(dir, f), "utf8");
  return src.includes("/public/stats") && src.includes("landing.hero");
});
if (landingChunks.length !== 1) {
  console.error(
    `Could not identify exactly one landing route chunk (found ${landingChunks.length}) — refusing to guess.`,
  );
  process.exit(2);
}

const sum = (names) => names.reduce((acc, n) => acc + (sizes.get(n) ?? 0), 0);
const bootstrapTotal = sum(bootstrap);
const firstScreenTotal = bootstrapTotal + sum(rootLayout) + sum(landingChunks);

console.log("Initial web shell (specs §7.1) — first screen of /:");
for (const name of [...bootstrap, ...rootLayout, ...landingChunks]) {
  console.log(`  ${name}: gzip ${sizes.get(name)} B`);
}
console.log(`Bootstrap (index.html scripts): ${bootstrapTotal} B gzip`);
console.log(`FIRST SCREEN TOTAL: ${firstScreenTotal} B gzip (${(firstScreenTotal / 1024).toFixed(1)} KiB)`);
console.log(`Budget (specs §7.1): ${BUDGET} B gzip (600 KiB)`);

const totalAll = sum(files);
console.log(`\nAll web JS (${files.length} chunks): ${totalAll} B gzip (lazy chunks load on demand)`);
const lazy = files
  .filter((f) => ![...bootstrap, ...rootLayout, ...landingChunks].includes(f))
  .sort((a, b) => (sizes.get(b) ?? 0) - (sizes.get(a) ?? 0))
  .slice(0, 5);
for (const name of lazy) console.log(`  lazy: ${name}: gzip ${sizes.get(name)} B`);

if (firstScreenTotal > BUDGET) {
  console.error(`\nOVER BUDGET by ${firstScreenTotal - BUDGET} B`);
  process.exit(1);
}
console.log("\nWithin budget.");
