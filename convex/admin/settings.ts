import { v } from "convex/values";
import { adminMutationV, adminQueryV } from "../_lib/auth";
import { fail } from "../_lib/errors";
import { featureOn } from "../_lib/settings";
import { SETTING_DEFS, type SettingDef, type SettingFieldRule } from "../_lib/settingsData";
import { writeAudit } from "../_lib/audit";

const HH_MM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function failValue(): never {
  fail("ERR_VALIDATION", {}, "value");
}

/**
 * Recursively shape-validate `value` against the seeded default's
 * structure (S3-F1): an object value must carry exactly the default's
 * fields — every field present, no unknown fields — with matching
 * primitive types all the way down; an array value's elements must
 * match the default's element type. Numeric fields/elements must be
 * finite and sit inside any §5.2 range declared in the def's
 * `fieldRules`/`elementRange`; string fields obey the same 500-char
 * cap as top-level strings, plus the S-21 "HH:mm" format where the
 * def declares it. An empty default array takes its element type
 * from the def's `elementType`.
 */
function validateShape(
  value: unknown,
  shape: unknown,
  def: SettingDef,
  rule?: SettingFieldRule,
): void {
  if (typeof shape === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) failValue();
    if (rule?.range && (value < rule.range[0] || value > rule.range[1])) {
      fail("ERR_VALIDATION", { min: rule.range[0], max: rule.range[1] }, "value");
    }
    return;
  }
  if (typeof shape === "string") {
    if (typeof value !== "string" || value.length > 500) failValue();
    if (rule?.format === "HH:mm" && !HH_MM_RE.test(value as string)) failValue();
    return;
  }
  if (typeof shape === "boolean") {
    if (typeof value !== "boolean") failValue();
    return;
  }
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) failValue();
    const elementRule: SettingFieldRule | undefined = def.elementRange
      ? { range: def.elementRange }
      : undefined;
    if (shape.length > 0) {
      for (const element of value) validateShape(element, shape[0], def, elementRule);
    } else if (def.elementType === "number") {
      for (const element of value) validateShape(element, 0, def, elementRule);
    } else if (def.elementType === "string") {
      for (const element of value) validateShape(element, "", def);
    } else if (def.elementType === "boolean") {
      for (const element of value) validateShape(element, false, def);
    }
    return;
  }
  if (shape !== null && typeof shape === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) failValue();
    const shapeObj = shape as Record<string, unknown>;
    const valueObj = value as Record<string, unknown>;
    for (const field of Object.keys(valueObj)) {
      if (!(field in shapeObj)) failValue(); // unknown field
    }
    for (const [field, subShape] of Object.entries(shapeObj)) {
      if (!(field in valueObj)) failValue(); // missing required field
      validateShape(valueObj[field], subShape, def, def.fieldRules?.[field]);
    }
    return;
  }
  failValue();
}

/**
 * Rule settings (specs §6.4, F-904, SCR-A10): `list` is the read-only
 * core — every §5.2 setting with its current value (stored row or the
 * seeded default), its validation range and its spec reference.
 * `update` (below) is the P7 if-time part, behind
 * `features.settingsEdit`.
 */
export const list = adminQueryV({
  args: {},
  handler: async (ctx) => {
    const stored = await ctx.db.query("settings").collect();
    const byKey = new Map(stored.map((row) => [row.key, row.value]));
    return SETTING_DEFS.map((def) => ({
      key: def.key,
      value: byKey.has(def.key) ? byKey.get(def.key) : def.value,
      defaultValue: def.value,
      isDefault: !byKey.has(def.key) || byKey.get(def.key) === def.value,
      range: def.range ?? null,
      ref: def.ref,
      fixed: def.key === "minAge", // S-01 can never be lowered (specs §5.2)
    }));
  },
});

/**
 * admin.settings.update (specs §6.4, F-904 if-time part, SCR-A10) —
 * behind `features.settingsEdit`. Validation is VAL-19: numeric
 * values must sit inside the §5.2 range recorded in SETTING_DEFS;
 * scalar types must match the default's type; the two feature-flag
 * objects (`features`, `ai.features`) accept only known boolean
 * subkeys; every other object/array value is shape-validated against
 * its default's structure by `validateShape` (exact field set,
 * primitive types, per-field §5.2 ranges/formats from SETTING_DEFS).
 * `minAge` (S-01) is fixed and refuses all edits. A reason
 * is required and every change is audited as `setting_changed`.
 * "Reset to default" is this same mutation with the default value.
 */
export const update = adminMutationV({
  args: { key: v.string(), value: v.any(), reason: v.string() },
  handler: async (ctx, args) => {
    if (!(await featureOn(ctx, "settingsEdit"))) fail("ERR_VALIDATION", {}, "feature");
    const def = SETTING_DEFS.find((d) => d.key === args.key);
    if (!def) fail("ERR_VALIDATION", {}, "key");
    if (args.key === "minAge") fail("ERR_VALIDATION", {}, "key"); // S-01 fixed
    const reason = args.reason.trim();
    if (reason.length < 3 || reason.length > 200) fail("ERR_VALIDATION", {}, "reason");

    const value = args.value;
    const defaultValue = def.value;
    if (typeof defaultValue === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        fail("ERR_VALIDATION", {}, "value");
      }
      if (def.range && (value < def.range[0] || value > def.range[1])) {
        fail("ERR_VALIDATION", { min: def.range[0], max: def.range[1] }, "value");
      }
    } else if (typeof defaultValue === "boolean") {
      if (typeof value !== "boolean") fail("ERR_VALIDATION", {}, "value");
    } else if (typeof defaultValue === "string") {
      if (typeof value !== "string" || value.length > 500) {
        fail("ERR_VALIDATION", {}, "value");
      }
    } else if (
      (args.key === "features" || args.key === "ai.features") &&
      defaultValue !== null &&
      typeof defaultValue === "object"
    ) {
      // Feature-flag maps: known boolean subkeys only — a typo'd key
      // must never silently create a dead switch.
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        fail("ERR_VALIDATION", {}, "value");
      }
      const allowed = defaultValue as Record<string, unknown>;
      for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
        if (!(subKey in allowed) || typeof subValue !== "boolean") {
          fail("ERR_VALIDATION", {}, "value");
        }
      }
    } else if (defaultValue !== null && typeof defaultValue === "object") {
      // Every remaining object/array setting (S3-F1): shape-validate
      // against the default's structure — no value reaches storage
      // unchecked. Runs before any write, so a failure stores nothing.
      validateShape(value, defaultValue, def);
    }

    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    const from = row ? row.value : def.value;
    if (row) {
      await ctx.db.patch(row._id, { value, updatedBy: ctx.profile._id });
    } else {
      await ctx.db.insert("settings", { key: args.key, value, updatedBy: ctx.profile._id });
    }
    await writeAudit(ctx, {
      actor: ctx.profile,
      action: "setting_changed",
      targetType: "settings",
      targetId: args.key,
      reason,
      meta: { from, to: value },
    });
    return { key: args.key, value };
  },
});
