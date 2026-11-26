import { test, expect } from "@playwright/test";
import { E2E_BASE_URL as BASE, PRACTICE, hasPracticeEnv, practiceSignIn } from "./practice";

/**
 * Practice-area smoke test (roadmap P6 / PRD §2.3 shape):
 * post → match → accept, entirely inside the PRACTICE wall.
 *
 * It runs only when a deployed target with practice accounts is
 * configured — locally it skips cleanly:
 *   E2E_BASE_URL            deployed web app (staging or production)
 *   E2E_PRACTICE_ID         requester practice ID   (secret)
 *   E2E_PRACTICE_PIN        requester practice PIN  (secret)
 *   E2E_DONOR_ID            donor practice ID       (secret)
 *   E2E_DONOR_PIN           donor practice PIN      (secret)
 *
 * Preconditions on the target (set up once by an admin in SCR-A10):
 * the donor practice account is a LIVE B+ donor whose area covers
 * the seeded practice hospital the requester posts at, so wave 1
 * matches immediately. Selectors use the EN accessibility labels
 * from src/i18n/en.json (the app's controls all carry them — X04).
 *
 * CI: .github/workflows/e2e.yml runs this before production deploys
 * when the repo variable E2E_ENABLED=true and the secrets exist.
 * The sign-in flow itself lives in ./practice.ts (shared with the
 * authenticated axe pass) — P7 verified it against the real sheet
 * behaviour of SCR-002 and fixed the drift noted there.
 */
const REQ_ID = PRACTICE.requesterId;
const REQ_PIN = PRACTICE.requesterPin;
const DONOR_ID = PRACTICE.donorId;
const DONOR_PIN = PRACTICE.donorPin;

test.describe("practice area: post → match → accept", () => {
  test.skip(
    !hasPracticeEnv,
    "needs E2E_BASE_URL + practice requester/donor credentials (see header)",
  );

  test("the full loop", async ({ browser }) => {
    const requester = await browser.newContext();
    const reqPage = await requester.newPage();
    await practiceSignIn(reqPage, BASE!, REQ_ID!, REQ_PIN!);

    // Post: home → request form.
    await reqPage.getByRole("button", { name: "Request blood now" }).click();
    await expect(reqPage.getByText("Request blood", { exact: true })).toBeVisible();
    await reqPage.getByRole("button", { name: "B+", exact: true }).click();
    // Hospital: the seeded practice hospital directory.
    await reqPage.getByLabel("Search hospital or area").fill("Medical");
    const hospital = reqPage.getByText(/Medical/i).last();
    await expect(hospital).toBeVisible({ timeout: 15_000 });
    await hospital.click();
    // Needed tomorrow; contact number is prefilled from the profile.
    await reqPage.getByRole("button", { name: "Tomorrow" }).click();
    const contact = reqPage.getByLabel("Contact number");
    if ((await contact.inputValue()).trim() === "") {
      await contact.fill("01712345678");
    }
    await reqPage.getByRole("button", { name: "Post request" }).click();
    await expect(reqPage).toHaveURL(/request-live/, { timeout: 20_000 });

    // Match + accept: the donor sees the alert and confirms.
    const donor = await browser.newContext();
    const donorPage = await donor.newPage();
    await practiceSignIn(donorPage, BASE!, DONOR_ID!, DONOR_PIN!);
    await donorPage.goto(`${BASE}/alerts`);
    const alertCard = donorPage.getByText(/B\+.*needed/i).first();
    await expect(alertCard).toBeVisible({ timeout: 30_000 });
    await alertCard.click();
    await donorPage.getByRole("button", { name: "I can help" }).click();
    // Self-check (SCR-D03) then the confirmed state.
    await donorPage.getByText(/I feel well today/i).click();
    await expect(donorPage.getByText(/You're confirmed/i)).toBeVisible({
      timeout: 20_000,
    });

    await requester.close();
    await donor.close();
  });
});
