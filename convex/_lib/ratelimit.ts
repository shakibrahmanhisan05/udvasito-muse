import { RateLimiter, HOUR, DAY } from "@convex-dev/rate-limiter";
import type { GenericMutationCtx } from "convex/server";
import { components } from "../_generated/api";
import type { DataModel } from "../schemaTypes";
import { SETTING_DEFS } from "./settingsData";
import { fail } from "./errors";

/**
 * Rate limits (specs §6.0: exceeding throws ERR_RATE_LIMITED {minutes}).
 * Config values come from the §5.2 setting defaults in settingsData.ts —
 * the single source for rule numbers (CLAUDE.md rule 9). The component
 * requires static config, so the seeded defaults are read from SETTING_DEFS
 * rather than typed a second time here.
 */
function defNumber(key: string): number {
  const def = SETTING_DEFS.find((d) => d.key === key);
  if (!def || typeof def.value !== "number") throw new Error(`setting ${key} missing`);
  return def.value;
}

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  // S-25: sign-ups per device/network per hour (keyed by auth user id —
  // the closest server-side identity available at onboarding time).
  signUp: {
    kind: "fixed window",
    rate: defNumber("signupsPerDevicePerHour"),
    period: HOUR,
  },
  // specs §6.1: phoneVerification.start / startInPerson — 5 per hour.
  verificationStart: { kind: "fixed window", rate: 5, period: HOUR },
  // D-R1: in-person confirmations per verifier per day (setting default).
  inPersonConfirm: {
    kind: "fixed window",
    rate: defNumber("inPersonVerificationsPerDay"),
    period: DAY,
  },
  // specs §6.5: GET /public/helpline — 30 per hour per network (IP hash).
  helplineFetch: { kind: "fixed window", rate: 30, period: HOUR },
  // specs §6.4: push.sendTest — 3 per hour.
  pushTest: { kind: "fixed window", rate: 3, period: HOUR },
  // specs §6.4: reports.create — 10 per member per day.
  reportCreate: { kind: "fixed window", rate: 10, period: DAY },
  // PRD §5.8: volunteer donor searches — 30 per volunteer per hour.
  volunteerSearch: { kind: "fixed window", rate: 30, period: HOUR },
});

type LimitName =
  | "signUp" | "verificationStart" | "inPersonConfirm" | "helplineFetch" | "pushTest"
  | "reportCreate" | "volunteerSearch";

/** Consume one token or throw ERR_RATE_LIMITED with whole minutes to wait. */
export async function limitOrThrow(
  ctx: GenericMutationCtx<DataModel>,
  name: LimitName,
  key: string,
): Promise<void> {
  const status = await rateLimiter.limit(ctx, name, { key });
  if (!status.ok) {
    fail("ERR_RATE_LIMITED", {
      minutes: Math.max(1, Math.ceil((status.retryAfter ?? 0) / 60_000)),
    });
  }
}
