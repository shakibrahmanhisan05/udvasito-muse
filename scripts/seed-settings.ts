/**
 * seed:settings (CLAUDE.md §4) — runs the idempotent internal mutation
 * convex/seed.ts:seedSettings against the deployment in CONVEX_DEPLOYMENT.
 * Safe on production (roadmap §2.6). Without a deployment configured this
 * prints the exact human step instead of failing silently.
 */
import { spawnSync } from "node:child_process";

if (!process.env.CONVEX_DEPLOYMENT && !process.argv.includes("--prod")) {
  console.log(
    "seed:settings — no Convex deployment configured yet (RB-2).\n" +
      "After `npx convex login` and project creation, run:\n" +
      "  npx convex run seed:seedSettings            (staging/dev)\n" +
      "  npx convex run seed:seedSettings --prod     (production)",
  );
  process.exit(0);
}
const args = ["convex", "run", "seed:seedSettings"];
if (process.argv.includes("--prod")) args.push("--prod");
const res = spawnSync("npx", args, { stdio: "inherit" });
process.exit(res.status ?? 1);
