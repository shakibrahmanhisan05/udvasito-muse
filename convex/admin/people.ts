import { v } from "convex/values";
import type { GenericQueryCtx } from "convex/server";
import type { DataModel, Doc, Id } from "../schemaTypes";
import { adminMutationV, adminQueryV, type Profile } from "../_lib/auth";
import { fail } from "../_lib/errors";
import { writeAudit } from "../_lib/audit";
import { notifyUser } from "../_lib/notify";
import { recordContactReveal } from "../_lib/visibility";
import { refreshDonorLive } from "../_lib/donorLive";
import { eqRange } from "../_lib/db";
import { ageOn } from "../rules/eligibility";
import { validateReason } from "../rules/validation";

/**
 * Admin people (specs §6.4, roadmap P3: F-903 + F-805, SCR-A04/A05).
 * Every payload here is phone-free — the ONLY way an admin sees a number
 * is `revealPhone`, which demands a typed reason (VAL-18), writes the
 * §6.9 `admin_phone_revealed` audit entry and runs the S-24 volume-flag
 * check inside _lib/visibility. Role and status changes are always
 * audit-logged with their reason; the last admin can never be removed.
 */

type QCtx = GenericQueryCtx<DataModel>;

async function targetOf(ctx: QCtx, caller: Profile, profileId: Id<"profiles">) {
  const target = await ctx.db.get(profileId);
  if (!target || target!.isDemo !== caller.isDemo) fail("ERR_NOT_FOUND");
  return target!;
}

async function donorOf(ctx: QCtx, profileId: Id<"profiles">) {
  return await ctx.db
    .query("donorProfiles")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId))
    .unique();
}

async function volunteerOf(ctx: QCtx, profileId: Id<"profiles">) {
  return await ctx.db
    .query("volunteerProfiles")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId))
    .unique();
}

/** The public shape of a person in admin lists — never a phone number. */
function personSummary(profile: Doc<"profiles">, donor: Doc<"donorProfiles"> | null) {
  return {
    profileId: profile._id,
    name: profile.name,
    firstName: profile.firstName,
    role: profile.role,
    status: profile.status,
    phoneVerified: profile.phoneVerified,
    donorGroup: donor?.bloodGroup ?? null,
    joinedAt: profile._creationTime,
    isDemo: profile.isDemo,
  };
}

/**
 * admin.people.applications (specs §6.4, SCR-A04): volunteer
 * applications, pending first, with the applicant's areas and
 * motivation for the reviewer. Phone-free (verified shown as a flag).
 */
export const applications = adminQueryV({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("volunteerProfiles")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    const rest = (
      await Promise.all(
        (["approved", "rejected", "revoked"] as const).map(
          async (status) =>
            await ctx.db
              .query("volunteerProfiles")
              .withIndex("by_status", (q) => q.eq("status", status))
              .collect(),
        ),
      )
    ).flat();
    const mine = [...rows, ...rest].filter((vp) => vp.isDemo === ctx.profile.isDemo);
    const out = [];
    for (const vp of mine) {
      const applicant = await ctx.db.get(vp.profileId);
      if (!applicant) continue;
      const areaNames: string[] = [];
      for (const id of [...vp.upazilaIds, ...vp.districtIds]) {
        const place = await ctx.db.get(id);
        if (place) areaNames.push(place.nameEn);
      }
      out.push({
        volunteerProfileId: vp._id,
        profileId: applicant._id,
        name: applicant.name,
        status: vp.status,
        areaNames,
        institution: vp.institution,
        motivation: vp.motivation,
        phoneVerified: applicant.phoneVerified,
        appliedAt: vp._creationTime,
        reviewReason: vp.reviewReason,
      });
    }
    return out;
  },
});

/**
 * admin.people.reviewVolunteer (specs §6.4, F-903): approve / reject /
 * revoke a volunteer application. Approval grants the `volunteer` role;
 * revocation takes it back. The applicant is notified (NTF-15) and the
 * decision is audit-logged (`volunteer_reviewed`).
 */
export const reviewVolunteer = adminMutationV({
  args: {
    volunteerProfileId: v.id("volunteerProfiles"),
    decision: v.union(v.literal("approve"), v.literal("reject"), v.literal("revoke")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const vp = await ctx.db.get(args.volunteerProfileId);
    if (!vp || vp!.isDemo !== ctx.profile.isDemo) fail("ERR_NOT_FOUND");
    if (args.decision !== "approve") {
      if (!args.reason) fail("ERR_VALIDATION", {}, "reason");
      const check = validateReason(args.reason);
      if (!check.ok) fail("ERR_VALIDATION", {}, check.field);
    }
    const applicant = await ctx.db.get(vp!.profileId);
    if (!applicant) fail("ERR_NOT_FOUND");
    const now = Date.now();
    if (args.decision === "approve") {
      if (vp!.status === "approved") return null; // idempotent
      await ctx.db.patch(vp!._id, {
        status: "approved",
        reviewedBy: ctx.profile._id,
        reviewedAt: now,
        reviewReason: undefined,
      });
      if (applicant!.role === "member") {
        await ctx.db.patch(applicant!._id, { role: "volunteer" });
      }
    } else {
      const status = args.decision === "reject" ? "rejected" : "revoked";
      await ctx.db.patch(vp!._id, {
        status,
        onDuty: false,
        reviewedBy: ctx.profile._id,
        reviewedAt: now,
        reviewReason: args.reason!.trim(),
      });
      if (args.decision === "revoke" && applicant!.role === "volunteer") {
        await ctx.db.patch(applicant!._id, { role: "member" });
      }
    }
    await writeAudit(ctx, {
      actor: ctx.profile,
      action: "volunteer_reviewed",
      targetType: "volunteerProfiles",
      targetId: vp!._id,
      reason: args.reason,
      meta: { decision: args.decision },
    });
    await notifyUser(ctx, {
      recipient: applicant!,
      template: "NTF-15",
      params: {},
      url: "/volunteer",
      channelId: "updates",
      variant: args.decision === "approve" ? undefined : "rejected",
    });
    return null;
  },
});

/**
 * admin.people.search (specs §6.4, SCR-A04): find people by name or
 * internal ID — deliberately NOT by phone (prevents directory use).
 */
export const search = adminQueryV({
  args: { text: v.string() },
  handler: async (ctx, args) => {
    const text = args.text.trim();
    if (!text) return [];
    const byId = await ctx.db.get(text as Id<"profiles">).catch(() => null);
    const everyone = await ctx.db.query("profiles").collect();
    const matches = everyone.filter(
      (p) =>
        p.isDemo === ctx.profile.isDemo &&
        (p._id === byId?._id || p.name.toLowerCase().includes(text.toLowerCase())),
    );
    const out = [];
    for (const profile of matches.slice(0, 50)) {
      out.push(personSummary(profile, await donorOf(ctx, profile._id)));
    }
    return out;
  },
});

/**
 * admin.people.get (specs §6.4, SCR-A05): person detail — age, never the
 * full date of birth; phone hidden (see revealPhone). Includes donor /
 * volunteer summaries, activity counts and consent records.
 */
export const get = adminQueryV({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args) => {
    const target = await targetOf(ctx, ctx.profile, args.profileId);
    const donor = await donorOf(ctx, target._id);
    const volunteer = await volunteerOf(ctx, target._id);
    const requests = await ctx.db
      .query("requests")
      .withIndex("by_requester_status", eqRange([["requesterId", target._id]]))
      .collect();
    const responses = await ctx.db
      .query("responses")
      .withIndex("by_donor_state", eqRange([["donorId", target._id]]))
      .collect();
    const reports = await ctx.db
      .query("reports")
      .withIndex("by_subject", (q) => q.eq("subjectId", target._id))
      .collect();
    const consents = await ctx.db
      .query("consents")
      .withIndex("by_profile_kind", eqRange([["profileId", target._id]]))
      .collect();
    return {
      profileId: target._id,
      name: target.name,
      firstName: target.firstName,
      age: ageOn(target.dateOfBirth, Date.now()),
      role: target.role,
      status: target.status,
      statusReason: target.statusReason,
      language: target.language,
      joinedAt: target._creationTime,
      phoneVerified: target.phoneVerified,
      donor: donor
        ? {
            bloodGroup: donor.bloodGroup,
            live: donor.live,
            eligibleFrom: donor.eligibleFrom,
            availability: donor.availability,
            volunteersMayCall: donor.volunteersMayCall,
          }
        : null,
      volunteer: volunteer
        ? { status: volunteer.status, onDuty: volunteer.onDuty, activeClaims: volunteer.activeClaims }
        : null,
      counts: {
        requests: requests.length,
        responses: responses.length,
        reportsAbout: reports.length,
      },
      consents: consents.map((c) => ({
        kind: c.kind,
        version: c.version,
        acceptedAt: c.acceptedAt,
      })),
    };
  },
});

/**
 * admin.people.setRole (specs §6.4, F-903): change a person's role.
 * Granting admin/super-admin is super-admin only; the last remaining
 * admin (or super-admin) can never be demoted (ERR_LAST_ADMIN). Every
 * change is audit-logged with its reason (VAL-18).
 */
export const setRole = adminMutationV({
  args: {
    profileId: v.id("profiles"),
    role: v.union(
      v.literal("member"), v.literal("volunteer"),
      v.literal("admin"), v.literal("superadmin"),
    ),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const check = validateReason(args.reason);
    if (!check.ok) fail("ERR_VALIDATION", {}, check.field);
    const target = await targetOf(ctx, ctx.profile, args.profileId);
    if (
      (args.role === "admin" || args.role === "superadmin") &&
      ctx.profile.role !== "superadmin"
    ) {
      fail("ERR_FORBIDDEN");
    }
    const targetIsAdmin = target.role === "admin" || target.role === "superadmin";
    const staysAdmin = args.role === "admin" || args.role === "superadmin";
    if (targetIsAdmin && !staysAdmin) {
      const admins = (
        await Promise.all(
          (["admin", "superadmin"] as const).map(
            async (roleName) =>
              await ctx.db
                .query("profiles")
                .withIndex("by_role", (q) => q.eq("role", roleName))
                .collect(),
          ),
        )
      )
        .flat()
        .filter((p) => p.isDemo === ctx.profile.isDemo && p._id !== target._id);
      if (admins.length === 0) fail("ERR_LAST_ADMIN");
    }
    await ctx.db.patch(target._id, { role: args.role });
    if (target.role === "volunteer" && args.role !== "volunteer") {
      // A demoted volunteer stops being shown on duty immediately.
      const vp = await volunteerOf(ctx, target._id);
      if (vp && vp.onDuty) await ctx.db.patch(vp._id, { onDuty: false });
    }
    await writeAudit(ctx, {
      actor: ctx.profile,
      action: "role_changed",
      targetType: "profiles",
      targetId: target._id,
      reason: args.reason.trim(),
      meta: { from: target.role, to: args.role },
    });
    return null;
  },
});

/**
 * admin.people.setStatus (specs §6.4, F-903): suspend / ban / freeze /
 * restore with a reason (VAL-18); the person is notified (NTF-14) and
 * the change is audit-logged (`status_changed`).
 */
export const setStatus = adminMutationV({
  args: {
    profileId: v.id("profiles"),
    status: v.union(
      v.literal("active"), v.literal("frozen"),
      v.literal("suspended"), v.literal("banned"),
    ),
    reason: v.string(),
    until: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const check = validateReason(args.reason);
    if (!check.ok) fail("ERR_VALIDATION", {}, check.field);
    const target = await targetOf(ctx, ctx.profile, args.profileId);
    if (args.status === "suspended" && (args.until === undefined || args.until <= Date.now())) {
      fail("ERR_VALIDATION", {}, "until");
    }
    await ctx.db.patch(target._id, {
      status: args.status,
      statusReason: args.reason.trim(),
      statusUntil: args.status === "suspended" ? args.until : undefined,
    });
    if (args.status !== "active") {
      const vp = await volunteerOf(ctx, target._id);
      if (vp && vp.onDuty) await ctx.db.patch(vp._id, { onDuty: false });
    }
    const donor = await donorOf(ctx, target._id);
    if (donor) {
      const fresh = await ctx.db.get(target._id);
      if (fresh) await refreshDonorLive(ctx, fresh, donor);
    }
    await writeAudit(ctx, {
      actor: ctx.profile,
      action: "status_changed",
      targetType: "profiles",
      targetId: target._id,
      reason: args.reason.trim(),
      meta: { status: args.status },
    });
    const actionText =
      args.status === "active"
        ? "Account restored"
        : args.status === "frozen"
          ? "Account frozen"
          : args.status === "suspended"
            ? "Account suspended"
            : "Account banned";
    await notifyUser(ctx, {
      recipient: target,
      template: "NTF-14",
      params: { action: actionText, reason: args.reason.trim() },
      url: "/account-status",
      channelId: "updates",
    });
    return null;
  },
});

/**
 * admin.people.revealPhone 📞 (specs §6.4, F-805/A14): the ONLY admin
 * path to a person's number. A typed reason is required (VAL-18); the
 * reveal is logged (`admin_phone_revealed`) and counted by the S-24
 * volume-flag check — all inside _lib/visibility. A person-level
 * reveal has no request context, so the reveal row carries none.
 */
export const revealPhone = adminMutationV({
  args: { profileId: v.id("profiles"), reason: v.string() },
  handler: async (ctx, args) => {
    const check = validateReason(args.reason);
    if (!check.ok) fail("ERR_VALIDATION", {}, check.field);
    const target = await targetOf(ctx, ctx.profile, args.profileId);
    const donor = await donorOf(ctx, target._id);
    const volunteer = await volunteerOf(ctx, target._id);
    const subjectRole = donor
      ? "donor"
      : volunteer?.status === "approved"
        ? "volunteer"
        : "requester";
    const phone = await recordContactReveal(ctx, {
      viewer: ctx.profile,
      subject: target,
      subjectRole,
      reason: "admin_reveal",
      reasonText: args.reason.trim(),
      auditAction: "admin_phone_revealed",
      // Person-level reveals are momentary lookups, not a viewing window.
      expiresAt: Date.now(),
      isDemo: target.isDemo,
    });
    return { phone };
  },
});

/**
 * admin.people.revokeVerification (specs §6.4): undo a phone
 * verification (e.g. a number changed hands). Donor `live` is
 * recomputed; the person is notified (NTF-14); audit-logged.
 */
export const revokeVerification = adminMutationV({
  args: { profileId: v.id("profiles"), reason: v.string() },
  handler: async (ctx, args) => {
    const check = validateReason(args.reason);
    if (!check.ok) fail("ERR_VALIDATION", {}, check.field);
    const target = await targetOf(ctx, ctx.profile, args.profileId);
    await ctx.db.patch(target._id, {
      phoneVerified: false,
      phoneVerifiedAt: undefined,
      phoneVerifiedVia: undefined,
      phoneVerifiedBy: undefined,
    });
    const donor = await donorOf(ctx, target._id);
    if (donor) {
      const fresh = await ctx.db.get(target._id);
      if (fresh) await refreshDonorLive(ctx, fresh, donor);
    }
    await writeAudit(ctx, {
      actor: ctx.profile,
      action: "phone_verification_revoked",
      targetType: "profiles",
      targetId: target._id,
      reason: args.reason.trim(),
    });
    await notifyUser(ctx, {
      recipient: target,
      template: "NTF-14",
      params: { action: "Phone verification removed", reason: args.reason.trim() },
      url: "/account-status",
      channelId: "updates",
    });
    return null;
  },
});
