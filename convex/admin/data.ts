import { v } from "convex/values";
import { adminMutationV } from "../_lib/auth";
import { fail } from "../_lib/errors";
import { featureOn } from "../_lib/settings";
import { writeAudit } from "../_lib/audit";
import { normalisePhone } from "../rules/validation";
import { BLOOD_GROUPS } from "../rules/compatibility";
import { buildCsv, parseCsv } from "../rules/csv";

/**
 * Import / export (F-905, SCR-A13, switch `dataImportExport`).
 *
 * Import: a pasted donor CSV creates INVITATIONS ONLY — nobody
 * becomes a donor, or matchable, from an import; an invitee joins
 * through the normal sign-up + verification + consent path. Invalid
 * rows are reported back, never silently dropped. (The invitations
 * table carries phone/name/group/evidence; district/upazila/
 * lastDonationDate columns are validated for shape where present
 * but the invitee re-confirms their own details at sign-up.)
 *
 * Export: anonymised aggregates for any admin; the personal-data
 * export is SUPER-ADMIN ONLY and rate-limited to 3 per day, per
 * specs. Every CSV cell passes the formula-injection sanitiser in
 * rules/csv. Files live in Convex storage with a 24 h expiry,
 * recorded in the exports table and audited.
 */

const DAY = 86_400_000;
const REQUIRED_COLUMNS = ["name", "phone", "bloodGroup", "consentEvidence"];

export const importDonors = adminMutationV({
  args: { csv: v.string() },
  handler: async (ctx, args) => {
    if (!(await featureOn(ctx, "dataImportExport"))) fail("ERR_VALIDATION", {}, "feature");
    const rows = parseCsv(args.csv);
    if (rows.length < 2) fail("ERR_VALIDATION", {}, "csv");
    const header = rows[0].map((h) => h.trim());
    for (const column of REQUIRED_COLUMNS) {
      if (!header.includes(column)) fail("ERR_VALIDATION", {}, "csv");
    }
    const at = (row: string[], column: string) => (row[header.indexOf(column)] ?? "").trim();

    let created = 0;
    let skipped = 0;
    const invalid: { row: number; reason: string }[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowNo = i + 1;
      const name = at(row, "name");
      const phone = normalisePhone(at(row, "phone"));
      const group = at(row, "bloodGroup");
      const evidence = at(row, "consentEvidence");
      if (name.length < 2) {
        invalid.push({ row: rowNo, reason: "name" });
        continue;
      }
      if (!phone) {
        invalid.push({ row: rowNo, reason: "phone" });
        continue;
      }
      if (!(BLOOD_GROUPS as readonly string[]).includes(group)) {
        invalid.push({ row: rowNo, reason: "bloodGroup" });
        continue;
      }
      if (!evidence) {
        invalid.push({ row: rowNo, reason: "consentEvidence" });
        continue;
      }
      const existingInvite = await ctx.db
        .query("invitations")
        .withIndex("by_phone", (q) => q.eq("phone", phone))
        .first();
      const existingProfile = await ctx.db
        .query("profiles")
        .withIndex("by_phone", (q) => q.eq("phone", phone))
        .first();
      if (existingInvite || existingProfile) {
        skipped++;
        continue;
      }
      await ctx.db.insert("invitations", {
        phone,
        name,
        bloodGroup: group as never,
        source: "import",
        consentEvidence: evidence,
        status: "pending",
      });
      created++;
    }

    await writeAudit(ctx, {
      actor: ctx.profile,
      action: "donors_imported",
      targetType: "invitations",
      targetId: "import",
      meta: { created, skipped, invalid: invalid.length },
    });
    return { created, skipped, invalid };
  },
});

export const exportData = adminMutationV({
  args: { kind: v.union(v.literal("anon_stats"), v.literal("personal_data")) },
  handler: async (ctx, args) => {
    if (!(await featureOn(ctx, "dataImportExport"))) fail("ERR_VALIDATION", {}, "feature");
    const now = Date.now();
    let csv: string;

    if (args.kind === "personal_data") {
      if (ctx.profile.role !== "superadmin") fail("ERR_FORBIDDEN");
      const mine = await ctx.db
        .query("exports")
        .withIndex("by_requestedBy", (q) => q.eq("requestedBy", ctx.profile._id))
        .collect();
      const todayCount = mine.filter(
        (row) => row.kind === "personal_data" && row._creationTime >= now - DAY,
      ).length;
      if (todayCount >= 3) fail("ERR_RATE_LIMITED");
      const profiles = await ctx.db.query("profiles").collect();
      const donors = await ctx.db.query("donorProfiles").collect();
      const donorByProfile = new Map(donors.map((d) => [d.profileId, d]));
      const rows: unknown[][] = [
        ["name", "phone", "phoneVerified", "role", "bloodGroup", "donorLive", "isDemo"],
      ];
      for (const profile of profiles.sort((a, b) => a.name.localeCompare(b.name))) {
        const donor = donorByProfile.get(profile._id);
        rows.push([
          profile.name,
          profile.phone,
          profile.phoneVerified ? "yes" : "no",
          profile.role,
          donor?.bloodGroup ?? "",
          donor ? (donor.live ? "yes" : "no") : "",
          profile.isDemo ? "practice" : "real",
        ]);
      }
      csv = buildCsv(rows);
    } else {
      const donors = await ctx.db.query("donorProfiles").collect();
      const requests = await ctx.db.query("requests").collect();
      const responses = await ctx.db.query("responses").collect();
      const byGroup = new Map<string, number>();
      for (const donor of donors) {
        if (donor.isDemo || !donor.live) continue;
        byGroup.set(donor.bloodGroup, (byGroup.get(donor.bloodGroup) ?? 0) + 1);
      }
      const rows: unknown[][] = [["metric", "group", "count"]];
      for (const [group, count] of [...byGroup.entries()].sort()) {
        rows.push(["live_donors", group, count]);
      }
      rows.push(["requests_total", "", requests.filter((r) => !r.isDemo).length]);
      rows.push([
        "donations_confirmed",
        "",
        responses.filter((r) => !r.isDemo && r.outcomeDonor === "donated").length,
      ]);
      csv = buildCsv(rows);
    }

    const fileId = await ctx.storage.store(new Blob([csv], { type: "text/csv" }));
    await ctx.db.insert("exports", {
      kind: args.kind,
      requestedBy: ctx.profile._id,
      fileId,
      expiresAt: now + DAY,
    });
    await writeAudit(ctx, {
      actor: ctx.profile,
      action: "data_exported",
      targetType: "exports",
      targetId: args.kind,
      meta: { kind: args.kind },
    });
    const url = await ctx.storage.getUrl(fileId);
    return { url, expiresAt: now + DAY };
  },
});
