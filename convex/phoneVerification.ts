import { internalMutationGeneric } from "convex/server";
import { v } from "convex/values";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel, Doc, Id } from "./schemaTypes";
import { memberMutationV, memberQueryV, volunteerMutationV, volunteerQueryV } from "./_lib/auth";
import { fail } from "./_lib/errors";
import { getSetting } from "./_lib/settings";
import { writeAudit } from "./_lib/audit";
import { recordEvent } from "./_lib/events";
import { limitOrThrow } from "./_lib/ratelimit";
import { refreshDonorLive } from "./_lib/donorLive";
import { IN_PERSON_CODE_ALPHABET, normalisePhone, validateInPersonCode } from "./rules/validation";

/**
 * Phone verification (specs §6.1, F-103, ADR-004, D-R1) — ৳0 methods only:
 * Telegram bot contact-share and in-person code + ring + last-4 check.
 * WhatsApp stays behind its settings switch (off by default).
 */

type Ctx = GenericMutationCtx<DataModel>;
type Profile = Doc<"profiles">;
type VerificationSettings = {
  telegram: boolean;
  whatsapp: boolean;
  inPerson: boolean;
  telegramBot: string;
  whatsappNumber: string;
};

const TEN_MIN_MS = 10 * 60_000;

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => IN_PERSON_CODE_ALPHABET[b % IN_PERSON_CODE_ALPHABET.length]).join("");
}

async function markVerified(
  ctx: Ctx,
  profile: Profile,
  via: "telegram" | "whatsapp" | "in_person",
  verifiedBy?: Id<"profiles">,
): Promise<void> {
  await ctx.db.patch(profile._id, {
    phoneVerified: true,
    phoneVerifiedAt: Date.now(),
    phoneVerifiedVia: via,
    phoneVerifiedBy: verifiedBy,
  });
  const donor = await ctx.db
    .query("donorProfiles")
    .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
    .unique();
  if (donor) {
    await refreshDonorLive(ctx, { ...profile, phoneVerified: true }, donor);
  }
}

async function assertPhoneFree(ctx: Ctx, phone: string, exceptProfileId: Id<"profiles">): Promise<void> {
  const others = await ctx.db
    .query("profiles")
    .withIndex("by_phone", (q) => q.eq("phone", phone))
    .collect();
  if (others.some((p) => p._id !== exceptProfileId && p.phoneVerified)) {
    fail("ERR_PHONE_IN_USE");
  }
}

/** phoneVerification.start (specs §6.1) — Telegram deep-link flow. */
export const start = memberMutationV({
  args: { method: v.union(v.literal("telegram"), v.literal("whatsapp")) },
  handler: async (ctx, args) => {
    const settings = await getSetting<VerificationSettings>(ctx, "verification");
    if (args.method === "telegram" && (!settings.telegram || !settings.telegramBot)) {
      // No bot username configured yet (RB-5) → the method honestly
      // reports itself disabled instead of producing a dead link.
      fail("ERR_METHOD_DISABLED");
    }
    if (args.method === "whatsapp" && (!settings.whatsapp || !settings.whatsappNumber)) {
      fail("ERR_METHOD_DISABLED");
    }
    await limitOrThrow(ctx, "verificationStart", ctx.profile._id);
    const token = randomToken();
    const expiresAt = Date.now() + TEN_MIN_MS;
    const verificationId = await ctx.db.insert("phoneVerifications", {
      profileId: ctx.profile._id,
      method: args.method,
      token,
      expiresAt,
      status: "pending",
    });
    await recordEvent(ctx, "phone_verification_started", {
      actorRole: ctx.profile.role,
      props: { method: args.method },
      isDemo: ctx.profile.isDemo,
    });
    const deepLink =
      args.method === "telegram"
        ? `https://t.me/${settings.telegramBot}?start=${token}`
        : `https://wa.me/${settings.whatsappNumber}?text=VERIFY%20${token}`;
    return { verificationId, deepLink, expiresAt };
  },
});

/** phoneVerification.status (specs §6.1) — own verifications only. */
export const status = memberQueryV({
  args: { verificationId: v.id("phoneVerifications") },
  handler: async (ctx, args) => {
    const verification = await ctx.db.get(args.verificationId);
    if (!verification || verification!.profileId !== ctx.profile._id) fail("ERR_NOT_FOUND");
    const effective =
      verification!.status === "pending" && verification!.expiresAt < Date.now()
        ? "expired"
        : verification!.status;
    return {
      status: effective,
      verifiedPhone: verification!.status === "verified" || verification!.status === "mismatch"
        ? verification!.verifiedPhone
        : undefined,
      enteredPhone: ctx.profile.phone,
    };
  },
});

/** phoneVerification.acceptMismatch (specs §6.1) — adopt the shared number. */
export const acceptMismatch = memberMutationV({
  args: { verificationId: v.id("phoneVerifications") },
  handler: async (ctx, args) => {
    const verification = await ctx.db.get(args.verificationId);
    if (!verification || verification!.profileId !== ctx.profile._id) fail("ERR_NOT_FOUND");
    if (verification!.status !== "mismatch" || !verification!.verifiedPhone) {
      fail("ERR_VALIDATION", {}, "verificationId");
    }
    if (verification!.expiresAt < Date.now()) fail("ERR_VERIFICATION_EXPIRED");
    await assertPhoneFree(ctx, verification!.verifiedPhone, ctx.profile._id);
    await ctx.db.patch(ctx.profile._id, { phone: verification!.verifiedPhone });
    await ctx.db.patch(args.verificationId, { status: "verified" });
    const updated = { ...ctx.profile, phone: verification!.verifiedPhone };
    await markVerified(ctx, updated, verification!.method as "telegram" | "whatsapp");
    await recordEvent(ctx, "phone_verified", {
      actorRole: ctx.profile.role,
      props: { method: verification!.method },
      isDemo: ctx.profile.isDemo,
    });
    return null;
  },
});

/** phoneVerification.startInPerson (specs §6.1) — 6-char code, +10 min. */
export const startInPerson = memberMutationV({
  args: {},
  handler: async (ctx) => {
    const settings = await getSetting<VerificationSettings>(ctx, "verification");
    if (!settings.inPerson) fail("ERR_METHOD_DISABLED");
    await limitOrThrow(ctx, "verificationStart", ctx.profile._id);
    let code = randomCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      const clash = await ctx.db
        .query("phoneVerifications")
        .withIndex("by_code", (q) => q.eq("code", code))
        .first();
      if (!clash || clash.status !== "pending") break;
      code = randomCode();
    }
    const expiresAt = Date.now() + TEN_MIN_MS;
    const verificationId = await ctx.db.insert("phoneVerifications", {
      profileId: ctx.profile._id,
      method: "in_person",
      token: randomToken(),
      code,
      expiresAt,
      status: "pending",
    });
    await recordEvent(ctx, "phone_verification_started", {
      actorRole: ctx.profile.role,
      props: { method: "in_person" },
      isDemo: ctx.profile.isDemo,
    });
    return { verificationId, code, expiresAt };
  },
});

/**
 * phoneVerification.lookupInPerson (specs §6.1, SCR-V06) — returns the
 * person's first name and last-4 ONLY. The full number never leaves the
 * server on this path (payload-minimisation is covered by tests).
 */
export const lookupInPerson = volunteerQueryV({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const check = validateInPersonCode(args.code);
    if (!check.ok) fail("ERR_VALIDATION", {}, check.field);
    const code = args.code.trim().toUpperCase();
    const verification = await ctx.db
      .query("phoneVerifications")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();
    if (!verification || verification!.method !== "in_person" || verification!.status !== "pending") {
      fail("ERR_NOT_FOUND");
    }
    if (verification!.expiresAt < Date.now()) fail("ERR_VERIFICATION_EXPIRED");
    if (verification!.profileId === ctx.profile._id) fail("ERR_SELF_VERIFICATION");
    const person = await ctx.db.get(verification!.profileId);
    if (!person) fail("ERR_NOT_FOUND");
    return {
      verificationId: verification!._id,
      firstName: person!.firstName,
      phoneLast4: person!.phone.slice(-4),
    };
  },
});

/** phoneVerification.confirmInPerson (specs §6.1, SCR-V06). */
export const confirmInPerson = volunteerMutationV({
  args: { verificationId: v.id("phoneVerifications"), matches: v.boolean() },
  handler: async (ctx, args) => {
    const verification = await ctx.db.get(args.verificationId);
    if (!verification || verification!.method !== "in_person") fail("ERR_NOT_FOUND");
    if (verification!.profileId === ctx.profile._id) fail("ERR_SELF_VERIFICATION");
    if (verification!.status !== "pending") fail("ERR_VERIFICATION_EXPIRED");
    if (verification!.expiresAt < Date.now()) {
      await ctx.db.patch(args.verificationId, { status: "expired" });
      fail("ERR_VERIFICATION_EXPIRED");
    }
    await limitOrThrow(ctx, "inPersonConfirm", ctx.profile._id);
    const person = await ctx.db.get(verification!.profileId);
    if (!person) fail("ERR_NOT_FOUND");
    if (!args.matches) {
      await ctx.db.patch(args.verificationId, {
        status: "mismatch",
        verifierId: ctx.profile._id,
      });
      await writeAudit(ctx, {
        actor: ctx.profile,
        action: "phone_verification_failed_in_person",
        targetType: "profiles",
        targetId: person!._id,
      });
      return null;
    }
    await assertPhoneFree(ctx, person!.phone, person!._id);
    await ctx.db.patch(args.verificationId, {
      status: "verified",
      verifierId: ctx.profile._id,
      verifiedPhone: person!.phone,
    });
    await markVerified(ctx, person!, "in_person", ctx.profile._id);
    await writeAudit(ctx, {
      actor: ctx.profile,
      action: "phone_verified_in_person",
      targetType: "profiles",
      targetId: person!._id,
    });
    await recordEvent(ctx, "phone_verified", {
      actorRole: ctx.profile.role,
      props: { method: "in_person" },
      isDemo: person!.isDemo,
    });
    return null;
  },
});

export type TelegramAction =
  | "prompt_contact"
  | "verified"
  | "mismatch"
  | "expired"
  | "own_number"
  | "ignored";

/**
 * Telegram webhook logic (specs §6.5) as an internal mutation so it is
 * fully unit-testable with fixture updates; convex/http.ts is a thin
 * shell that checks the secret header, calls this, and sends the reply
 * the returned action calls for (only when TELEGRAM_BOT_TOKEN is set).
 */
export const handleTelegramUpdate = internalMutationGeneric({
  args: { update: v.any() },
  handler: async (ctx, args): Promise<{ action: TelegramAction; chatId?: number }> => {
    const message = (args.update as { message?: Record<string, never> })?.message;
    if (!message) return { action: "ignored" };
    const chatId = (message as { chat?: { id?: number } }).chat?.id;
    const fromId = String((message as { from?: { id?: number } }).from?.id ?? "");

    const text = (message as { text?: string }).text;
    if (typeof text === "string" && text.startsWith("/start")) {
      const token = text.split(/\s+/)[1];
      if (!token) return { action: "ignored", chatId };
      const verification = await ctx.db
        .query("phoneVerifications")
        .withIndex("by_token", (q) => q.eq("token", token))
        .unique();
      if (!verification || verification.method !== "telegram" || verification.status !== "pending") {
        return { action: "ignored", chatId };
      }
      if (verification.expiresAt < Date.now()) {
        await ctx.db.patch(verification._id, { status: "expired" });
        return { action: "expired", chatId };
      }
      await ctx.db.patch(verification._id, { externalUserId: fromId });
      return { action: "prompt_contact", chatId };
    }

    const contact = (
      message as { contact?: { phone_number?: string; user_id?: number } }
    ).contact;
    if (contact) {
      if (String(contact.user_id ?? "") !== fromId) {
        return { action: "own_number", chatId };
      }
      const pending = await ctx.db
        .query("phoneVerifications")
        .withIndex("by_externalUserId", (q) => q.eq("externalUserId", fromId))
        .collect();
      const verification = pending
        .filter((row) => row.method === "telegram" && row.status === "pending")
        .sort((a, b) => b._creationTime - a._creationTime)[0];
      if (!verification) return { action: "ignored", chatId };
      if (verification.expiresAt < Date.now()) {
        await ctx.db.patch(verification._id, { status: "expired" });
        return { action: "expired", chatId };
      }
      const shared = normalisePhone(contact.phone_number ?? "");
      if (!shared) return { action: "ignored", chatId };
      const profile = await ctx.db.get(verification.profileId);
      if (!profile) return { action: "ignored", chatId };
      if (shared === profile.phone) {
        await ctx.db.patch(verification._id, { status: "verified", verifiedPhone: shared });
        await markVerified(ctx, profile, "telegram");
        await recordEvent(ctx, "phone_verified", {
          actorRole: profile.role,
          props: { method: "telegram" },
          isDemo: profile.isDemo,
        });
        return { action: "verified", chatId };
      }
      await ctx.db.patch(verification._id, { status: "mismatch", verifiedPhone: shared });
      return { action: "mismatch", chatId };
    }

    return { action: "ignored", chatId };
  },
});
