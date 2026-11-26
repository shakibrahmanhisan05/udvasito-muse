import { adminQueryV } from "../_lib/auth";
import { SETTING_DEFS } from "../_lib/settingsData";

/**
 * Rule settings — READ-ONLY core (specs §6.4, F-904 core part,
 * SCR-A10): every §5.2 setting with its current value (stored row or
 * the seeded default), its validation range and its spec reference,
 * so an admin can SEE the rules the platform runs on. Editing is the
 * P7 if-time part (admin.settings.update) and is deliberately absent
 * here — there is no write function in this module.
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
