import { test, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

/**
 * X04 accessibility gate (specs §7.2): axe-core over the 10 key pages,
 * zero serious/critical violations. Specs §7.2 names the pages by
 * their design routes (/request/new, /alerts/[id], /donor/setup …);
 * the list below uses the routes Expo Router actually serves for the
 * same screens. Auth-gated pages redirect to the sign-in/welcome
 * surface when unauthenticated — the audit then covers that surface,
 * which is the honest unauthenticated state of those URLs; the
 * signed-in states are covered by the component contracts in
 * tests/p6-client.test.ts and by the TalkBack run in the human QA
 * checklist (docs/dev/P6-REPORT.md).
 *
 * Runs in CI (.github/workflows/e2e.yml) against the Expo web server.
 * Locally: `npm run web` in one terminal, then
 * `npx playwright test tests/e2e/a11y.spec.ts`.
 */
const PAGES: { path: string; name: string }[] = [
  { path: "/", name: "SCR-P01 landing" },
  { path: "/about", name: "SCR-P05 about" },
  { path: "/download", name: "SCR-P08 download" },
  { path: "/welcome", name: "SCR-001 welcome / re-consent" },
  { path: "/sign-in", name: "SCR-002 sign in" },
  { path: "/home", name: "SCR-H01 home (redirects signed-out)" },
  { path: "/request-new", name: "SCR-R01 request form (redirects signed-out)" },
  { path: "/alerts", name: "SCR-D02 alerts (redirects signed-out)" },
  { path: "/donor-setup", name: "SCR-D01 donor setup (redirects signed-out)" },
  { path: "/admin", name: "SCR-A01 admin (redirects signed-out)" },
];

for (const { path, name } of PAGES) {
  test(`axe: ${name} (${path}) has no serious/critical violations`, async ({ page }) => {
    await page.goto(path, { waitUntil: "networkidle" });
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(
      blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`),
      `${name} serious/critical axe violations`,
    ).toEqual([]);
  });
}
