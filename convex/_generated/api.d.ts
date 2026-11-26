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
import type * as _lib_db from "../_lib/db.js";
import type * as _lib_donorLive from "../_lib/donorLive.js";
import type * as _lib_errors from "../_lib/errors.js";
import type * as _lib_events from "../_lib/events.js";
import type * as _lib_notify from "../_lib/notify.js";
import type * as _lib_practice from "../_lib/practice.js";
import type * as _lib_ratelimit from "../_lib/ratelimit.js";
import type * as _lib_settings from "../_lib/settings.js";
import type * as _lib_settingsData from "../_lib/settingsData.js";
import type * as _lib_visibility from "../_lib/visibility.js";
import type * as _lib_webPushCrypto from "../_lib/webPushCrypto.js";
import type * as admin_ai from "../admin/ai.js";
import type * as admin_audit from "../admin/audit.js";
import type * as admin_bootstrap from "../admin/bootstrap.js";
import type * as admin_data from "../admin/data.js";
import type * as admin_demo from "../admin/demo.js";
import type * as admin_directory from "../admin/directory.js";
import type * as admin_faq from "../admin/faq.js";
import type * as admin_moderation from "../admin/moderation.js";
import type * as admin_ops from "../admin/ops.js";
import type * as admin_people from "../admin/people.js";
import type * as admin_settings from "../admin/settings.js";
import type * as admin_summary from "../admin/summary.js";
import type * as admin_usage from "../admin/usage.js";
import type * as ai_gemini from "../ai/gemini.js";
import type * as assistant from "../assistant.js";
import type * as auth from "../auth.js";
import type * as blocks from "../blocks.js";
import type * as campaigns from "../campaigns.js";
import type * as consents from "../consents.js";
import type * as crons from "../crons.js";
import type * as donors from "../donors.js";
import type * as hospitals from "../hospitals.js";
import type * as http from "../http.js";
import type * as intake from "../intake.js";
import type * as lifecycle from "../lifecycle.js";
import type * as matching from "../matching.js";
import type * as notifications from "../notifications.js";
import type * as phoneVerification from "../phoneVerification.js";
import type * as places from "../places.js";
import type * as profiles from "../profiles.js";
import type * as public_ from "../public.js";
import type * as push from "../push.js";
import type * as pushWeb from "../pushWeb.js";
import type * as reminders from "../reminders.js";
import type * as reports from "../reports.js";
import type * as requests from "../requests.js";
import type * as responses from "../responses.js";
import type * as retention from "../retention.js";
import type * as rules_alertPolicy from "../rules/alertPolicy.js";
import type * as rules_appeal from "../rules/appeal.js";
import type * as rules_compatibility from "../rules/compatibility.js";
import type * as rules_csv from "../rules/csv.js";
import type * as rules_duplicates from "../rules/duplicates.js";
import type * as rules_eligibility from "../rules/eligibility.js";
import type * as rules_faqMatch from "../rules/faqMatch.js";
import type * as rules_intakeParser from "../rules/intakeParser.js";
import type * as rules_limits from "../rules/limits.js";
import type * as rules_moderation from "../rules/moderation.js";
import type * as rules_ranking from "../rules/ranking.js";
import type * as rules_redaction from "../rules/redaction.js";
import type * as rules_stats from "../rules/stats.js";
import type * as rules_validation from "../rules/validation.js";
import type * as rules_waves from "../rules/waves.js";
import type * as schemaTypes from "../schemaTypes.js";
import type * as seed from "../seed.js";
import type * as share from "../share.js";
import type * as slips from "../slips.js";
import type * as stats from "../stats.js";
import type * as support from "../support.js";
import type * as telegramAdmin from "../telegramAdmin.js";
import type * as volunteers from "../volunteers.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "_lib/audit": typeof _lib_audit;
  "_lib/auth": typeof _lib_auth;
  "_lib/db": typeof _lib_db;
  "_lib/donorLive": typeof _lib_donorLive;
  "_lib/errors": typeof _lib_errors;
  "_lib/events": typeof _lib_events;
  "_lib/notify": typeof _lib_notify;
  "_lib/practice": typeof _lib_practice;
  "_lib/ratelimit": typeof _lib_ratelimit;
  "_lib/settings": typeof _lib_settings;
  "_lib/settingsData": typeof _lib_settingsData;
  "_lib/visibility": typeof _lib_visibility;
  "_lib/webPushCrypto": typeof _lib_webPushCrypto;
  "admin/ai": typeof admin_ai;
  "admin/audit": typeof admin_audit;
  "admin/bootstrap": typeof admin_bootstrap;
  "admin/data": typeof admin_data;
  "admin/demo": typeof admin_demo;
  "admin/directory": typeof admin_directory;
  "admin/faq": typeof admin_faq;
  "admin/moderation": typeof admin_moderation;
  "admin/ops": typeof admin_ops;
  "admin/people": typeof admin_people;
  "admin/settings": typeof admin_settings;
  "admin/summary": typeof admin_summary;
  "admin/usage": typeof admin_usage;
  "ai/gemini": typeof ai_gemini;
  assistant: typeof assistant;
  auth: typeof auth;
  blocks: typeof blocks;
  campaigns: typeof campaigns;
  consents: typeof consents;
  crons: typeof crons;
  donors: typeof donors;
  hospitals: typeof hospitals;
  http: typeof http;
  intake: typeof intake;
  lifecycle: typeof lifecycle;
  matching: typeof matching;
  notifications: typeof notifications;
  phoneVerification: typeof phoneVerification;
  places: typeof places;
  profiles: typeof profiles;
  public: typeof public_;
  push: typeof push;
  pushWeb: typeof pushWeb;
  reminders: typeof reminders;
  reports: typeof reports;
  requests: typeof requests;
  responses: typeof responses;
  retention: typeof retention;
  "rules/alertPolicy": typeof rules_alertPolicy;
  "rules/appeal": typeof rules_appeal;
  "rules/compatibility": typeof rules_compatibility;
  "rules/csv": typeof rules_csv;
  "rules/duplicates": typeof rules_duplicates;
  "rules/eligibility": typeof rules_eligibility;
  "rules/faqMatch": typeof rules_faqMatch;
  "rules/intakeParser": typeof rules_intakeParser;
  "rules/limits": typeof rules_limits;
  "rules/moderation": typeof rules_moderation;
  "rules/ranking": typeof rules_ranking;
  "rules/redaction": typeof rules_redaction;
  "rules/stats": typeof rules_stats;
  "rules/validation": typeof rules_validation;
  "rules/waves": typeof rules_waves;
  schemaTypes: typeof schemaTypes;
  seed: typeof seed;
  share: typeof share;
  slips: typeof slips;
  stats: typeof stats;
  support: typeof support;
  telegramAdmin: typeof telegramAdmin;
  volunteers: typeof volunteers;
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
