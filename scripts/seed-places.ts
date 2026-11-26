/**
 * seed:places (CLAUDE.md §4, roadmap §5.2, ADR-013) — builds the places
 * dataset from data/geo/ (nuhil/bangladesh-geocode, pinned commit in
 * docs/data-licences.md) + data/thana-overrides.json (Chattogram metro
 * thanas), validates it, computes S-32 neighbours, and writes:
 *   - data/places.json        full seed payload (committed, reviewed)
 *   - src/data/places.min.json  offline picker bundle (id/level/parent/names)
 * Then, when CONVEX_URL + CONVEX_DEPLOY_KEY are set, upserts into Convex via
 * internal.places:seedPlaces; otherwise prints the exact manual step.
 * Idempotent: the Convex mutation upserts by `code`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildPlaces, computeNeighbours, parseGeocodeTable, validatePlaces } from "./places-build";
import { SETTING_DEFS } from "../convex/_lib/settingsData";

const read = (p: string) => JSON.parse(readFileSync(p, "utf8")) as unknown;

const rows = buildPlaces({
  divisions: parseGeocodeTable(read("data/geo/divisions.json")),
  districts: parseGeocodeTable(read("data/geo/districts.json")),
  upazilas: parseGeocodeTable(read("data/geo/upazilas.json")),
  thanaOverrides: read("data/thana-overrides.json") as never,
});

const radiusKm = Number(SETTING_DEFS.find((d) => d.key === "neighbourKm")?.value ?? 10);
computeNeighbours(rows, radiusKm);

const errors = validatePlaces(rows);
if (errors.length > 0) {
  console.error(`seed:places — validation failed:\n - ${errors.slice(0, 20).join("\n - ")}`);
  process.exit(1);
}

writeFileSync("data/places.json", JSON.stringify(rows, null, 1));
writeFileSync(
  "src/data/places.min.json",
  JSON.stringify(rows.map((r) => ({ id: r.code, level: r.level, parent: r.parentCode, nameEn: r.nameEn, nameBn: r.nameBn }))),
);

const metro = rows.filter((r) => r.isMetroThana);
const fallbacks = rows.filter((r) => r.pointSource === "district-fallback");
const zeroNeighbours = rows.filter((r) => r.level === "upazila" && r.neighbourCodes.length === 0);
console.log(
  `seed:places — ${rows.length} rows: 8 divisions, 64 districts, ` +
    `${rows.filter((r) => r.level === "upazila").length} upazila-level (${metro.length} Chattogram metro thanas), ` +
    `neighbours within ${radiusKm} km`,
);
console.log(`seed:places — wrote data/places.json + src/data/places.min.json`);
if (fallbacks.length > 0) {
  console.log(`seed:places — ⚠ district-point fallbacks (member 2 to fix): ${fallbacks.map((r) => r.nameEn).join(", ")}`);
}
console.log(`seed:places — upazila-level rows with zero neighbours: ${zeroNeighbours.length}${zeroNeighbours.length ? ` (${zeroNeighbours.slice(0, 8).map((r) => r.nameEn).join(", ")}…)` : ""}`);

async function pushToConvex(): Promise<void> {
  const url = process.env.CONVEX_URL ?? process.env.EXPO_PUBLIC_CONVEX_URL;
  const key = process.env.CONVEX_DEPLOY_KEY;
  if (!url || !key) {
    console.log(
      "seed:places — no CONVEX_URL/CONVEX_DEPLOY_KEY in env; dataset files are written.\n" +
        "After RB-2, run:  CONVEX_URL=<deployment url> CONVEX_DEPLOY_KEY=<deploy key> npm run seed:places",
    );
    return;
  }
  const { ConvexHttpClient } = await import("convex/browser");
  const { makeFunctionReference } = await import("convex/server");
  const client = new ConvexHttpClient(url);
  // setAdminAuth exists at runtime in convex 1.51 but is marked @internal
  // and stripped from the public type declarations.
  (client as unknown as { setAdminAuth: (token: string) => void }).setAdminAuth(key);
  const result = await client.mutation(
    makeFunctionReference<"mutation">("internal.places:seedPlaces"),
    { rows } as never,
  );
  console.log("seed:places — Convex upsert result:", result);
}

pushToConvex().catch((err: unknown) => {
  console.error("seed:places — Convex push failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
