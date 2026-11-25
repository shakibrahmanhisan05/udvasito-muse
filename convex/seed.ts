import { internalMutationGeneric } from "convex/server";
import { SETTING_DEFS } from "./_lib/settingsData";
import { validateSettingValue } from "./_lib/settings";

/**
 * seedSettings (CLAUDE.md §4 `seed:settings`) — idempotent: inserts any
 * missing settings row from specs §5.2 and never overwrites a value an admin
 * has changed. Safe to run against production (roadmap §2.6 rule 4).
 * Run: npx convex run seed:seedSettings [--prod]
 */
export const seedSettings = internalMutationGeneric({
  args: {},
  handler: async (ctx) => {
    let inserted = 0;
    for (const def of SETTING_DEFS) {
      validateSettingValue(def.key, def.value);
      const existing = await ctx.db
        .query("settings")
        .withIndex("by_key", (q) => q.eq("key", def.key))
        .unique();
      if (!existing) {
        await ctx.db.insert("settings", { key: def.key, value: def.value });
        inserted++;
      }
    }
    return { inserted, total: SETTING_DEFS.length };
  },
});
