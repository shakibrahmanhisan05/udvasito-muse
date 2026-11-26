import { internalMutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import type { DataModel, Id } from "./schemaTypes";
import { getAuthProfile, memberQueryV } from "./_lib/auth";
import { haversineKm } from "./rules/ranking";
import { eqRange } from "./_lib/db";

/**
 * Hospitals & blood banks (specs §6.2, DEP-01). Directory data is public
 * reference data (institutional numbers only — never personal mobiles,
 * data/SOURCES.md). Search runs on the `search_all` index over names and
 * aliases; the import is idempotent, keyed by nameEn + district, and is
 * fed from data/hospitals.csv (see tests + scripts/import-hospitals.ts).
 */

async function callerIsDemo(
  ctx: Parameters<typeof getAuthProfile>[0],
): Promise<boolean> {
  const profile = await getAuthProfile(ctx);
  return profile?.isDemo ?? false;
}

export const search = queryGeneric({
  args: { text: v.string(), districtId: v.optional(v.id("places")) },
  handler: async (ctx, args) => {
    const text = args.text.trim();
    if (!text) return [];
    const isDemo = await callerIsDemo(ctx);
    const rows = await ctx.db
      .query("hospitals")
      .withSearchIndex("search_all", (q) => {
        const base = q.search("searchText", text).eq("isDemo", isDemo).eq("active", true);
        return args.districtId ? base.eq("districtId", args.districtId) : base;
      })
      .take(10);
    const out = [];
    for (const row of rows) {
      const upazila = await ctx.db.get(row.upazilaId);
      out.push({
        _id: row._id,
        nameEn: row.nameEn,
        nameBn: row.nameBn,
        upazila: upazila?.nameEn ?? "",
        lat: row.lat,
        lng: row.lng,
      });
    }
    return out;
  },
});

/** All active hospitals in scope — the client computes haversine-nearest
 *  for "use my location" (SCR-M02) from these coordinates. */
export const list = queryGeneric({
  args: { districtId: v.optional(v.id("places")) },
  handler: async (ctx, args) => {
    const isDemo = await callerIsDemo(ctx);
    const rows = args.districtId
      ? await ctx.db
          .query("hospitals")
          .withIndex(
            "by_district",
            eqRange([["isDemo", isDemo], ["active", true], ["districtId", args.districtId]]),
          )
          .collect()
      : (await ctx.db
          .query("hospitals")
          .withIndex("by_district", eqRange([["isDemo", isDemo], ["active", true]]))
          .collect());
    return rows.map((row) => ({
      _id: row._id,
      nameEn: row.nameEn,
      nameBn: row.nameBn,
      districtId: row.districtId,
      upazilaId: row.upazilaId,
      lat: row.lat,
      lng: row.lng,
      bloodBankPhone: row.bloodBankPhone,
    }));
  },
});

/** hospitals.bloodBanksNear (specs §6.2) — for the no-donors panel. */
export const bloodBanksNear = memberQueryV({
  args: { districtId: v.id("places"), upazilaId: v.id("places") },
  handler: async (ctx, args) => {
    const centre = await ctx.db.get(args.upazilaId);
    const rows = await ctx.db
      .query("hospitals")
      .withIndex(
        "by_district",
        eqRange([["isDemo", ctx.profile.isDemo], ["active", true], ["districtId", args.districtId]]),
      )
      .collect();
    return rows
      .map((row) => ({
        nameEn: row.nameEn,
        nameBn: row.nameBn,
        phone: row.bloodBankPhone,
        distanceKm: centre
          ? Math.round(haversineKm(centre, row) * 10) / 10
          : 0,
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 5);
  },
});

const importRow = v.object({
  nameEn: v.string(),
  nameBn: v.string(),
  aliases: v.array(v.string()),
  type: v.union(v.literal("hospital"), v.literal("blood_bank"), v.literal("clinic")),
  districtName: v.string(),
  upazilaName: v.string(),
  address: v.optional(v.string()),
  bloodBankPhone: v.optional(v.string()),
  lat: v.number(),
  lng: v.number(),
  active: v.boolean(),
});

/**
 * Idempotent import (key: nameEn + district). District/upazila are given
 * by English name as in data/hospitals.csv and resolved to place ids;
 * rows whose place names don't resolve are reported, never guessed.
 */
export const importHospitals = internalMutationGeneric({
  args: { rows: v.array(importRow) },
  handler: async (ctx, args) => {
    let inserted = 0;
    let updated = 0;
    const skipped: { nameEn: string; reason: string }[] = [];
    const districts = await ctx.db
      .query("places")
      .withIndex("by_level_parent", (q) => q.eq("level", "district"))
      .collect();
    for (const row of args.rows) {
      const district = districts.find((d) => d.nameEn === row.districtName);
      if (!district) {
        skipped.push({ nameEn: row.nameEn, reason: `district not found: ${row.districtName}` });
        continue;
      }
      const upazilas = await ctx.db
        .query("places")
        .withIndex("by_level_parent", eqRange([["level", "upazila"], ["parentId", district._id]]))
        .collect();
      const upazila = upazilas.find((u) => u.nameEn === row.upazilaName);
      if (!upazila) {
        skipped.push({ nameEn: row.nameEn, reason: `upazila not found: ${row.upazilaName}` });
        continue;
      }
      const doc = {
        nameEn: row.nameEn,
        nameBn: row.nameBn,
        aliases: row.aliases,
        searchText: [row.nameEn, row.nameBn, ...row.aliases].join(" ").toLowerCase(),
        type: row.type,
        divisionId: district.parentId as Id<"places">,
        districtId: district._id,
        upazilaId: upazila._id,
        address: row.address,
        bloodBankPhone: row.bloodBankPhone,
        lat: row.lat,
        lng: row.lng,
        active: row.active,
        isDemo: false,
      };
      const sameDistrict = [
        ...(await ctx.db
          .query("hospitals")
          .withIndex("by_district", eqRange([["isDemo", false], ["active", true], ["districtId", district._id]]))
          .collect()),
        ...(await ctx.db
          .query("hospitals")
          .withIndex("by_district", eqRange([["isDemo", false], ["active", false], ["districtId", district._id]]))
          .collect()),
      ];
      const existing = sameDistrict.find((h) => h.nameEn === row.nameEn);
      if (existing) {
        await ctx.db.patch(existing._id, doc);
        updated++;
      } else {
        await ctx.db.insert("hospitals", doc);
        inserted++;
      }
    }
    return { inserted, updated, skipped };
  },
});

// Referenced so the DataModel import stays meaningful for future functions.
export type HospitalsDataModel = DataModel;
