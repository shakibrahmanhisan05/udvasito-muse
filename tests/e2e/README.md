# E2E tests

Playwright suites:

- `a11y.spec.ts` — the X04 axe gate (zero serious/critical) over 10 key
  pages signed-out, plus an **authenticated pass** over the 5 gated
  pages signed in through the practice wall (P7, closing P6 review
  S3-F1).
- `smoke.spec.ts` — the practice-area loop: post → match → accept,
  entirely inside the practice wall.
- `practice.ts` — the shared practice sign-in helper (opens the
  SCR-002 practice sheet, fills ID + PIN, submits, asserts the
  PRACTICE pill). Both suites use it; if the sign-in screen changes,
  fix the flow here once.

## Running

Signed-out axe (CI runs this on every PR; locally it boots the Expo
web server itself via `playwright.config.ts`):

```
npx playwright test tests/e2e/a11y.spec.ts --grep-invert "authenticated"
```

Deployed-target suites (smoke + authenticated axe) need a deployed
web app with the practice area enabled and practice accounts seeded.

## Enabling the deployed-target suites (one-line change)

Everything code-side is ready (P7). To turn them on:

1. In the GitHub repo: **Settings → Secrets and variables → Actions →
   Variables**: set `E2E_ENABLED` to `true` and `E2E_BASE_URL` to the
   deployed web app URL (e.g. the staging Vercel URL). ← the one line
2. Same place, **Secrets**: `E2E_PRACTICE_ID`, `E2E_PRACTICE_PIN`
   (requester), `E2E_DONOR_ID`, `E2E_DONOR_PIN` (donor), and
   optionally `E2E_ADMIN_ID`, `E2E_ADMIN_PIN` (without these, only
   the `/admin` axe audit skips — with its reason stated).
3. On the target deployment (once, by an admin in SCR-A10 Practice
   area): enable the practice area, create the requester + donor
   practice accounts, make the donor a **live B+ donor** whose area
   covers the seeded practice hospital, and note the IDs/PINs for
   step 2.

The `smoke` and `a11y-auth` jobs in `.github/workflows/e2e.yml` pick
the configuration up automatically; `playwright.config.ts` detects
`E2E_BASE_URL` and does not boot a local server for those runs.
