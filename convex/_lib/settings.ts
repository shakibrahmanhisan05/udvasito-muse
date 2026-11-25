import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel } from "../schemaTypes";
import { SETTING_DEFS } from "./settingsData";
import { fail } from "./errors";

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>;

/** Validate a value against its §5.2 definition (range for numeric settings). */
export function validateSettingValue(key: string, value: unknown): void {
  const def = SETTING_DEFS.find((d) => d.key === key);
  if (!def) fail("ERR_VALIDATION", { key }, key);
  if (def!.range && typeof value === "number") {
    const [min, max] = def!.range;
    if (value < min || value > max) fail("ERR_VALIDATION", { key }, key);
  }
  if (key === "minAge" && value !== 18) {
    // S-01 is fixed: the minimum age cannot be lowered (specs §5.2).
    fail("ERR_VALIDATION", { key }, key);
  }
}

/** Typed settings reader — the ONLY way logic reads rule numbers. */
export async function getSetting<T = unknown>(ctx: Ctx, key: string): Promise<T> {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (row) return row.value as T;
  const def = SETTING_DEFS.find((d) => d.key === key);
  if (!def) fail("ERR_INTERNAL", { key });
  return def!.value as T;
}

export async function getSettings(ctx: Ctx, keys: string[]): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = await getSetting(ctx, key);
  return out;
}

/** The subset of settings the pure rules engine consumes (convex/rules/*). */
export type RulesSettings = {
  minAge: number;
  maxDonorAge: number;
  intervalWholeMaleDays: number;
  intervalWholeOtherDays: number;
  intervalPlateletDays: number;
  intervalPlateletToWholeDays: number;
  waveSizes: number[];
  waveIntervalMin: { now: number; today: number; later: number };
  waveCount: number;
  compatibleInFinalWave: boolean;
  donorAlertCapPerDay: number;
  quietHours: { start: string; end: string };
  openRequestsUnverified: number;
  openRequestsVerified: number;
  requestsPerMonth: number;
  volunteerRequestsPerMonth: number;
};

export const RULES_SETTING_KEYS: (keyof RulesSettings)[] = [
  "minAge", "maxDonorAge", "intervalWholeMaleDays", "intervalWholeOtherDays",
  "intervalPlateletDays", "intervalPlateletToWholeDays", "waveSizes",
  "waveIntervalMin", "waveCount", "compatibleInFinalWave", "donorAlertCapPerDay",
  "quietHours", "openRequestsUnverified", "openRequestsVerified",
  "requestsPerMonth", "volunteerRequestsPerMonth",
];

export async function getRulesSettings(ctx: Ctx): Promise<RulesSettings> {
  return (await getSettings(ctx, [...RULES_SETTING_KEYS])) as unknown as RulesSettings;
}
