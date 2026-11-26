/**
 * Places (specs §5.1, ADR-013): reference geography seeded from
 * data/places.json by scripts/seed-places.ts. Pickers read `children`
 * (public — names and codes only, no personal data). Seeding is internal.
 */
import { internalMutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import type { DataModel, Id } from "./schemaTypes";
import { eqRange } from "./_lib/db";

const placeRow = v.object({
  level: v.union(v.literal("division"), v.literal("district"), v.literal("upazila")),
  code: v.string(),
  nameEn: v.string(),
  nameBn: v.string(),
  parentCode: v.union(v.string(), v.null()),
  lat: v.number(),
  lng: v.number(),
  isMetroThana: v.boolean(),
  neighbourCodes: v.array(v.string()),
});

/** Idempotent upsert by code (two passes: rows, then id links). */
export const seedPlaces = internalMutationGeneric({
  args: { rows: v.array(placeRow) },
  handler: async (ctx, args) => {
    const idByCode = new Map<string, Id<"places">>();
    for (const row of args.rows) {
      const existing = await ctx.db
        .query("places")
        .withIndex("by_code", (q) => q.eq("code", row.code))
        .unique();
      const doc = {
        level: row.level, code: row.code, nameEn: row.nameEn, nameBn: row.nameBn,
        lat: row.lat, lng: row.lng, isMetroThana: row.isMetroThana,
      };
      if (existing) {
        await ctx.db.patch(existing._id, doc);
        idByCode.set(row.code, existing._id);
      } else {
        idByCode.set(row.code, await ctx.db.insert("places", { ...doc, neighbourIds: [] }));
      }
    }
    // Pass 2 resolves links. A code missing from this call (a partial
    // re-seed — e.g. one district at a time, or a single row) falls back
    // to the row already in the database. Without the fallback, a
    // chunked seed silently unlinks every row whose parent or neighbours
    // were upserted by an earlier call (found in production, 2026-11-26).
    const resolveId = async (
      code: string,
    ): Promise<Id<"places"> | undefined> => {
      const cached = idByCode.get(code);
      if (cached) return cached;
      const found = await ctx.db
        .query("places")
        .withIndex("by_code", (q) => q.eq("code", code))
        .unique();
      if (found) idByCode.set(code, found._id);
      return found?._id;
    };
    for (const row of args.rows) {
      const id = idByCode.get(row.code) as Id<"places">;
      const neighbourIds: Id<"places">[] = [];
      for (const code of row.neighbourCodes) {
        const nid = await resolveId(code);
        if (nid) neighbourIds.push(nid);
      }
      await ctx.db.patch(id, {
        parentId: row.parentCode ? await resolveId(row.parentCode) : undefined,
        neighbourIds,
      });
    }
    return { upserted: args.rows.length };
  },
});

/** Picker data: children of a place (or all divisions when no parent). */
export const children = queryGeneric({
  args: { parentCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    let parentId: Id<"places"> | undefined;
    let parentLevel: "division" | "district" | "upazila" | undefined;
    if (args.parentCode) {
      const parent = await ctx.db
        .query("places")
        .withIndex("by_code", (q) => q.eq("code", args.parentCode as string))
        .unique();
      if (!parent) return [];
      parentId = parent._id;
      parentLevel = parent.level;
    }
    // by_level_parent is (level, parentId): children sit one level below
    // their parent, and divisions are the level with no parent.
    const childLevel = !parentId
      ? "division"
      : parentLevel === "division"
        ? "district"
        : parentLevel === "district"
          ? "upazila"
          : null;
    if (childLevel === null) return [];
    const rows = (
      await ctx.db
        .query("places")
        .withIndex("by_level_parent", (q) => q.eq("level", childLevel))
        .collect()
    ).filter((r) => r.parentId === parentId);
    return rows
      .map((r) => ({ code: r.code, level: r.level, nameEn: r.nameEn, nameBn: r.nameBn, isMetroThana: r.isMetroThana }))
      .sort((a, b) => a.nameEn.localeCompare(b.nameEn));
  },
});

// Referenced so the DataModel import stays meaningful for future functions.
export type PlacesDataModel = DataModel;

/**
 * places.list (specs §6.2) — picker data by level + parent id, with
 * coordinates (the request form's distance display uses them). Public:
 * names and centres only, no personal data.
 */
export const list = queryGeneric({
  args: {
    level: v.union(v.literal("division"), v.literal("district"), v.literal("upazila")),
    parentId: v.optional(v.id("places")),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("places")
      .withIndex("by_level_parent", eqRange([["level", args.level], ["parentId", args.parentId]]))
      .collect();
    return rows
      .map((r) => ({ _id: r._id, nameEn: r.nameEn, nameBn: r.nameBn, lat: r.lat, lng: r.lng }))
      .sort((a, b) => a.nameEn.localeCompare(b.nameEn));
  },
});
