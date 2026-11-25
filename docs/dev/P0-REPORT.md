# P0 Report — Setup and foundations

**Date:** 2026-11-26 · **Phase:** P0 (roadmap §3, Day 0–2) · **Status:** 🟦 Code complete + QA fix pass applied. Definition of Done items that need live accounts or physical devices are open and listed below — nothing is claimed done without evidence (specs §1.9).

**Review gate (team rule, 2026-11-26):** this work does NOT merge to `main` directly. It will be pushed to branch `p0-foundations` and land via a pull request reviewed by an independent agent against the QA quality gates (`quality-gates.md`). Local commits below are work-in-progress until that PR is approved.

Format follows CLAUDE.md §3.7.

---

## Done (slices, with commit hashes)

| Commit | Slice |
|---|---|
| `c164293` | **Scaffold** — Expo Router + TypeScript strict, folder contract (specs §1.2), app identity (§1.2.1: package `org.udvasito.app`, scheme `udvasito`, fingerprint runtime, notification channel `blood-requests`), EAS profiles, spec docs in `docs/`, `CLAUDE.md`, MIT LICENSE, `.env.example` (names only), brand assets placed per the Brand Kit README table |
| `52608c3` | **Convex** — complete §5.1 schema, §5.2 settings seed, `_lib` (auth wrappers, errors, settings, audit, events, visibility), Better Auth component wiring, `profiles.me`, `public.appConfig`, `admin.bootstrap` + `admin.ops` |
| `de75413` | **Design system, i18n, screens, rules** — §1.3 tokens, fonts, base components, EN/BN i18n, root gates, P0 screens; pure rules (eligibility + compatibility full) + all tests |
| `c892575` | **CI & docs** — GitHub Actions CI + manual Android local-build workflow, README, `docs/spikes.md`, `docs/questions.md`, `docs/data-licences.md`, CHANGELOG, roadmap P0 marked 🟦 |
| `35f9405` | **QA fix pass 1** — SDK 57 alignment (D1) + i18n lint gate (D2) |
| `93061e6` | **QA fix pass 2** — real places dataset + count test (D4) |
| `5faa44b` | **QA fix pass 3** — hospitals + FAQ seed data (D6) |
| `00d0b10` | **QA fix pass 4** — CI audit + Dependabot (D3); service worker, share-link function, phone/helpline libs, CSP fix (D7/D8) |
| `9d1850d` | **QA fix pass 5** — this report + changelog |

### What was built, in detail

- **Schema (`convex/schema.ts`)** — the complete specs §5.1 schema copied verbatim: 27 tables (profiles, donorProfiles, volunteerProfiles, consents, phoneVerifications, blocks, places, hospitals, requests, responses, contactReveals, notifications, webPushSubscriptions, reports, moderationItems, auditLog, settings, faqEntries, campaigns, invitations, aiCalls, aiQuota, events, dailyRollups, statsSnapshots, usageCounters, exports) with all indexes, search indexes and `isDemo` fields.
- **Settings (`convex/_lib/settingsData.ts` + `seed.ts`)** — every §5.2 row seeded as individual keys (grouped rows expanded: 61 stored keys covering the 51 setting groups), each with its allowed range; `validateSettingValue` enforces ranges and pins `minAge` at 18. `seedSettings` is idempotent and never overwrites admin-changed values (verified by convex-test).
- **`convex/_lib/`** — `auth.ts` wrappers (`memberQuery/Mutation`, `donorMutation`, `volunteer*`, `admin*`, `superadminMutation`) enforcing sign-in → active status → role → demo isolation; `errors.ts` with all 24 `ERR_` codes from §6.7; `settings.ts` typed reader; `audit.ts`; `events.ts` (rejects phone/name keys in props, §1.8); `visibility.ts` — the only phone-reveal path, writing `contactReveals` + `auditLog` (§6.0 📞 rule).
- **Auth (ADR-003)** — `convex.config.ts` registers Better Auth, Expo Push Notifications and Rate Limiter components. `convex/auth.ts` builds the Better Auth instance: Google provider only when `GOOGLE_CLIENT_ID/SECRET` exist in the Convex env; email+password only when `BETTER_AUTH_EMAIL_ENABLED=1` (staging tests / practice sign-in, P-10/D-R4). Client: `src/lib/auth-client.ts` (better-auth/react + convex plugin). When the backend is not configured, the sign-in screen shows the `signin.notConfigured` state — **sign-in is never faked** (§1.9).
- **Design system** — all §1.3.1 colour tokens, typography, spacing/radius/touch tokens in `src/theme/tokens.ts`; Noto Sans + Noto Sans Bengali (400/600/700) via @expo-google-fonts; NativeWind v4 configured (babel + metro + tailwind with brand colours). Components: Button, Skeleton, Banner, ErrorState, OfflineBanner, LanguageToggle, PracticeBadge, EmptyState, Sheet/Dialog, Toast, Markdown (restricted subset per §1.3.5).
- **i18n** — `src/i18n/en.json` + `bn.json`, **106 keys each, parity verified**: all of §3.0 common copy, §3.1 welcome + sign-in copy, §3.2 home copy, update-required copy, nav, 404, and every `errors.<CODE>` string from §6.7 — real copy extracted from specs, Bangla as drafted in specs (§1.6: member 3 reviews before launch). Language detection per F-104 (EN default, BN for Bangla devices, persisted toggle, `?lang=` support in the detector). The **complete** §3 copy extraction (QA D5) is a parallel workstream and merges on top of this file structure without key conflicts (same nested-key convention).
- **Screens (P0 scope only)** — root `app/_layout.tsx` with providers (Convex when configured, i18n, fonts, Toast, OfflineBanner, Sentry, service-worker registration on web) and gates: **G1 version, G2 fonts/i18n, G3 consent live; G4 session live when configured; G5/G6/G7 skeleton hooks** (they activate with `profiles.me` wiring in P1, when their redirect targets SCR-O03/O06 exist). `app/index.tsx` redirects per the P1 posture (→ /welcome or /home). Screens: `/welcome` (SCR-O01, real consent flow writing the local G3 record), `/sign-in` (SCR-O02), `/(app)/home` (SCR-M01 P0 empty state — only working controls, build-prompts P0 #10), `/(app)/more`, `/update-required` (SCR-O05), `+not-found` (SCR-P09). Tabs for later phases are **not shown** (§1.9).
- **Pure rules (`convex/rules/`)** — `eligibility.ts` and `compatibility.ts` **fully implemented** from PRD §5.1/§5.2 (age 18–65 in Asia/Dhaka calendar, 90/120/14-day intervals, derived `eligibleFrom`/`eligibleFromPlatelets` per §5.4, full compatibility table, platelets exact-only, `any`/`not_sure`); `waves.ts`, `limits.ts`, `ranking.ts` (place tiers) and `redaction.ts` (PRD §6.2 categories: BD phones in both digit systems, emails, ID-like numbers, name labels, diagnosis words) implemented; `intakeParser.ts` is a typed stub returning the §6.10 contract's empty result — full parser is P4 (F-206). The data pack's 40-case intake test set (`intake.jsonl`) is on file for P4.
- **Places (ADR-013)** — real dataset seeded: see the QA fix pass section.
- **Scripts (CLAUDE.md §4 contract)** — all commands exist: `dev`, `convex`, `check`, `test`, `test:e2e`, `copy:extract` (parity verifier), `content:build` (real Markdown→blocks JSON), `seed:settings`, `seed:places` (real pipeline, below), `import:hospitals` (real CSV validation per roadmap §5.1: required columns, BD bounds, duplicate detection, bad-row report; mobile-format institutional numbers are warnings with per-row provenance in `data/SOURCES.md`, not rejections), `seed:staging` (**refuses production two ways** — verified), `build:web`.
- **Sentry** — `src/lib/sentry.ts` + `src/lib/scrub.ts`: `beforeSend`/`beforeBreadcrumb` deep-scrub anything shaped like a BD phone number (Latin + Bangla digits); disabled when no DSN is set.
- **Native modules installed & configured in P0** (roadmap list): expo-notifications, expo-speech-recognition, expo-location, expo-image-picker, expo-image-manipulator, expo-secure-store, expo-updates, @sentry/react-native. MapLibre deliberately **not** installed (P7, D-R2).
- **Brand assets** — from Brand Kit v1.0: `assets/icon.png`, `adaptive-icon.png` (background `#C1121F` in app config), `splash-icon.png`, `splash.png`, `notification-icon.png`, `assets/logo/*.svg` (symbol + wordmark), `public/favicon.png/.ico`, `icon-192/512.png`, `apple-touch-icon.png`, `og-image.png`, plus PWA `public/manifest.json` and `public/service-worker.js` (push + offline shell, registered from the root layout on web).

## QA fix pass (2026-11-26) — response to the independent QA review

The QA review (`p0-review.md`, snapshot at commit `de75413` + moving working tree) raised D1–D10. Disposition:

- **D1 (SDK 58 vs ADR-001's SDK 57) — FIXED by downgrading to SDK 57.** Method: a scratch copy of the repo was aligned with `npx expo install --fix` after pinning `expo ~57.0.0` (+ `expo-speech-recognition@~57.1.0`, the SDK-57 line of that third-party package), and the **full suite passed there first** (tsc exit 0, Vitest 32/32 at the time, ESLint 0 errors, `expo config` exit 0). Only then were the aligned `package.json`/`package-lock.json` applied to the repo and the suite re-run green. Result: expo ~57.0.0, expo-router ~57.0.32, React Native 0.86.3, React 19.2.3 — exactly ADR-001/roadmap/specs §7.3. No ADR change is needed; SDK 58 returns to its roadmap P7 "later" slot. `docs/questions.md` records the resolution. (First scratch attempt failed on ENOSPC — `/tmp` is a 512 MB tmpfs in this sandbox; the test was re-run on the home volume. Environment artefact, not an SDK result.)
- **D2 (i18next/no-literal-string gate) — FIXED.** `eslint-plugin-i18next` is installed; the rule runs as an **error** for `app/**` + `src/**` in `jsx-only` mode with checked JSX attributes (title, placeholder, accessibilityLabel, headerTitle, alt, label) inside `npm run check`. Proof required by QA: a scratch component containing `<Text>Hardcoded English sentence</Text>` was planted at `src/components/__PlantProof.tsx` → ESLint reported exactly 1 `i18next/no-literal-string` error → scratch file removed. Real findings fixed: welcome screen now uses `APP_LANGUAGES` from `src/lib/i18n.ts` and new keys `common.languageBn`/`common.languageEn` (106 keys total); typographic symbols (✓, •) and language proper nouns are excluded in the rule config with a comment. The TODO comment is gone from `eslint.config.js`.
- **D3 (CI) — FIXED / partly pre-existing.** `.github/workflows/ci.yml` + `android-local-build.yml` landed in commit `c892575`, after the QA snapshot (the snapshot's `.github/` was empty because it predates that commit). Added in this pass per specs §7.4: an `npm audit --omit=dev --audit-level=high` step in CI and `.github/dependabot.yml` (npm weekly, grouped minor/patch; github-actions weekly). ⚠️ The audit step could **not** be evidenced locally: `npm audit` returns an endpoint error from this sandbox (tried twice, `POST /-/npm/v1/security/audits/quick` fails). First CI run on GitHub is the evidence — the reviewer should check it in the PR's Actions tab.
- **D4 (places dataset) — FIXED with the real dataset.** Source decision by the data workstream: **nuhil/bangladesh-geocode** @ `c4b950b5cd2a65d42d75b12f7fad459e12777df6` (MIT; layered CC BY-IGO BBS/HDX + CC BY 4.0 GeoNames — all recorded in `docs/data-licences.md`). The 6-point pre-seed checklist was followed: (1) metro-thana gap confirmed by grep — no Kotwali/Panchlaish rows under Chattogram; (2) empty lat/lon rows: **0** at every level, so no coordinate gap-fill was needed; (3) name diff vs HDX COD-AB **v03** (valid 2023-05-21): all 495 primary upazila names match HDX exactly, HDX adds only the 12 city-corporation units; (4) post-transform counts: **8 divisions / 64 districts / 495 upazilas / 582 total rows**, every row has nameBn and an in-bounds coordinate; (5) hospital cross-check automated in tests (below); (6) licences recorded. Metro thanas: 15 Chattogram CCC thanas seeded as upazila-equivalents (`isMetroThana`) — centres from geoBoundaries ADM3 polygon centroids (11), GeoNames points (EPZ, Sadarghat), and **district-point fallbacks for Akbarshah + Chawkbazar** (no licence-clean point exists in any approved source; the postcode dataset's city points are one repeated default and were rejected as unusable). Fallbacks are flagged `pointSource: "district-fallback"` in `data/places.json` and await member 2's verified points — **no coordinate was invented**. Karnaphuli needs no added row: it already exists as a regular upazila in the primary dataset, so all 16 CCC thana names resolve. GADM was never used (licence-disqualified). Neighbours: haversine ≤ `neighbourKm` (S-32 = 10 km) within district, computed at seed time; all 15 metro thanas have 9–15 neighbours (dense city linking, the notes' sanity check). Note: most *rural* upazilas have 0 neighbours at 10 km — geographically expected (large rural upazilas); the radius is an admin setting (S-32) if the team wants denser rural linking. `scripts/seed-places.ts` is now the real pipeline (build → validate → write `data/places.json` + `src/data/places.min.json` → Convex upsert when `CONVEX_URL`/`CONVEX_DEPLOY_KEY` are set), `convex/places.ts` has the idempotent `internal.places:seedPlaces` upsert + public `children` picker query, and **`tests/places.test.ts` is the count test** (counts, all-16 thana names, metro-neighbour density, symmetry via `validatePlaces`, hospitals cross-check, min.json parity).
- **D5 (full §3 copy extraction) — parallel workstream**, merged by the main agent after P0; not duplicated here.
- **D6 (hospitals.csv) — data landed.** `data/hospitals.csv` (23 rows, exact §5.1 contract) + `data/faq.csv` (draft; `reviewedBy`/`reviewedOn` empty — importers must keep FAQ rows draft) + `data/SOURCES.md` (per-row provenance and ⚠️ verification flags travel with the data). Importer result: **23 valid, 0 bad** (6 mobile-format institutional numbers are warnings per SOURCES.md provenance, pending member 2's verification calls).
- **D7 (folder-contract extras) — FIXED for the P0-relevant items.** `public/service-worker.js` written (push handler per §6.8 payload shape + offline shell) and registered on web from the root layout. `api/r/[slug].ts` written per §6.5 (OG HTML + meta-refresh to `/r/<slug>`, branded 404 when the slug is unknown; reads `public:sharedRequestBySlug`, which lands with SCR-P02 — until then every slug honestly 404s rather than fabricating a preview) + the `/r/:slug` rewrite added to `vercel.json` ahead of the SPA fallback. `src/lib/phone.ts` (BD normalise/validate/format, Bangla-digit aware, unit-tested) and `src/lib/helpline.ts` (`helplineFromPhone` + `useHelpline()` per D-R3 — returns null until the P1 `GET /public/helpline` endpoint exists, so no dead button renders) added. Remaining lib modules (`outbox.ts`, `dates.ts`, `events.ts`, `platform.ts`, `speech.ts`, `location.ts`, `push.ts`) are P1/P4 work, as QA itself scoped them.
- **D8 (CSP) — FIXED.** `vercel.json` CSP now includes OpenFreeMap (`https://tiles.openfreemap.org`, `https://openfreemap.org` in connect-src; tiles host in img-src) and `worker-src 'self' blob:` for the future MapLibre worker. The `script-src/style-src 'unsafe-inline'` deviation from the §7.4 template remains — Expo web exports currently require it; flagged for the P6 security pass to revisit consciously, per QA.
- **D9 (convex-test hand-wired module map) — accepted as tracked risk.** Real codegen requires a linked deployment; the Convex staging project now exists (see Human steps) and CLI linking is the next step after this PR. When `_generated` is committed, tests switch to glob discovery + a CI assertion that every public module is registered. The hand-wired map currently covers all P0 modules with public functions (`seed`, `public`, `profiles`).
- **D10 (account-dependent DoD) — unchanged, listed honestly below.** One item advanced since the review: the Convex staging project exists (created by Shakib): team `shakib-hisan`, project `udvasito-staging`, dev deployment `robust-lark-146` (`https://robust-lark-146.convex.cloud`). CLI linking from this repo is still pending (needs Shakib to approve the login in his Chrome).

## Verification results (exact commands, re-run after the QA fix pass)

| Command | Result |
|---|---|
| `npm run check` (= `tsc --noEmit && eslint . && vitest run`) | ✅ **exit 0** |
| `npx tsc --noEmit` | ✅ pass, 0 errors (on SDK 57) |
| `npx vitest run` | ✅ **42/42 tests pass** (7 files: rules 17, convex-test 3, settings 4, auth-lib 4, scrub 4, places 6, phone 4) |
| `npx eslint .` | ✅ 0 errors, 6 warnings (i18next default-member import style ×3 in `src/lib/i18n.ts`, others minor) — includes `i18next/no-literal-string` as an error rule; planted-literal proof in D2 above |
| `npm run copy:extract` | ✅ 106 keys EN, 106 BN, parity OK |
| `npm run seed:places` | ✅ 582 rows written (8/64/495 + 15 metro thanas), validation clean, 2 flagged district-point fallbacks |
| `npm run import:hospitals` | ✅ 23 valid rows, 0 bad rows (6 provenance warnings) |
| `npm run content:build` | ✅ runs (generates from `src/content/*.md`) |
| `npx tsx scripts/seed-staging.ts --prod` | ✅ refuses, exit 1 |
| `npx expo config --type public` | ✅ config parses on SDK 57; identity/scheme/plugins correct |
| `npm audit --omit=dev --audit-level=high` | ⚠️ **Could not run locally** — npm audit endpoint error from this sandbox (2 attempts). The step exists in CI; evidence = first Actions run on the PR |

Tests written in this phase (build-prompts P0 list): settings reader defaults + ranges + `minAge` pinning ✅ · Sentry scrubber (both digit systems, deep payloads) ✅ · auth wrappers (unauthenticated → `ERR_UNAUTHENTICATED`, wrong role → `ERR_FORBIDDEN`, frozen/underage, demo isolation) ✅ · seed-settings idempotency + `appConfig` contains no phone-shaped strings (convex-test) ✅ · eligibility/compatibility/waves/limits/ranking/redaction units ✅ · places counts + thana/neighbour/hospital cross-checks ✅ · phone helpers ✅.

## Definition of Done (roadmap §2.3 + P0) — honest status

- ✅ CI green locally: tsc, ESLint (**including `i18next/no-literal-string`**), Vitest, convex-test (`npm run check` exit 0). GitHub Actions workflow is in the repo (install → copy parity → check → audit); it runs on the `p0-foundations` PR.
- ✅ Every new string exists in `en.json` **and** `bn.json` (parity test in `copy:extract`).
- ✅ Every public Convex function in P0 uses the auth wrappers or is explicitly public (`public.appConfig`, `places.children` — names/codes only, no personal data); access tests exist for the wrappers.
- ✅ Queries use indexes (schema defines them; `_lib` queries are index-backed).
- ✅ `isDemo` on every practice-capable row; demo isolation asserted in wrappers and `visibility.ts`, unit-tested.
- ✅ No phone number in logs/events/Sentry (scrubber + events key guard, tested).
- ✅ No placeholder/mock/dead controls: unfinished features have no entry points; sign-in shows a real "not configured" state instead of a fake flow; seed scripts refuse rather than invent data.
- ✅ Rule numbers come from the `settings` table / `SETTING_DEFS`, never hard-coded in logic.
- ✅ `seed-places` loads all 64 districts with upazilas + Chattogram metropolitan thanas (EN + BN, centres, S-32 neighbours); a unit test checks the counts.
- ✅ `docs/data-licences.md` records every dataset, pinned commit, download date and licence layer.
- ❌ Google sign-in works on Android dev build + Chrome, staging **and** production — **needs the OAuth client (Human step B) and EAS build #1 (step G).**
- ❌ Language switch verified on the 2 GB phone — needs the dev build on a physical phone (DEP-14).
- ❌ Test push reaches a locked dev build — needs Firebase/FCM (step after G) + build #1.
- ❌ Lighthouse ≤ 3 s on staging/production URLs — needs the Vercel deploys (step D).
- ❌ Spikes S1–S4 — recorded as open in `docs/spikes.md`; need devices/accounts.

## What is stubbed, and why

| Stub | Why / when it completes |
|---|---|
| `convex/rules/intakeParser.ts` returns the typed empty result | Full rules parser is P4 (F-206, DEP-09 test set — the 40-case `intake.jsonl` from the data pack is the fixture). The contract (§6.10) is final so callers wire against it. |
| Gates G5/G6/G7 are skeleton hooks in `app/_layout.tsx` | Their redirect targets (`/onboarding`, `/account-status`) are P1 screens; enforcing them now would strand users on 404s. G1–G4 are live. |
| `convex/auth.ts` constructs the Better Auth component reference by name instead of importing `components.betterAuth` from `convex/_generated` | `_generated` is produced by the first `npm run convex` against the staging deployment (Human step A2). The cast is isolated and commented; replace after codegen. The repo type-checks without any deployment. |
| `useHelpline()` returns null | The `GET /public/helpline` endpoint is P1 (D-R3). Returning null means no button renders — correct §1.9 behaviour until then. |
| `api/r/[slug].ts` 404s every slug | Its data source `public:sharedRequestBySlug` lands with SCR-P02 (P6/if-time). The function, OG template and 404 behaviour are final per §6.5. |
| `scripts/seed-staging.ts` prints the plan after the prod-refusal checks | Fake-data generation lands with the staging deployment (P1). The safety property (refusing prod) is implemented and verified now. |
| Legal/learn content files are empty (`.gitkeep` + README) | DEP-02 copy is a team/legal deliverable (draft due Day 4). The agent must not invent consent copy (CLAUDE.md §3). `content:build` + CMP-Markdown are ready for it. |
| `public.appConfig` client fallback (`FALLBACK_APP_CONFIG`) mirrors seed defaults | Live query wiring lands in P1 with the linked deployment; gates behave sanely offline meanwhile. |
| 2 thana coordinates are district-point fallbacks (Akbarshah, Chawkbazar) | No licence-clean point exists in the approved sources; flagged in the data + this report for member 2 to replace with verified points (Day-2 check). Not invented data — the district's own real point, labelled as a fallback. |

## Known deviations from specs

1. ~~Expo SDK 58 instead of 57~~ — **resolved in the QA fix pass**: the repo now runs SDK 57 exactly as ADR-001 specifies (see D1 above).
2. **Settings stored as 61 keys vs "51 rows"** — §5.2 groups some rows (`confirmPromptHours / confirmReminderHours`, the four S-22 limits, `minimumAppVersion / latestAppVersion / apkUrl / apkSha256`, `ai.*`, etc.). Each stored key matches §5.2 exactly; grouping is presentational.
3. **`convex/_lib` uses generic function builders** (`queryGeneric`/`mutationGeneric` from `convex/server`) via the wrappers, and `convex/schemaTypes.ts` derives `DataModel` from the schema — so the backend type-checks before codegen exists. After the first `convex dev`, functions may migrate to `_generated/server` imports without behaviour change.
4. **Notification channel**: app config uses the `expo-notifications` plugin `defaultChannel: "blood-requests"` per §1.2.1; §6.8's two-channel split (`urgent-requests`/`updates`) is created at runtime in P1/P4 when notifications are sent.
5. **CSP `'unsafe-inline'`** for script/style in `vercel.json` — not in the §7.4 template; Expo web exports currently need it. Conscious deviation, to be revisited in the P6 security pass (QA D8).
6. **Hospitals importer**: mobile-format `bloodBankPhone` values are warnings, not rejections — several institutions publish a mobile-format number as their official line, documented per-row in `data/SOURCES.md` with verification calls pending (DEP-01). The §5.1 rule's intent (never a *personal* mobile) is preserved by the provenance requirement.

## Human steps waiting — click-by-click (for Shakib)

> Plain-language version. Each service is free for us. **Golden rule: if any website asks for a credit/debit card, STOP — do not add it, and tell Muse.** We run on ৳0 forever.
> **Secrets rule:** some values below are *secrets* (like passwords). **Never paste a secret into chat.** Muse will show you a secure page/box whenever a secret needs to be handed over. Non-secret values (IDs, public keys, URLs) are safe to paste in chat.

**Already done:** ✅ the Convex staging project exists (you created it): team `shakib-hisan`, project `udvasito-staging`, deployment `robust-lark-146`. The steps below finish the rest.

### A. Convex (the database + backend brain)
*What it is, in one sentence:* Convex stores all our data (donors, requests) and runs the server code.
1. (Done) Project `udvasito-staging` exists.
2. Create the **production** twin: go to https://dashboard.convex.io → your team `shakib-hisan` → **Create Project** → name it exactly `udvasito-prod` → region **Europe** (if asked) → Create.
3. Link this code to staging (one-time, with Muse): Muse will run `npx convex login` in the project and a browser tab will open — click **Authorize** in your Chrome. Then Muse runs `npx convex dev` once, which creates the `convex/_generated/` folder and turns on the staging backend.
4. **Hand back:** nothing secret in chat. The deployment URL (`https://robust-lark-146.convex.cloud`) is already known. Deploy keys are secrets — Muse collects them through the secure box only if needed.

### B. Google Cloud OAuth (the "Sign in with Google" button)
*What it is:* Google checks the user's identity so nobody needs a password in our app.
1. Go to https://console.cloud.google.com → sign in with the team Google account → top bar → **New Project** → name `udvasito` → Create. (No billing setup. If it asks for a card → stop, tell Muse.)
2. Left menu → **APIs & Services → OAuth consent screen** → **Get started** → App name `UDVASITO`, support email = team email → Audience **External** → create. Then **Data access / scopes**: add `openid`, `email`, `profile`. Publishing status: **In production** (click *Publish app* if shown). Do NOT upload a logo (that triggers a slow verification we don't need).
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID** → type **Web application** → name `udvasito-web`. Under **Authorized redirect URIs**, add the two lines Muse gives you (one for staging, one for production — they look like `https://<deployment>.convex.site/api/auth/callback/google`).
4. Click **Create**. Google shows a **Client ID** and a **Client secret**.
5. **Hand back:** the **Client ID** is safe to paste in chat. The **Client secret is a SECRET** — do not paste it in chat; Muse will collect it through the secure box and put it into Convex's settings directly.

### C. Telegram bots (free phone verification — no SMS cost)
*What it is:* Telegram sends the verification code to donors, so we never pay for SMS.
1. Open Telegram → search **@BotFather** (blue tick) → tap **Start**.
2. Send `/newbot` → name: `UDVASITO Staging` → username: `udvasito_staging_bot` (must end in `bot`; if taken, add numbers).
3. BotFather replies with a **token** (looks like `123456:ABC-...`). **That token is a SECRET** — never paste it in chat; Muse collects it via the secure box.
4. Repeat for production: name `UDVASITO`, username `udvasito_bot`.
5. **Hand back:** only the two bot **usernames** in chat (those are public). Tokens via the secure box only.

### D. Vercel (hosts the website / web app)
*What it is:* Vercel puts our web app on the internet at `udvasito.vercel.app`, free.
1. Go to https://vercel.com → **Sign up** → **Continue with GitHub** (use the GitHub account that owns `udvasito-muse`).
2. **Add New → Project** → find `udvasito-muse` → **Import**. Framework preset: **Other** (our `vercel.json` already has the build command). Click **Deploy**.
3. Later, Muse will connect the `staging` branch for previews — nothing for you to click now.
4. **Hand back:** nothing. If Vercel ever asks for a card → stop, tell Muse (Hobby plan is free).

### E. Cloudinary (stores slip photos / images)
*What it is:* a free image locker so our database doesn't fill up with photos.
1. Go to https://cloudinary.com → **Sign up for free** (team Google account) → choose the free plan.
2. On the dashboard landing page you'll see **Cloud name**, **API Key**, **API Secret**.
3. **Hand back:** the **Cloud name** is safe in chat. **API Key + API Secret are SECRETS** — secure box only, never chat.

### F. Sentry (crash reports, so we learn when the app breaks)
*What it is:* Sentry tells us when the app crashes on someone's phone, without seeing their data (our code scrubs phone numbers out before sending).
1. Go to https://sentry.io → **Sign up** (team Google account) → create an organization `udvasito`.
2. **Create Project** → platform **React Native** → name `udvasito-app`.
3. Sentry shows a **DSN** (looks like `https://abc123@o0.ingest.sentry.io/456`).
4. **Hand back:** the DSN is safe to paste in chat (it's a public-style key, not a password).

### G. EAS / Expo (builds the Android app file)
*What it is:* EAS is the factory that turns our code into the Android app (APK) people install.
1. Go to https://expo.dev → **Sign up** (team Google account) → username can be the team name.
2. Muse will run `npx eas login` and `eas init` from the repo — a browser tab opens, click **Authorize**.
3. First build (Muse runs it): `eas build --profile development --platform android`. Install the resulting app on the 3 team test phones (DEP-14).
4. **Hand back:** nothing secret in chat. If Expo asks for payment → stop, tell Muse (free tier is enough; the build date resets monthly — Muse records the reset date in the roadmap).

### Also waiting on people (not accounts)
- **Member 2 (Day 2):** verify the 16 Bangla thana names in `data/thana-overrides.json`; replace the 2 fallback coordinates (Akbarshah, Chawkbazar) with verified points; make the ⚠️ verification calls in `data/SOURCES.md` (hospital phone numbers, Evercare's thana).
- **Member 3:** Bangla review of `src/i18n/bn.json` before launch (§1.6 — specs Bangla is a draft).
- **Team (DEP-02, Day 4 draft):** privacy + terms markdown in `src/content/legal/` — consent copy is a team/legal decision; the consent gate already works against `settings.consentVersion`.
- **Super-admin setup (after step B):** sign in once per environment with the team Google account, finish onboarding, then Muse runs `npx convex run admin/bootstrap:bootstrapSuperAdmin '{"authUserId":"…"}'`.
- **Settings only an admin should own:** `fallbackContactPhone` (DEP-05 — a real 24/7 team number), `contactEmail`, and after spike S4, the working Gemini model ID in `ai.models`. Set them through the admin path — never by editing seed files with personal data.

## Open questions

- `docs/questions.md`: SDK 57 vs 58 — **resolved** (SDK 57, see D1). Places dataset — **resolved** (see D4); remainder is member 2's verification list above.
- Whether the reviewer wants the `eslint-plugin-i18next` rule extended to `convex/` strings (currently app/src only — backend errors are code-keyed `ERR_` strings by design, §6.7).

## Next session starts with

**P1 — Walking skeleton** (roadmap §3/P1, build-prompts §2): consent screen + legal pages wiring (`consents.accept`), sign-in → onboarding with the 18+ gate, Telegram + in-person phone verification, donor setup, request form + wave 1, push, accept → mutual reveal, close. Pre-flight: Human steps A2 (CLI link) + B (OAuth) done or in progress; the full §3 copy merge (D5) lands before P1 screens multiply.
