import { v } from "convex/values";
import { adminMutationV, adminQueryV } from "../_lib/auth";
import { fail } from "../_lib/errors";
import { featureOn } from "../_lib/settings";
import { validatePhone } from "../rules/validation";
import { writeAudit } from "../_lib/audit";

/**
 * Hospital & blood-bank directory admin (F-906, SCR-A11, switch
 * `directoryUi`). The directory DATA is Must (seeded in P0); this is
 * the if-time management UI's server half: searchable list + add/edit
 * with the specced form validation — name EN/BN required, blood-bank
 * phone either a mobile (VAL-03) or a landline `0\d{6,10}`, a real
 * point, and the search text rebuilt on every write so intake/hospital
 * search keeps matching. Rows are scoped to the admin's own demo flag.
 */

const LANDLINE = /^0\d{6,10}$/;

export const list = adminQueryV({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!(await featureOn(ctx, "directoryUi"))) return [];
    const rows = await ctx.db.query("hospitals").collect();
    const needle = (args.search ?? "").trim().toLowerCase();
    return rows
      .filter((h) => h.isDemo === ctx.profile.isDemo)
      .filter((h) => !needle || h.searchText.includes(needle))
      .sort((a, b) => a.nameEn.localeCompare(b.nameEn))
      .map((h) => ({
        _id: h._id,
        nameEn: h.nameEn,
        nameBn: h.nameBn,
        type: h.type,
        divisionId: h.divisionId,
        districtId: h.districtId,
        upazilaId: h.upazilaId,
        address: h.address ?? null,
        bloodBankPhone: h.bloodBankPhone ?? null,
        lat: h.lat,
        lng: h.lng,
        active: h.active,
      }));
  },
});

export const upsert = adminMutationV({
  args: {
    hospitalId: v.optional(v.id("hospitals")),
    nameEn: v.string(),
    nameBn: v.string(),
    type: v.union(v.literal("hospital"), v.literal("blood_bank"), v.literal("clinic")),
    divisionId: v.id("places"),
    districtId: v.id("places"),
    upazilaId: v.id("places"),
    address: v.optional(v.string()),
    bloodBankPhone: v.optional(v.string()),
    lat: v.number(),
    lng: v.number(),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    if (!(await featureOn(ctx, "directoryUi"))) fail("ERR_VALIDATION", {}, "feature");
    const nameEn = args.nameEn.trim();
    const nameBn = args.nameBn.trim();
    if (nameEn.length < 2 || nameBn.length < 2) fail("ERR_VALIDATION", {}, "name");
    const phone = args.bloodBankPhone?.trim();
    if (phone && !validatePhone(phone).ok && !LANDLINE.test(phone)) {
      fail("ERR_VALIDATION", {}, "bloodBankPhone");
    }
    if (!(args.lat >= 20 && args.lat <= 27 && args.lng >= 88 && args.lng <= 93)) {
      fail("ERR_VALIDATION", {}, "lat"); // Bangladesh bounding box sanity
    }
    const upazila = await ctx.db.get(args.upazilaId);
    if (!upazila || upazila.parentId !== args.districtId) {
      fail("ERR_VALIDATION", {}, "place");
    }
    const searchText = [nameEn, nameBn].join(" ").toLowerCase();

    if (args.hospitalId) {
      const existing = await ctx.db.get(args.hospitalId);
      if (!existing || existing.isDemo !== ctx.profile.isDemo) fail("ERR_NOT_FOUND");
      await ctx.db.patch(args.hospitalId, {
        nameEn,
        nameBn,
        type: args.type,
        divisionId: args.divisionId,
        districtId: args.districtId,
        upazilaId: args.upazilaId,
        address: args.address?.trim() || undefined,
        bloodBankPhone: phone || undefined,
        lat: args.lat,
        lng: args.lng,
        active: args.active,
        searchText: [searchText, ...existing.aliases].join(" "),
      });
      await writeAudit(ctx, {
        actor: ctx.profile,
        action: "directory_updated",
        targetType: "hospital",
        targetId: args.hospitalId,
        meta: { nameEn },
      });
      return { hospitalId: args.hospitalId };
    }
    const hospitalId = await ctx.db.insert("hospitals", {
      nameEn,
      nameBn,
      aliases: [],
      searchText,
      type: args.type,
      divisionId: args.divisionId,
      districtId: args.districtId,
      upazilaId: args.upazilaId,
      address: args.address?.trim() || undefined,
      bloodBankPhone: phone || undefined,
      lat: args.lat,
      lng: args.lng,
      active: args.active,
      isDemo: ctx.profile.isDemo,
    });
    await writeAudit(ctx, {
      actor: ctx.profile,
      action: "directory_created",
      targetType: "hospital",
      targetId: hospitalId,
      meta: { nameEn },
    });
    return { hospitalId };
  },
});
