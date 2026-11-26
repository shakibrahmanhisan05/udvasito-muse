import { test, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { E2E_BASE_URL, PRACTICE, hasPracticeEnv, practiceSignIn } from "./practice";

/**
 * X04 accessibility gate (specs §7.2): axe-core over the 10 key pages,
 * zero serious/critical violations. Specs §7.2 names the pages by
 * their design routes (/request/new, /alerts/[id], /donor/setup …);
 * the list below uses the routes Expo Router actually serves for the
 * same screens. In this signed-out pass, auth-gated pages redirect to
 * the sign-in/welcome surface — the audit covers that surface, which
 * is the honest unauthenticated state of those URLs. The signed-in
 * states are audited by the authenticated pass at the bottom of this
 * file (practice sign-in against a deployed target, P7 / P6 review
 * S3-F1), and are otherwise covered by the component contracts in
 * tests/p6-client.test.ts and the TalkBack run in the human QA
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

async function auditPage(page: import("@playwright/test").Page, name: string) {
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
}

for (const { path, name } of PAGES) {
  test(`axe: ${name} (${path}) has no serious/critical violations`, async ({ page }) => {
    await page.goto(path, { waitUntil: "networkidle" });
    await auditPage(page, name);
  });
}

/**
 * Authenticated pass (P7, closing P6 review S3-F1): the five gated
 * pages above audited in their real signed-in state, inside the
 * practice wall, against a deployed target. The requester practice
 * account covers /home and /request-new; the donor practice account
 * covers /alerts and /donor-setup; /admin needs an admin practice
 * account (E2E_ADMIN_ID / E2E_ADMIN_PIN) and is skipped — with the
 * reason stated — when none is configured. The whole block skips
 * when no practice target is configured, exactly like the smoke
 * test; CI runs it under the same E2E_ENABLED gate (e2e.yml).
 */
const AUTH_PAGES: { path: string; name: string; account: "requester" | "donor" | "admin" }[] = [
  { path: "/home", name: "SCR-H01 home (signed in)", account: "requester" },
  { path: "/request-new", name: "SCR-R01 request form (signed in)", account: "requester" },
  { path: "/alerts", name: "SCR-D02 alerts (signed in)", account: "donor" },
  { path: "/donor-setup", name: "SCR-D01 donor setup (signed in)", account: "donor" },
  { path: "/admin", name: "SCR-A01 admin (signed in)", account: "admin" },
];

test.describe("axe: authenticated pages (practice sign-in)", () => {
  test.skip(
    !hasPracticeEnv,
    "needs E2E_BASE_URL + practice credentials on a deployed target (see tests/e2e/README.md)",
  );

  for (const { path, name, account } of AUTH_PAGES) {
    test(`axe: ${name} (${path}) has no serious/critical violations`, async ({ browser }) => {
      const creds =
        account === "requester"
          ? { id: PRACTICE.requesterId!, pin: PRACTICE.requesterPin! }
          : account === "donor"
            ? { id: PRACTICE.donorId!, pin: PRACTICE.donorPin! }
            : { id: PRACTICE.adminId, pin: PRACTICE.adminPin };
      test.skip(
        !creds.id || !creds.pin,
        `needs an E2E_${account.toUpperCase()}_ID / PIN practice account for this page`,
      );
      const context = await browser.newContext();
      const page = await context.newPage();
      await practiceSignIn(page, E2E_BASE_URL!, creds.id!, creds.pin!);
      await page.goto(`${E2E_BASE_URL}${path}`, { waitUntil: "networkidle" });
      await auditPage(page, name);
      await context.close();
    });
  }
});
