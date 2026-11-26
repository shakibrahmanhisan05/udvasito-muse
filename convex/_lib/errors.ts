import { ConvexError } from "convex/values";

/**
 * Every ERR_ code from docs/specs.md §6.7. The app maps `code` to the
 * `errors.<CODE>` i18n string — never invent new codes without updating
 * specs §6.7 and both i18n files.
 */
export const ERROR_CODES = [
  "ERR_UNAUTHENTICATED",
  "ERR_CONSENT_REQUIRED",
  "ERR_UNDERAGE",
  "ERR_FORBIDDEN",
  "ERR_FROZEN",
  "ERR_NOT_FOUND",
  "ERR_VALIDATION",
  "ERR_RATE_LIMITED",
  "ERR_OPEN_REQUEST_LIMIT",
  "ERR_MONTHLY_REQUEST_LIMIT",
  "ERR_PHONE_NOT_VERIFIED",
  "ERR_PHONE_IN_USE",
  "ERR_VERIFICATION_EXPIRED",
  "ERR_METHOD_DISABLED",
  "ERR_REQUEST_CLOSED",
  "ERR_ALREADY_RESPONDED",
  "ERR_NOT_ELIGIBLE",
  "ERR_BLOCKED",
  "ERR_REVEALS_FROZEN",
  "ERR_LAST_ADMIN",
  "ERR_DEMO_ISOLATION",
  "ERR_SELF_VERIFICATION",
  "ERR_APP_VERSION",
  "ERR_INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function fail(
  code: ErrorCode,
  params?: Record<string, string | number>,
  field?: string,
): never {
  throw new ConvexError({ code, params, field });
}
