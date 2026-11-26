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
