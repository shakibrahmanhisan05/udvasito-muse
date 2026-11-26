import { createClient, type AuthFunctions, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { expo } from "@better-auth/expo";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { internalMutationGeneric, makeFunctionReference, type GenericActionCtx } from "convex/server";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { DataModel } from "./schemaTypes";
import authConfig from "./auth.config";
import { practiceIdFromEmail } from "./_lib/practice";

/**
 * Better Auth + Convex component (ADR-003). Google is the only production
 * sign-in method; email+password exists ONLY for staging automated tests and
 * the production practice-area sign-in (P-10, D-R4) and stays disabled unless
 * BETTER_AUTH_EMAIL_ENABLED=1 in the Convex environment.
 *
 * HUMAN STEPS (RB-4): create the Google Cloud OAuth client (no billing) and
 * set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / BETTER_AUTH_SECRET /
 * BETTER_AUTH_URL in the Convex env. No credentials live in this repo.
 *
 * WIRING (fixed 2026-11-26 after the first live sign-in test failed with a
 * 500 on /api/auth/sign-in/social): this follows the @convex-dev/better-auth
 * 0.13 Expo guide exactly — the generated `components.betterAuth`, the
 * client's own `adapter(ctx)`, `convex/auth.config.ts`, and the required
 * `expo()` + `convex({ authConfig })` server plugins. The P0 hand-rolled
 * component reference passed the createClient RESULT to convexAdapter(),
 * whose `.adapter` is a factory function, not the component's reference
 * bag — every adapter call then read function references off `undefined`
 * ("Cannot read properties of undefined (reading 'Symbol(functionName)')").
 */
export const authComponent = createClient<DataModel>(components.betterAuth, {
  // String-built references (not internal.auth.*) keep this initializer
  // out of the type-inference cycle through the auth module itself;
  // makeFunctionReference defaults to "public" visibility, hence the cast.
  authFunctions: {
    onCreate: makeFunctionReference("auth:onCreateAuthUser") as unknown as AuthFunctions["onCreate"],
    onUpdate: makeFunctionReference("auth:onUpdateAuthUser") as unknown as AuthFunctions["onUpdate"],
    onDelete: makeFunctionReference("auth:onDeleteAuthUser") as unknown as AuthFunctions["onDelete"],
  },
  // NOTE (reviewed 2026-11-26): in @convex-dev/better-auth 0.13.1 the
  // adapter only dispatches lifecycle callbacks for models present in
  // `triggers`, so with this empty map the component does NOT invoke
  // auth:onCreateAuthUser et al. at runtime. That is accepted for now:
  // onUpdate/onDelete are no-ops, and onCreate's only job (practice
  // profile linking) is also performed explicitly by admin.demo via
  // linkPracticeAccount. Follow-up: wire the canonical
  // triggers:{user:{…}} + triggersApi() refs before any new flow relies
  // on these hooks (see qa/fix-better-auth-plugins-review.md).
  triggers: {},
});

/**
 * Auth-user lifecycle hooks. App profiles are created at onboarding
 * (profiles.completeOnboarding, P1) — these hooks do not create
 * profiles, so a Google account alone never becomes a member record
 * without name/DOB/phone and the 18+ gate (F-102). The one exception
 * is LINKING: a practice profile pre-created by the super-admin is
 * linked to its auth user in onCreateAuthUser (D-R4).
 */
export const onCreateAuthUser = internalMutationGeneric({
  args: { doc: v.any() },
  handler: async (ctx, args) => {
    // Practice accounts (D-R4): the profile is pre-created by
    // admin.demo.preparePracticeAccount with a placeholder authUserId;
    // link it to the real auth user the moment that user exists, so
    // onboarding later patches the practice profile in place. Every
    // other sign-up keeps the P0 behaviour: no profile here — profiles
    // are created at onboarding (profiles.completeOnboarding, P1), so a
    // Google account alone never becomes a member record without
    // name/DOB/phone and the 18+ gate (F-102).
    const doc = args.doc as { _id?: unknown; email?: unknown } | null;
    const email = typeof doc?.email === "string" ? doc.email : "";
    const practiceId = practiceIdFromEmail(email);
    if (!practiceId || doc?._id === undefined) return;
    const rows = await ctx.db
      .query("profiles")
      .filter((q) => q.and(q.eq(q.field("practiceId"), practiceId), q.eq(q.field("isDemo"), true)))
      .take(2);
    const profile = rows[0];
    if (profile && profile.authUserId.startsWith("practice:")) {
      await ctx.db.patch(profile._id, { authUserId: String(doc._id) });
    }
  },
});
export const onUpdateAuthUser = internalMutationGeneric({
  args: { doc: v.any(), oldDoc: v.any() },
  handler: async () => {
    // No-op in P0 by design.
  },
});
export const onDeleteAuthUser = internalMutationGeneric({
  args: { doc: v.any() },
  handler: async () => {
    // Account deletion flow lands in P3 (F-603) via retention jobs.
  },
});

export function createAuth(ctx: GenericCtx<DataModel>) {
  const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: authComponent.adapter(ctx),
    plugins: [expo(), convex({ authConfig })],
    socialProviders: googleConfigured
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID as string,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
          },
        }
      : {},
    emailAndPassword: {
      enabled: process.env.BETTER_AUTH_EMAIL_ENABLED === "1",
      disableSignUp: false,
    },
    hooks: {
      /**
       * Practice-area sign-in gate (D-R4, specs §6.6 auth table).
       * Email+password exists for staging test accounts and, in
       * production, ONLY for practice accounts. For a practice email
       * (<id>@practice.udvasito.invalid) this hook enforces, server
       * side: the practice profile exists, the practice area is
       * enabled, and the ID is not locked (5 attempts in 15 minutes
       * since the last success → locked). Every attempt is recorded
       * BEFORE the password is checked; the after hook records a
       * success, which resets the counter. When the deployment sets
       * EMAIL_SIGNIN_PRACTICE_ONLY=1 (production), non-practice email
       * sign-in and all email sign-up are refused here; practice
       * sign-up is refused always, except the one server-side
       * provisioning call for a pre-prepared profile (admin.demo).
       */
      before: createAuthMiddleware(async (mw) => {
        if (mw.path !== "/sign-in/email" && mw.path !== "/sign-up/email") return;
        const email = typeof mw.body?.email === "string" ? mw.body.email : "";
        const practiceId = practiceIdFromEmail(email);
        const practiceOnly = process.env.EMAIL_SIGNIN_PRACTICE_ONLY === "1";
        const runtime = ctx as GenericActionCtx<DataModel>;
        if (mw.path === "/sign-up/email") {
          if (practiceId) {
            const prepared = (await runtime.runQuery(
              makeFunctionReference("admin/demo:practiceById") as never,
              { practiceId } as never,
            )) as { authUserId: string } | null;
            if (!prepared || !prepared.authUserId.startsWith("practice:")) {
              throw new APIError("FORBIDDEN", { message: "Practice sign-up is disabled." });
            }
          } else if (practiceOnly) {
            throw new APIError("FORBIDDEN", { message: "Sign-up is disabled." });
          }
          return;
        }
        // /sign-in/email
        if (practiceId) {
          const gate = (await runtime.runQuery(
            makeFunctionReference("admin/demo:gateCheck") as never,
            { practiceId } as never,
          )) as { exists: boolean; enabled: boolean; locked: boolean };
          if (!gate.exists || !gate.enabled) {
            throw new APIError("FORBIDDEN", { message: "The practice area is not available." });
          }
          if (gate.locked) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Too many wrong PINs. Try again in 15 minutes.",
            });
          }
          await runtime.runMutation(
            makeFunctionReference("admin/demo:gateAttempt") as never,
            { practiceId } as never,
          );
        } else if (practiceOnly) {
          throw new APIError("FORBIDDEN", { message: "Email sign-in is for practice accounts only." });
        }
      }),
      after: createAuthMiddleware(async (mw) => {
        if (mw.path !== "/sign-in/email") return;
        const email = mw.context.newSession?.user?.email ?? "";
        const practiceId = practiceIdFromEmail(email);
        if (!practiceId) return;
        const runtime = ctx as GenericActionCtx<DataModel>;
        await runtime.runMutation(
          makeFunctionReference("admin/demo:gateSuccess") as never,
          { practiceId } as never,
        );
      }),
    },
  });
}
