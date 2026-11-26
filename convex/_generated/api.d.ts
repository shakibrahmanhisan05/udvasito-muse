/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as _lib_audit from "../_lib/audit.js";
import type * as _lib_auth from "../_lib/auth.js";
import type * as _lib_errors from "../_lib/errors.js";
import type * as _lib_events from "../_lib/events.js";
import type * as _lib_settings from "../_lib/settings.js";
import type * as _lib_settingsData from "../_lib/settingsData.js";
import type * as _lib_visibility from "../_lib/visibility.js";
import type * as admin_bootstrap from "../admin/bootstrap.js";
import type * as admin_ops from "../admin/ops.js";
import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as places from "../places.js";
import type * as profiles from "../profiles.js";
import type * as public_ from "../public.js";
import type * as rules_compatibility from "../rules/compatibility.js";
import type * as rules_eligibility from "../rules/eligibility.js";
import type * as rules_intakeParser from "../rules/intakeParser.js";
import type * as rules_limits from "../rules/limits.js";
import type * as rules_ranking from "../rules/ranking.js";
import type * as rules_redaction from "../rules/redaction.js";
import type * as rules_waves from "../rules/waves.js";
import type * as schemaTypes from "../schemaTypes.js";
import type * as seed from "../seed.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "_lib/audit": typeof _lib_audit;
  "_lib/auth": typeof _lib_auth;
  "_lib/errors": typeof _lib_errors;
  "_lib/events": typeof _lib_events;
  "_lib/settings": typeof _lib_settings;
  "_lib/settingsData": typeof _lib_settingsData;
  "_lib/visibility": typeof _lib_visibility;
  "admin/bootstrap": typeof admin_bootstrap;
  "admin/ops": typeof admin_ops;
  auth: typeof auth;
  crons: typeof crons;
  http: typeof http;
  places: typeof places;
  profiles: typeof profiles;
  public: typeof public_;
  "rules/compatibility": typeof rules_compatibility;
  "rules/eligibility": typeof rules_eligibility;
  "rules/intakeParser": typeof rules_intakeParser;
  "rules/limits": typeof rules_limits;
  "rules/ranking": typeof rules_ranking;
  "rules/redaction": typeof rules_redaction;
  "rules/waves": typeof rules_waves;
  schemaTypes: typeof schemaTypes;
  seed: typeof seed;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  pushNotifications: import("@convex-dev/expo-push-notifications/_generated/component.js").ComponentApi<"pushNotifications">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
