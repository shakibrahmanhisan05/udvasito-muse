import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../convex/schema";
import * as placesModule from "../convex/places";

const modules = {
  "../convex/_generated/api.ts": async () => ({}),
  "../convex/places.ts": async () => placesModule,
};

const seedPlaces = makeFunctionReference<"mutation">("places:seedPlaces");

const row = (
  level: "division" | "district" | "upazila",
  code: string,
  parentCode: string | null,
  neighbourCodes: string[] = [],
) => ({
  level,
  code,
  nameEn: code,
  nameBn: code,
  parentCode,
  lat: 22.35,
  lng: 91.83,
  isMetroThana: false,
  neighbourCodes,
});

const DIV = row("division", "DIV-T", null);
const DIS = row("district", "DIS-T", "DIV-T");
const UP1 = row("upazila", "UP-T1", "DIS-T", ["UP-T2"]);
const UP2 = row("upazila", "UP-T2", "DIS-T", ["UP-T1"]);

async function byCode(t: ReturnType<typeof convexTest>) {
  const all = await t.run(async (ctx) => ctx.db.query("places").collect());
  return new Map(all.map((p) => [p.code, p]));
}

describe("places.seedPlaces link resolution", () => {
  it("links children seeded in a later call than their parents", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(seedPlaces, { rows: [DIV, DIS] });
    await t.mutation(seedPlaces, { rows: [UP1, UP2] });
    const docs = await byCode(t);
    expect(docs.get("DIS-T")?.parentId).toBe(docs.get("DIV-T")?._id);
    expect(docs.get("UP-T1")?.parentId).toBe(docs.get("DIS-T")?._id);
    expect(docs.get("UP-T2")?.parentId).toBe(docs.get("DIS-T")?._id);
    expect(docs.get("UP-T1")?.neighbourIds).toEqual([docs.get("UP-T2")?._id]);
    expect(docs.get("UP-T2")?.neighbourIds).toEqual([docs.get("UP-T1")?._id]);
  });

  it("a single-row re-seed does not unlink that row (production regression)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(seedPlaces, { rows: [DIV, DIS, UP1, UP2] });
    // The 2026-11-26 production failure: re-running seedPlaces with only
    // a subset of rows wiped parentId/neighbourIds for those rows,
    // because pass 2 resolved links only within the current call.
    await t.mutation(seedPlaces, { rows: [UP1] });
    const docs = await byCode(t);
    expect(docs.get("UP-T1")?.parentId).toBe(docs.get("DIS-T")?._id);
    expect(docs.get("UP-T1")?.neighbourIds).toEqual([docs.get("UP-T2")?._id]);
  });
});
