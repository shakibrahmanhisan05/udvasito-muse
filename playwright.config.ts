import { defineConfig } from "@playwright/test";

// Web smoke tests (practice area) arrive with their specs in P1/P5
// (roadmap §2.1, specs §7.7). This config is the contract from CLAUDE.md §4.
//
// P7 (P6 review S3-F2): when E2E_BASE_URL names a deployed target,
// Playwright must NOT boot a local Expo server — the smoke test and
// the authenticated axe pass run against the deployment. The local
// webServer below only applies to the default (CI axe) flow, where
// no E2E_BASE_URL is set. Enabling the deployed-target suites is
// therefore a one-line change: set the E2E_ENABLED repo variable
// (plus E2E_BASE_URL + the practice secrets) — see tests/e2e/README.md.
const deployedTarget = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: deployedTarget ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8081",
  },
  ...(deployedTarget
    ? {}
    : {
        webServer: {
          command: "npm run web",
          url: "http://localhost:8081",
          reuseExistingServer: true,
        },
      }),
});
