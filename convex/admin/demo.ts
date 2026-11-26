import {
  actionGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
  type GenericActionCtx,
} from "convex/server";
import { v } from "convex/values";
import { hashPassword } from "better-auth/crypto";
import { adminMutationV, adminQueryV, assertActive, assertRole } from "../_lib/auth";
import { fail } from "../_lib/errors";
import { getSetting } from "../_lib/settings";
import { writeAudit } from "../_lib/audit";
import { recordEvent } from "../_lib/events";
import { funnelFromRows } from "../rules/stats";
import {
  generatePin,
  isValidPin,
  nextPracticeId,
  practiceEmailFor,
} from "../_lib/practice";
import { createAuth } from "../auth";
import type { Doc, Id } from "../schemaTypes";

/**
 * Practice area controls (specs §6.4, F-912, SCR-A09; D-R4). The
 * practice area is the LIVE system walled to practice accounts
 * (isDemo) — same code paths, real notifications, real AI — so a
 * rehearsal never touches a real donor (specs §3 P-10).
 *
 * Accounts: a super-admin creates an account here; the data half
 * (preparePracticeAccount) writes the isDemo profile with a
 * placeholder authUserId, then the ACTION creates the real Better
 * Auth user (email <id>@practice.udvasito.invalid, password = the
 * generated 6-digit PIN) and links it. The PIN is returned exactly
 * once and never stored. The person then signs in on a real device
 * with their REAL phone number (onboarding patches the prepared
 * profile in place — isDemo/practiceId survive) and verifies it via
 * the normal Telegram/in-person flow. No fake accounts exist.
 *
 * The Better Auth component is not registered in the convex-test
 * harness, so the auth-user calls themselves are verified by the
 * human staging steps; everything around them (prepare, link, gate,
 * reset, isolation) is unit-tested.
 */

const MAX_ACCOUNTS = 10;
const GATE_WINDOW_MS = 15 * 60_000;
const GATE_MAX_ATTEMPTS = 5;

const callerProfileRef = makeFunctionReference("admin/demo:callerProfile");
const prepareRef = makeFunctionReference("admin/demo:preparePracticeAccount");
const linkRef = makeFunctionReference("admin/demo:linkPracticeAccount");
const deleteDataRef = makeFunctionReference("admin/demo:deletePracticeAccountData");
const accountByIdRef = makeFunctionReference("admin/demo:accountById");
const recordPinResetRef = makeFunctionReference("admin/demo:recordPinReset");
const revokeSessionsRef = makeFunctionReference<"action">("admin/demo:revokePracticeSessions");

type InternalAdapterLike = {
  updatePassword: (userId: string, hash: string) => Promise<void>;
  deleteSessions: (userId: string) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
};

async function internalAdapter(ctx: Parameters<typeof createAuth>[0]): Promise<InternalAdapterLike> {
  const authCtx = await createAuth(ctx).$context;
  return (authCtx as unknown as { internalAdapter: InternalAdapterLike }).internalAdapter;
}

function cryptoPin(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return generatePin(() => buf[0] / 4_294_967_296);
}

// ── Shared lookups (internal) ──────────────────────────────────────

export const callerProfile = internalQueryGeneric({
  args: { authUserId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("profiles")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", args.authUserId))
      .unique();
  },
});

export const accountById = internalQueryGeneric({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args) => await ctx.db.get(args.profileId),
});

async function findPracticeProfile(
  ctx: { db: import("convex/server").GenericDatabaseReader<import("../schemaTypes").DataModel> },
  practiceId: string,
) {
  const rows = await ctx.db
    .query("profiles")
    .filter((q) => q.and(q.eq(q.field("practiceId"), practiceId), q.eq(q.field("isDemo"), true)))
    .take(2);
  return rows[0] ?? null;
}

export const practiceById = internalQueryGeneric({
  args: { practiceId: v.string() },
  handler: async (ctx, args) => await findPracticeProfile(ctx, args.practiceId),
});

// ── SCR-A09 status ─────────────────────────────────────────────────

export const status = adminQueryV({
  args: {},
  handler: async (ctx) => {
    const enabled = (await getSetting(ctx, "demoAreaEnabled")) as boolean;
    // Practice accounts are ≤10; the profiles scan is bounded and this
    // is an admin screen (same trade-off as admin.people.search).
    const practiceProfiles = (
      await ctx.db.query("profiles").filter((q) => q.eq(q.field("isDemo"), true)).take(500)
    ).filter((p) => p.practiceId);
    const accounts = [];
    for (const profile of practiceProfiles) {
      const donor = await ctx.db
        .query("donorProfiles")
        .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
        .unique();
      accounts.push({
        profileId: profile._id,
        practiceId: profile.practiceId!,
        name: profile.name,
        role: profile.role,
        donorGroup: donor && donor.bloodGroup !== "unknown" ? donor.bloodGroup : null,
        phoneStatus: profile.phoneVerified
          ? ("verified" as const)
          : profile.authUserId.startsWith("practice:")
            ? ("not_signed_in" as const)
            : ("not_verified" as const),
        lastActiveAt: profile.lastActiveAt,
      });
    }
    accounts.sort((a, b) => a.practiceId.localeCompare(b.practiceId));
    const hospitals = await ctx.db
      .query("hospitals")
      .filter((q) => q.eq(q.field("isDemo"), true))
      .take(5);
    const hospital = hospitals[0] ?? null;

    // Practice funnel, computed live from isDemo rows only — it is
    // NEVER part of the real statsSnapshots (specs §6.4, SCR-A09 (6)).
    const requests = await ctx.db.query("requests").filter((q) => q.eq(q.field("isDemo"), true)).take(2000);
    const responses = await ctx.db.query("responses").filter((q) => q.eq(q.field("isDemo"), true)).take(4000);
    const reveals = await ctx.db.query("contactReveals").filter((q) => q.eq(q.field("isDemo"), true)).take(4000);
    const funnel = funnelFromRows(
      requests.map((r) => ({ id: r._id as string })),
      responses,
      new Set(reveals.map((r) => r.requestId as string)),
    );
    return {
      enabled,
      accounts,
      hospital: hospital
        ? { hospitalId: hospital._id, nameEn: hospital.nameEn, nameBn: hospital.nameBn }
        : null,
      funnel,
    };
  },
});

// ── On/off switch ──────────────────────────────────────────────────

export const setEnabled = adminMutationV({
  args: { enabled: v.boolean() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "demoAreaEnabled"))
      .unique();
    if (row) await ctx.db.patch(row._id, { value: args.enabled });
    else await ctx.db.insert("settings", { key: "demoAreaEnabled", value: args.enabled });
    await writeAudit(ctx, {
      actor: ctx.profile,
      action: "setting_changed",
      targetType: "settings",
      targetId: "demoAreaEnabled",
      meta: { enabled: args.enabled },
    });
    if (!args.enabled) {
      // Turning the area off also ends live practice sessions
      // (best-effort internal action; the sign-in gate refuses new
      // sessions regardless).
      await ctx.scheduler.runAfter(0, revokeSessionsRef, {});
    }
    return { enabled: args.enabled };
  },
});

/** Provisioned practice auth users (for session revocation). */
export const practiceAuthUsers = internalQueryGeneric({
  args: {},
  handler: async (ctx) => {
    const rows = (await ctx.db.query("profiles").filter((q) => q.eq(q.field("isDemo"), true)).take(500))
      .filter((p) => p.practiceId && !p.authUserId.startsWith("practice:"));
    return rows.map((p) => ({ authUserId: p.authUserId }));
  },
});

const practiceAuthUsersRef = makeFunctionReference("admin/demo:practiceAuthUsers");

/**
 * Best-effort session revocation for every provisioned practice user
 * (scheduled by setEnabled when the area is turned off). The sign-in
 * gate refuses new sessions regardless, so a failure here is not
 * fatal — it is swallowed per user.
 */
export const revokePracticeSessions = internalActionGeneric({
  args: {},
  handler: async (ctx) => {
    try {
      const users = (await ctx.runQuery(practiceAuthUsersRef as never, {} as never)) as { authUserId: string }[];
      const adapter = await internalAdapter(ctx);
      for (const user of users) {
        try {
          await adapter.deleteSessions(user.authUserId);
        } catch {
          // Best effort per user — see doc comment.
        }
      }
    } catch {
      // Auth env not configured (e.g. local dev) — nothing to revoke.
    }
    return { ok: true };
  },
});

// ── One-click reset (practice data only) ───────────────────────────

const RESETTABLE = ["requests", "responses", "notifications", "contactReveals", "events"] as const;

export const reset = adminMutationV({
  args: {},
  handler: async (ctx) => {
    const counts: Record<string, number> = {};
    for (const table of RESETTABLE) {
      const rows = await ctx.db.query(table).filter((q) => q.eq(q.field("isDemo"), true)).collect();
      for (const row of rows) await ctx.db.delete(row._id);
      counts[table] = rows.length;
    }
    await writeAudit(ctx, {
      actor: ctx.profile,
      action: "demo_reset",
      targetType: "demo",
      targetId: "practice-area",
      meta: counts,
    });
    return counts;
  },
});

// ── Account provisioning (data half; called by the actions) ───────

async function ensurePracticeHospital(
  ctx: { db: import("convex/server").GenericDatabaseWriter<import("../schemaTypes").DataModel> },
): Promise<Doc<"hospitals"> | null> {
  const existing = await ctx.db
    .query("hospitals")
    .filter((q) => q.eq(q.field("isDemo"), true))
    .take(1);
  if (existing[0]) return existing[0];
  const districts = await ctx.db
    .query("places")
    .withIndex("by_level_parent", (q) => q.eq("level", "district"))
    .collect();
  if (districts.length === 0) return null;
  const district = districts.find((d) => d.nameEn.includes("Chattogram")) ?? districts[0];
  const upazilas = await ctx.db
    .query("places")
    .withIndex("by_level_parent", (q) => q.eq("level", "upazila").eq("parentId", district._id))
    .collect();
  const upazila = upazilas[0];
  if (!upazila || !district.parentId) return null;
  const hospitalId = await ctx.db.insert("hospitals", {
    nameEn: "UDVASITO Practice Hospital",
    nameBn: "উদ্ভাসিত অনুশীলন হাসপাতাল",
    aliases: ["Practice Hospital"],
    searchText: "udvasito practice hospital",
    type: "hospital",
    divisionId: district.parentId,
    districtId: district._id,
    upazilaId: upazila._id,
    lat: district.lat,
    lng: district.lng,
    active: true,
    isDemo: true,
  });
  return await ctx.db.get(hospitalId);
}

export const preparePracticeAccount = internalMutationGeneric({
  args: {
    actorId: v.id("profiles"),
    name: v.string(),
    role: v.union(v.literal("member"), v.literal("volunteer"), v.literal("admin")),
    donorGroup: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorId);
    if (!actor || actor.role !== "superadmin" || actor.isDemo) fail("ERR_FORBIDDEN");
    const name = args.name.trim();
    if (name.length < 2) fail("ERR_VALIDATION", {}, "name");

    const existing = (
      await ctx.db.query("profiles").filter((q) => q.eq(q.field("isDemo"), true)).take(500)
    ).filter((p) => p.practiceId);
    if (existing.length >= MAX_ACCOUNTS) fail("ERR_VALIDATION", { limit: MAX_ACCOUNTS });
    const practiceId = nextPracticeId(existing.map((p) => p.practiceId!));
    if (!practiceId) fail("ERR_VALIDATION", { limit: MAX_ACCOUNTS });

    const hospital = await ensurePracticeHospital(ctx);
    const consentVersion = (await getSetting(ctx, "consentVersion")) as string;
    const profileId = await ctx.db.insert("profiles", {
      authUserId: `practice:${practiceId}`,
      name,
      firstName: name.split(/\s+/)[0],
      dateOfBirth: "1990-01-01",
      language: "en",
      role: args.role,
      phone: "",
      phoneVerified: false,
      practiceId,
      status: "active",
      consentVersion,
      lastActiveAt: Date.now(),
      isDemo: true,
    });
    if (args.donorGroup && hospital) {
      const alertCap = (await getSetting(ctx, "donorAlertCapPerDay")) as number;
      await ctx.db.insert("donorProfiles", {
        profileId,
        bloodGroup: args.donorGroup as Doc<"donorProfiles">["bloodGroup"],
        gender: "unspecified",
        divisionId: hospital.divisionId,
        districtId: hospital.districtId,
        upazilaId: hospital.upazilaId,
        travelRange: "district",
        neverDonated: true,
        plateletOptIn: false,
        availability: "available",
        availabilityConfirmedAt: Date.now(),
        eligibleFrom: 0,
        eligibleFromPlatelets: 0,
        callMode: "mutual",
        volunteersMayCall: false,
        verifiedRequestsOnly: false,
        alertCapPerDay: alertCap,
        quietStart: "00:00",
        quietEnd: "07:00",
        urgentOverride: false,
        hidden: false,
        // Not live until the person signs in with a real phone and
        // verifies it — the derived flag is recomputed on every change.
        live: false,
        selfCheckAt: Date.now(),
        healthConsentVersion: consentVersion,
        noShowAt: [],
        isDemo: true,
      });
    }
    await writeAudit(ctx, {
      actor,
      action: "demo_account_created",
      targetType: "profiles",
      targetId: profileId,
      meta: { practiceId, role: args.role },
    });
    return { profileId, practiceId };
  },
});

export const linkPracticeAccount = internalMutationGeneric({
  args: { profileId: v.id("profiles"), authUserId: v.string() },
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.profileId);
    if (!profile || !profile.isDemo) fail("ERR_NOT_FOUND");
    if (profile.authUserId !== args.authUserId) {
      await ctx.db.patch(args.profileId, { authUserId: args.authUserId, lastActiveAt: Date.now() });
    }
    return { ok: true };
  },
});

/** Deletes a practice profile and every row it owns (rollback + removal). */
export const deletePracticeAccountData = internalMutationGeneric({
  args: { profileId: v.id("profiles"), actorId: v.optional(v.id("profiles")) },
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.profileId);
    if (!profile || !profile.isDemo) fail("ERR_NOT_FOUND");
    const donors = await ctx.db.query("donorProfiles").withIndex("by_profile", (q) => q.eq("profileId", args.profileId)).collect();
    for (const row of donors) await ctx.db.delete(row._id);
    const volunteers = await ctx.db.query("volunteerProfiles").withIndex("by_profile", (q) => q.eq("profileId", args.profileId)).collect();
    for (const row of volunteers) await ctx.db.delete(row._id);
    const consents = await ctx.db.query("consents").withIndex("by_profile_kind", (q) => q.eq("profileId", args.profileId)).collect();
    for (const row of consents) await ctx.db.delete(row._id);
    const verifications = await ctx.db.query("phoneVerifications").withIndex("by_profile", (q) => q.eq("profileId", args.profileId)).collect();
    for (const row of verifications) await ctx.db.delete(row._id);
    await ctx.db.delete(args.profileId);
    if (args.actorId) {
      const actor = await ctx.db.get(args.actorId);
      await writeAudit(ctx, {
        actor,
        // Not in the §6.9 list — flagged in the P5 report as a small
        // extension; an unaudited account deletion would be worse.
        action: "demo_account_removed",
        targetType: "profiles",
        targetId: args.profileId,
        meta: { practiceId: profile.practiceId ?? null },
      });
    }
    return { ok: true };
  },
});

export const recordPinReset = internalMutationGeneric({
  args: { profileId: v.id("profiles"), actorId: v.id("profiles") },
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.profileId);
    if (!profile || !profile.isDemo) fail("ERR_NOT_FOUND");
    const actor = await ctx.db.get(args.actorId);
    await writeAudit(ctx, {
      actor,
      action: "demo_pin_reset",
      targetType: "profiles",
      targetId: args.profileId,
      meta: { practiceId: profile.practiceId ?? null },
    });
    return { ok: true };
  },
});

// ── Sign-in gate (D-R4: 5 wrong PINs → 15-minute lock) ────────────

async function gateState(
  ctx: { db: import("convex/server").GenericDatabaseReader<import("../schemaTypes").DataModel> },
  practiceId: string,
) {
  const now = Date.now();
  const attempts = await ctx.db.query("events").withIndex("by_name", (q) => q.eq("name", "practice_signin_attempt")).collect();
  const successes = await ctx.db.query("events").withIndex("by_name", (q) => q.eq("name", "practice_signin_success")).collect();
  const mine = (rows: Doc<"events">[]) =>
    rows.filter((r) => (r.props as { practiceId?: string } | undefined)?.practiceId === practiceId);
  const lastSuccessAt = mine(successes).reduce((max, r) => Math.max(max, r._creationTime), 0);
  const windowStart = Math.max(now - GATE_WINDOW_MS, lastSuccessAt);
  const recentAttempts = mine(attempts).filter((r) => r._creationTime > windowStart).length;
  return { attempts: recentAttempts, locked: recentAttempts >= GATE_MAX_ATTEMPTS };
}

export const gateCheck = internalQueryGeneric({
  args: { practiceId: v.string() },
  handler: async (ctx, args) => {
    const profile = await findPracticeProfile(ctx, args.practiceId);
    const enabled = (await getSetting(ctx, "demoAreaEnabled")) as boolean;
    const gate = await gateState(ctx, args.practiceId);
    return { exists: profile !== null, enabled, locked: gate.locked, attempts: gate.attempts };
  },
});

export const gateAttempt = internalMutationGeneric({
  args: { practiceId: v.string() },
  handler: async (ctx, args) => {
    await recordEvent(ctx, "practice_signin_attempt", { props: { practiceId: args.practiceId }, isDemo: true });
    return { ok: true };
  },
});

export const gateSuccess = internalMutationGeneric({
  args: { practiceId: v.string() },
  handler: async (ctx, args) => {
    await recordEvent(ctx, "practice_signin_success", { props: { practiceId: args.practiceId }, isDemo: true });
    return { ok: true };
  },
});

// ── Actions (super-admin; own the Better Auth user lifecycle) ─────

async function requireSuperadmin(ctx: GenericActionCtx<import("../schemaTypes").DataModel>): Promise<Doc<"profiles">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) fail("ERR_UNAUTHENTICATED");
  const profile = (await ctx.runQuery(callerProfileRef as never, { authUserId: identity!.subject } as never)) as Doc<"profiles"> | null;
  if (!profile) fail("ERR_UNAUTHENTICATED");
  assertActive(profile!);
  assertRole(profile!, ["superadmin"]);
  if (profile!.isDemo) fail("ERR_FORBIDDEN");
  return profile!;
}

export const createAccount = actionGeneric({
  args: {
    name: v.string(),
    role: v.union(v.literal("member"), v.literal("volunteer"), v.literal("admin")),
    donorGroup: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperadmin(ctx);
    if (process.env.BETTER_AUTH_EMAIL_ENABLED !== "1") {
      // Honest failure: without email+password enabled in the Convex
      // env, no practice credential can exist (human setup step).
      fail("ERR_METHOD_DISABLED");
    }
    const pin = cryptoPin();
    if (!isValidPin(pin)) fail("ERR_INTERNAL");
    const prepared = (await ctx.runMutation(prepareRef as never, {
      actorId: actor._id,
      name: args.name,
      role: args.role,
      donorGroup: args.donorGroup,
    } as never)) as { profileId: Id<"profiles">; practiceId: string };
    try {
      const result = await createAuth(ctx).api.signUpEmail({
        body: { email: practiceEmailFor(prepared.practiceId), password: pin, name: args.name.trim() },
      });
      const authUserId = (result as { user: { id: string } }).user.id;
      await ctx.runMutation(linkRef as never, { profileId: prepared.profileId, authUserId } as never);
    } catch (error) {
      // Roll the data half back so a failed provisioning leaves nothing.
      await ctx.runMutation(deleteDataRef as never, { profileId: prepared.profileId } as never);
      throw error;
    }
    // The PIN is returned exactly once and never stored anywhere.
    return { practiceId: prepared.practiceId, pin };
  },
});

export const newPin = actionGeneric({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args) => {
    const actor = await requireSuperadmin(ctx);
    const profile = (await ctx.runQuery(accountByIdRef as never, { profileId: args.profileId } as never)) as Doc<"profiles"> | null;
    if (!profile || !profile.isDemo || !profile.practiceId) fail("ERR_NOT_FOUND");
    if (profile.authUserId.startsWith("practice:")) {
      // No auth user yet — nothing to re-PIN (provisioning incomplete).
      fail("ERR_VALIDATION", {}, "authUserId");
    }
    const pin = cryptoPin();
    const adapter = await internalAdapter(ctx);
    await adapter.updatePassword(profile.authUserId, await hashPassword(pin));
    await adapter.deleteSessions(profile.authUserId);
    await ctx.runMutation(recordPinResetRef as never, { profileId: args.profileId, actorId: actor._id } as never);
    return { practiceId: profile.practiceId, pin };
  },
});

export const removeAccount = actionGeneric({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args) => {
    const actor = await requireSuperadmin(ctx);
    const profile = (await ctx.runQuery(accountByIdRef as never, { profileId: args.profileId } as never)) as Doc<"profiles"> | null;
    if (!profile || !profile.isDemo) fail("ERR_NOT_FOUND");
    if (!profile.authUserId.startsWith("practice:")) {
      // Delete the auth user first; if this fails the removal aborts
      // with the account intact rather than orphaning a credential.
      const adapter = await internalAdapter(ctx);
      await adapter.deleteUser(profile.authUserId);
    }
    await ctx.runMutation(deleteDataRef as never, { profileId: args.profileId, actorId: actor._id } as never);
    return { ok: true };
  },
});
