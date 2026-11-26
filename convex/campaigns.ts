import { v } from "convex/values";
import { adminMutationV, adminQueryV, volunteerQueryV } from "./_lib/auth";
import { fail } from "./_lib/errors";
import { featureOn } from "./_lib/settings";
import { writeAudit } from "./_lib/audit";

/**
 * F-708 campus campaigns (V07) — behind features.campaignStats.
 * Attribution itself is older (profiles.completeOnboarding stores the
 * code when it matches an active campaign); this module is the
 * management + reporting surface: volunteers fetch the active
 * campaigns to show QR/link codes at a drive, admins create/pause
 * campaigns and read per-campaign sign-up counts. A switched-off
 * feature is inert: lists are empty, mutations refuse.
 */

const CODE_PATTERN = /^[a-z0-9][a-z0-9-]{2,23}$/;

/** campaigns.list — volunteers and up: the campaigns they can promote. */
export const list = volunteerQueryV({
  args: {},
  handler: async (ctx) => {
    if (!(await featureOn(ctx, "campaignStats"))) return [];
    const rows = await ctx.db.query("campaigns").collect();
    return rows
      .map((c) => ({
        code: c.code,
        name: c.name,
        institution: c.institution ?? null,
        active: c.active,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
  },
});

/** campaigns.stats — admins: sign-ups + live donors per campaign. */
export const stats = adminQueryV({
  args: {},
  handler: async (ctx) => {
    if (!(await featureOn(ctx, "campaignStats"))) return [];
    const campaigns = await ctx.db.query("campaigns").collect();
    const profiles = (await ctx.db.query("profiles").collect()).filter(
      (p) => !p.isDemo && p.campaignCode,
    );
    const donors = (await ctx.db.query("donorProfiles").collect()).filter(
      (d) => !d.isDemo && d.live,
    );
    const liveDonorIds = new Set(donors.map((d) => d.profileId as string));
    return campaigns
      .map((c) => {
        const signedUp = profiles.filter((p) => p.campaignCode === c.code);
        return {
          code: c.code,
          name: c.name,
          active: c.active,
          signups: signedUp.length,
          donorsLive: signedUp.filter((p) => liveDonorIds.has(p._id as string)).length,
        };
      })
      .sort((a, b) => b.signups - a.signups || a.code.localeCompare(b.code));
  },
});

/** campaigns.create — admins; the code is the QR/link attribution key. */
export const create = adminMutationV({
  args: {
    code: v.string(),
    name: v.string(),
    institution: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!(await featureOn(ctx, "campaignStats"))) fail("ERR_VALIDATION", {}, "feature");
    const code = args.code.trim().toLowerCase();
    if (!CODE_PATTERN.test(code)) fail("ERR_VALIDATION", {}, "code");
    const name = args.name.trim();
    if (name.length < 3 || name.length > 80) fail("ERR_VALIDATION", {}, "name");
    const existing = await ctx.db
      .query("campaigns")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (existing) fail("ERR_VALIDATION", {}, "code");
    const id = await ctx.db.insert("campaigns", {
      code,
      name,
      institution: args.institution?.trim() || undefined,
      active: true,
    });
    await writeAudit(ctx, {
      actor: ctx.profile,
      action: "campaign_created",
      targetType: "campaign",
      targetId: id,
      meta: { code },
    });
    return { campaignId: id };
  },
});

/** campaigns.setActive — pause/resume a campaign (attribution stops). */
export const setActive = adminMutationV({
  args: { code: v.string(), active: v.boolean() },
  handler: async (ctx, args) => {
    if (!(await featureOn(ctx, "campaignStats"))) fail("ERR_VALIDATION", {}, "feature");
    const campaign = await ctx.db
      .query("campaigns")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .unique();
    if (!campaign) fail("ERR_NOT_FOUND");
    await ctx.db.patch(campaign!._id, { active: args.active });
    await writeAudit(ctx, {
      actor: ctx.profile,
      action: "campaign_toggled",
      targetType: "campaign",
      targetId: campaign!._id,
      meta: { code: args.code, active: args.active },
    });
    return { ok: true as const };
  },
});
