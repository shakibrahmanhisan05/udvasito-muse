/**
 * seed:staging (CLAUDE.md §4) — fake donors/requests for STAGING ONLY.
 * Refuses to run against production in two independent ways: the --prod
 * flag and a production-looking CONVEX_DEPLOYMENT (roadmap §2.6 rule 4,
 * specs §1.9: production holds only real data).
 */
const deployment = process.env.CONVEX_DEPLOYMENT ?? "";
if (process.argv.includes("--prod") || /prod/i.test(deployment)) {
  console.error("seed:staging — REFUSING to run against production. Staging only.");
  process.exit(1);
}
console.log(
  "seed:staging — staging deployment confirmed. Fake-data generation lands\n" +
    "with the staging deployment in P0 Day 2 / P1 (roadmap §2.5): donors across\n" +
    "all 8 groups and Chattogram thanas, flagged isDemo where applicable.",
);
