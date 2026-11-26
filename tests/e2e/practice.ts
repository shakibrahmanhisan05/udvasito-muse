import { expect, type Page } from "@playwright/test";

/**
 * Shared practice-area sign-in for the e2e suites (smoke + the
 * authenticated axe pass). The practice sheet on SCR-002 works like
 * this (verified against app/(onboarding)/sign-in.tsx in P7 — the
 * smoke spec previously skipped both steps and would have failed on
 * its first real run):
 *   1. tap "Practice sign-in (for judges and training)" — opens the
 *      sheet (the fields do not exist before this tap);
 *   2. fill "Practice ID" + "6-digit PIN" (accessibility labels from
 *      src/i18n/en.json: signin.practiceId / signin.practicePin);
 *   3. tap the same-labelled button inside the sheet to submit.
 * Success is proven by the PRACTICE pill (common.demo) that every
 * practice screen carries.
 */
export const E2E_BASE_URL = process.env.E2E_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;

export const PRACTICE = {
  requesterId: process.env.E2E_PRACTICE_ID,
  requesterPin: process.env.E2E_PRACTICE_PIN,
  donorId: process.env.E2E_DONOR_ID,
  donorPin: process.env.E2E_DONOR_PIN,
  adminId: process.env.E2E_ADMIN_ID,
  adminPin: process.env.E2E_ADMIN_PIN,
};

export const hasPracticeEnv = Boolean(
  E2E_BASE_URL && PRACTICE.requesterId && PRACTICE.requesterPin && PRACTICE.donorId && PRACTICE.donorPin,
);

export async function practiceSignIn(page: Page, base: string, id: string, pin: string) {
  await page.goto(`${base}/sign-in`);
  const practiceButtons = page.getByRole("button", {
    name: "Practice sign-in (for judges and training)",
  });
  // Step 1: open the sheet.
  await practiceButtons.first().click();
  // Step 2: fill the sheet's fields.
  await page.getByLabel("Practice ID").fill(id);
  await page.getByLabel("6-digit PIN").fill(pin);
  // Step 3: submit — the sheet's own button carries the same label.
  await practiceButtons.last().click();
  // The PRACTICE pill (common.demo) proves we are inside the wall.
  await expect(page.getByText("PRACTICE", { exact: true }).first()).toBeVisible({
    timeout: 20_000,
  });
}
