import {
  mutationGeneric,
  queryGeneric,
  type GenericMutationCtx,
  type GenericQueryCtx,
} from "convex/server";
import type { DataModel, Doc, Id } from "../schemaTypes";
import { fail } from "./errors";

export type Profile = Doc<"profiles">;
export type Role = Profile["role"];
export type AnyCtx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>;
export type AuthedCtx<Ctx> = Ctx & { profile: Profile };

/**
 * Auth wrappers (specs §6.0, CLAUDE.md rule 11). Every public Convex function
 * starts with one of these: it loads the caller's profile from the Better
 * Auth identity and enforces sign-in, account status and role. Internal
 * functions are never wrapped (they are not client-callable).
 */

export async function getAuthProfile(ctx: AnyCtx): Promise<Profile | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("profiles")
    .withIndex("by_authUserId", (q) => q.eq("authUserId", identity.subject))
    .unique();
}

export async function requireAuthProfile(ctx: AnyCtx): Promise<Profile> {
  const profile = await getAuthProfile(ctx);
  if (!profile) fail("ERR_UNAUTHENTICATED");
  return profile!;
}

export function assertActive(profile: Profile): void {
  if (profile.status === "underage_blocked") fail("ERR_UNDERAGE");
  if (
    profile.status === "frozen" ||
    profile.status === "suspended" ||
    profile.status === "banned" ||
    profile.status === "deletion_pending"
  ) {
    fail("ERR_FROZEN");
  }
}

export function assertRole(profile: Profile, roles: Role[]): void {
  if (!roles.includes(profile.role)) fail("ERR_FORBIDDEN");
}

export function assertDemoIsolation(profile: Profile, isDemo: boolean): void {
  if (profile.isDemo !== isDemo) fail("ERR_DEMO_ISOLATION");
}

type Handler<Ctx, Args, Output> = (ctx: AuthedCtx<Ctx>, args: Args) => Promise<Output>;

/** Any signed-in member with an active account. */
export function memberQuery<Args extends Record<string, never> | object, Output>(
  config: { args: Args; handler: Handler<GenericQueryCtx<DataModel>, Args, Output> },
) {
  return queryGeneric({
    args: config.args as never,
    handler: async (ctx, args) => {
      const profile = await requireAuthProfile(ctx);
      assertActive(profile);
      return config.handler(Object.assign(ctx, { profile }), args as Args);
    },
  });
}

export function memberMutation<Args extends Record<string, never> | object, Output>(
  config: { args: Args; handler: Handler<GenericMutationCtx<DataModel>, Args, Output> },
) {
  return mutationGeneric({
    args: config.args as never,
    handler: async (ctx, args) => {
      const profile = await requireAuthProfile(ctx);
      assertActive(profile);
      return config.handler(Object.assign(ctx, { profile }), args as Args);
    },
  });
}

function roleMutation(roles: Role[]) {
  return function <Args extends Record<string, never> | object, Output>(config: {
    args: Args;
    handler: Handler<GenericMutationCtx<DataModel>, Args, Output>;
  }) {
    return mutationGeneric({
      args: config.args as never,
      handler: async (ctx, args) => {
        const profile = await requireAuthProfile(ctx);
        assertActive(profile);
        assertRole(profile, roles);
        return config.handler(Object.assign(ctx, { profile }), args as Args);
      },
    });
  };
}

function roleQuery(roles: Role[]) {
  return function <Args extends Record<string, never> | object, Output>(config: {
    args: Args;
    handler: Handler<GenericQueryCtx<DataModel>, Args, Output>;
  }) {
    return queryGeneric({
      args: config.args as never,
      handler: async (ctx, args) => {
        const profile = await requireAuthProfile(ctx);
        assertActive(profile);
        assertRole(profile, roles);
        return config.handler(Object.assign(ctx, { profile }), args as Args);
      },
    });
  };
}

export const volunteerQuery = roleQuery(["volunteer", "admin", "superadmin"]);
export const volunteerMutation = roleMutation(["volunteer", "admin", "superadmin"]);
export const adminQuery = roleQuery(["admin", "superadmin"]);
export const adminMutation = roleMutation(["admin", "superadmin"]);
export const superadminMutation = roleMutation(["superadmin"]);

/** Donor functions additionally require a live donor profile (checked in P1 donors.ts). */
export const donorMutation = memberMutation;

// ── Validator-typed variants (P1) ────────────────────────────────────
// The wrappers above predate codegen-era typing: their handler receives
// the *validator* types. These variants take a validators record and hand
// the handler the inferred *value* types (ObjectType), with the same
// sign-in → active → role enforcement. New functions should use these.
import type { GenericValidator, ObjectType } from "convex/values";

type Validators = Record<string, GenericValidator>;

export function memberQueryV<Args extends Validators, Output>(config: {
  args: Args;
  handler: Handler<GenericQueryCtx<DataModel>, ObjectType<Args>, Output>;
}) {
  return queryGeneric({
    args: config.args as never,
    handler: async (ctx, args) => {
      const profile = await requireAuthProfile(ctx);
      assertActive(profile);
      return config.handler(Object.assign(ctx, { profile }), args as ObjectType<Args>);
    },
  });
}

export function memberMutationV<Args extends Validators, Output>(config: {
  args: Args;
  handler: Handler<GenericMutationCtx<DataModel>, ObjectType<Args>, Output>;
}) {
  return mutationGeneric({
    args: config.args as never,
    handler: async (ctx, args) => {
      const profile = await requireAuthProfile(ctx);
      assertActive(profile);
      return config.handler(Object.assign(ctx, { profile }), args as ObjectType<Args>);
    },
  });
}

function roleMutationV(roles: Role[]) {
  return function <Args extends Validators, Output>(config: {
    args: Args;
    handler: Handler<GenericMutationCtx<DataModel>, ObjectType<Args>, Output>;
  }) {
    return mutationGeneric({
      args: config.args as never,
      handler: async (ctx, args) => {
        const profile = await requireAuthProfile(ctx);
        assertActive(profile);
        assertRole(profile, roles);
        return config.handler(Object.assign(ctx, { profile }), args as ObjectType<Args>);
      },
    });
  };
}

function roleQueryV(roles: Role[]) {
  return function <Args extends Validators, Output>(config: {
    args: Args;
    handler: Handler<GenericQueryCtx<DataModel>, ObjectType<Args>, Output>;
  }) {
    return queryGeneric({
      args: config.args as never,
      handler: async (ctx, args) => {
        const profile = await requireAuthProfile(ctx);
        assertActive(profile);
        assertRole(profile, roles);
        return config.handler(Object.assign(ctx, { profile }), args as ObjectType<Args>);
      },
    });
  };
}

export const volunteerQueryV = roleQueryV(["volunteer", "admin", "superadmin"]);
export const volunteerMutationV = roleMutationV(["volunteer", "admin", "superadmin"]);
export const adminQueryV = roleQueryV(["admin", "superadmin"]);
export const adminMutationV = roleMutationV(["admin", "superadmin"]);
export const donorMutationV = memberMutationV;
export const donorQueryV = memberQueryV;

/**
 * Read-only owner view (gate G6, specs §1.2): a frozen or suspended
 * member keeps read access to their own request's live status while
 * every write stays blocked by `assertActive`. Banned, deletion-pending
 * and underage accounts are still refused outright.
 */
export function ownerViewQueryV<Args extends Validators, Output>(config: {
  args: Args;
  handler: Handler<GenericQueryCtx<DataModel>, ObjectType<Args>, Output>;
}) {
  return queryGeneric({
    args: config.args as never,
    handler: async (ctx, args) => {
      const profile = await requireAuthProfile(ctx);
      if (profile.status === "underage_blocked") fail("ERR_UNDERAGE");
      if (profile.status === "banned" || profile.status === "deletion_pending") {
        fail("ERR_FROZEN");
      }
      return config.handler(Object.assign(ctx, { profile }), args as ObjectType<Args>);
    },
  });
}
