import { defineConfig } from "@playwright/test";

// Web smoke tests (practice area) arrive with their specs in P1/P5
// (roadmap §2.1, specs §7.7). This config is the contract from CLAUDE.md §4.
export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8081" },
  webServer: {
    command: "npm run web",
    url: "http://localhost:8081",
    reuseExistingServer: true,
  },
});
