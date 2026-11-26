# P1 — Walking skeleton · Report

**Branch:** `p1-walking-skeleton` (from `main` @ `961cee3`) · **Date:** 2026-11-26
**Status:** Code complete against the roadmap P1 scope; `npm run check` green (see evidence). **Nothing was deployed** — no `convex dev`, no env changes, `main` untouched. Go-live (roadmap steps 1–7) is a human/parent step, not performed here.

The whole loop is thin but real: consent → sign-in wiring → onboarding (18+ gate) → phone verification (Telegram + in-person) → donor setup → form request → matching v1 (wave 1) → push path → accept (units+1 confirmed, rest standby) → consent/call-mode-gated reveal → live status → close → 30-second helpline/volunteer fallback.

## What was built, slice by slice

| Commit | Slice |
|---|---|
| `3eeb6d8` | `convex/rules/validation.ts` (VAL-01…26 form rules shared client/server), `haversineKm` in ranking; `_lib/ratelimit.ts` (signUp S-25, verification starts, in-person daily cap, helpline, push-test — numbers from `SETTING_DEFS`); `_lib/notify.ts` (push templates verbatim from specs §6.8, notification row + event per send); `_lib/donorLive.ts` (§5.4 live rule); additive schema index `phoneVerifications.by_externalUserId` |
| `fa43414` | `profiles.completeOnboarding` (18+ gate → `underage_blocked`, campaign code stored only if it matches an active campaign, consent + audit + event), extended `profiles.me`, `updateLanguage`, `updateProfile` (phone change un-verifies), `cancelDeletion`; `consents.accept`; `support.helpline` + rate-limited internal fetch; `public.appConfig` extended (apkSha256, verification methods, aiFeatures) + client type updated |
| `60852ff` | Validator-typed auth wrapper variants (`memberMutationV` etc.) in `_lib/auth.ts` — identical enforcement, handlers receive value types |
| `28b3114` | `convex/phoneVerification.ts`: Telegram `start`/`status`/`acceptMismatch`, in-person `startInPerson`/`lookupInPerson` (payload = first name + last 4 only)/`confirmInPerson` (self → `ERR_SELF_VERIFICATION`, daily verifier cap, audits), internal `handleTelegramUpdate` (fixture-testable); `convex/http.ts`: `POST /telegram/webhook` (secret header, replies only when `TELEGRAM_BOT_TOKEN` set, always 200), `GET /public/helpline` (IP-hash rate limit, `no-store`, 404 when unset), `GET /health` |
| `dcf19a1` | `convex/hospitals.ts`: `search` (search_all index, demo-scoped), `list`, `bloodBanksNear`, internal idempotent `importHospitals` (key nameEn+district, place names resolved, skips reported); `places.list` (§6.2); `_lib/db.ts` `eqRange` helper |
| `c47c1df` | `convex/donors.ts`: `upsert` (form validation, place-hierarchy check, rules-derived eligibility, health-data consent row, `donor_profile_live` event), `getMine` (recomputed not-live reasons) |
| `6aa0524` | `convex/requests.ts`: `create` (clientId idempotency, S-22 open + monthly limits via rules, urgency derived from needed-by, money-word → moderation flag, schedules matching), `getForOwner` (numbers only via live `contactReveals` entitlement), `listMine`, `close` (NTF-09 to notified donors); `convex/matching.ts`: `eligibleCandidates` (exact group, same district, blocks both ways, thana travel range, `canDonate` re-check, distance ranking), `startRequest` (wave 1, zero-eligible flag, hotline scheduled at +S-13 s), `runWave`, `volunteerHotline` (least-busy on-duty volunteer, logged reveal; none → fallback flag) |
| `7b40ebf` | `convex/responses.ts`: `inbox` (needsAnswer/saidYes/earlier), `getForDonor` (patient/requester details only when entitled), `markOpened`, `accept` (self-check required, idempotent by clientId, confirmed while < units + S-12, else standby; reveals only through `_lib/visibility`, donor_calls honoured; NTF-04), `decline` ("donated" updates last-donation + eligibility); `notifications.markOpened`; `convex/push.ts` (Expo token register/unregister, `sendTest` NTF-18) |
| `3811970` | Tests (below) |
| `f939571` | Client: `src/lib/refs.ts`, real `useHelpline()` (signed-in query + signed-out fetch-on-tap with 24 h cache), push registration lib, geo/directions helpers; legal **DRAFT** content `src/content/legal/{privacy,terms}.{en,bn}.md` (frontmatter version `2026-11-28-pilot`, draft banner in-body) + generated JSON via `content:build`; shared components (HelplineButton, SafetyCard, ChipRow, PlacePickers); root layout → `ConvexBetterAuthProvider`, gates G5/G6 live via `profiles.me`, push token registration + notification-open wiring; tabs per §1.4.1 (Volunteer tab role-gated, Donate badge = unanswered alerts); screens SCR-O02 (helpline + practice sheet), O03, O04, O06, P06, P07, P08 (minimal — see gaps), M01, M02 (form path, hospital search + location-nearest + not-in-list), M03, M04, M06, M10, D01, D02, D03, D04, V06, volunteer tab |

Also: one-line addendum appended to `docs/dev/P0-REPORT.md` recording the post-merge i18n count (489 keys/language).

## Test evidence

Command: `npm run check` (= `tsc --noEmit && eslint . && vitest run`) — **exit 0**.

- **85 tests passing, 10 files** (42 from P0 + 43 new in P1):
  - `tests/p1.test.ts` — **29 convex-tests**: onboarding + consent/audit/event writes; under-18 blocked at onboarding and refused by member functions; sign-up rate limit (6th/hour → `ERR_RATE_LIMITED`); donor live/not-live (phone reason); create-twice-same-clientId → one request; wave 1 notifies exact-group same-district only; pre-accept donor sees no requester number/patient name; mutual accept → both numbers + exactly 2 `contactReveals` + 2 audit rows + events, no phone in any event props; **5 donors accept a 1-unit request → exactly 2 confirmed + 3 standby** (4 reveal rows = 2 donors × 2 directions); donor_calls → requester payload contains no donor number anywhere, 1 reveal row; non-notified member → `ERR_NOT_FOUND` on both views; decline → re-answer `ERR_ALREADY_RESPONDED`; close → NTF-09 written, later accept `ERR_REQUEST_CLOSED`; unverified requester blocked at 2nd open request; zero-eligible → no-donors state with blood banks; practice donor never notified for a real request; fallback (no volunteer → `fallbackShown`, helpline via `support.helpline`; on-duty volunteer → shown with 1 logged `volunteer_hotline` reveal); Telegram fixtures (verified / someone-else's contact / mismatch + acceptMismatch / expired / disabled method); in-person (payload keys exactly `{verificationId, firstName, phoneLast4}`, full number absent from payload JSON, self → `ERR_SELF_VERIFICATION`, member → `ERR_FORBIDDEN`, no-match path); hospitals CSV import idempotent (2nd run: 0 inserted, all updated, 0 skipped) + alias search "CMCH"; appConfig carries verification config and no phone-shaped string.
  - `tests/p1-rules.test.ts` — **13 tests**: phone normalisation, request/donor form VAL rules, money-word flag, in-person code alphabet, haversine, extra eligibility rows (unspecified/other gender = 120 days, platelet opt-in gate, exact 18/66 boundaries).
  - `tests/helpline-bundle.test.ts` — **1 test**: no BD-mobile-shaped literal anywhere in `app/` or `src/` client code (i18n JSON excluded — its one example number is specs §4 format copy; see note below).
- Eligibility (18–65, 90/120/14-day, platelet rules), exact compatibility and limits unit tests pre-exist from P0 in `tests/rules.test.ts` and still pass.
- eslint: 0 errors (11 pre-existing-style warnings remain, incl. 2 in P0 files).

### Interpretation notes (for the reviewer)

- **P1-G5 "exactly 2 contactReveals":** a mutual confirm writes **2 rows per confirmed donor** (one per direction, per specs §6.3 + PRD §3.3). The 5-donor test therefore asserts 4 rows for 2 confirmed donors. If the gate meant 2 rows total, the data model would under-log one direction.
- **`requests.listMine` pagination** returns the newest N with `isDone: true` (full cursor pagination lands with SCR-M04's complete form in a later phase).
- **Helpline bundle test** scans source (`app/`, `src/`), not a built bundle — no production build exists yet (Vercel/EAS pending). The roadmap DoD's "greps the build output" variant should be added to CI when the first web build ships.
- **Posting rate limit (F-802):** enforced as the PRD §5.8 request limits (open S-22 + monthly caps via `canCreateRequest`) plus the component rate limiter on sign-up/verification/helpline; there is no separate per-hour posting bucket in the specs' numbers.

## Known gaps / decisions

- **Gender picker (SCR-D02):** option labels are unkeyed in specs (I18N-GAPS register, DEP-08) and inventing BN copy is forbidden. P1 stores gender as `unspecified` → the conservative 120-day interval (PRD §5.1) for everyone, and shows `donor.setup.genderWhy`. Male donors wait 120 instead of 90 days until the team's keys land — flagged, not silent.
- **SCR-P08 download page** is minimal (APK button only when `appConfig.apkUrl` is set + web-app button) because the page's copy is entirely unkeyed (DEP-08).
- **Travel range** offers thana/district in P1 (the two keyed options); the `division` enum value exists server-side.
- **Verify-in-person daily count** (`verifyInPerson.count`) is not shown — the lookup payload deliberately carries no count; the server enforces the cap.
- `src/content/README.md` (P0) says legal texts are "not pre-written by the coding agent"; the P1 task explicitly required draft files, so drafts were written and are banner-marked **DRAFT — pending legal review (DEP-02)** in both languages. The README line should be updated by the team when DEP-02 is accepted.
- WhatsApp verification: server flow complete; the method stays hidden until the team enables it in settings (360dialog/Twilio are paid — §6.1 keeps it off by default).
- One accidental `npx convex codegen` run early in the build "uploaded functions" — the tree was still pure P0 at that moment, so it re-pushed identical already-deployed code. No P1 code was deployed; disclosed for completeness.

## Unverifiable until human steps complete

1. **Google sign-in end-to-end** — `GOOGLE_CLIENT_SECRET` is not yet set in Convex env. The client keeps the honest not-configured posture; no session can exist until it is set, so gates G4–G6 and every signed-in screen are exercised only through convex-test identities, not a real Google login.
2. **Telegram on a real phone** — no bot token (`TELEGRAM_BOT_TOKEN`), no webhook secret, `verification.telegramBot` setting empty. The handler logic is fixture-tested (verified/mismatch/expired/own-number); the live bot round-trip is RB-5.
3. **Real-device push** — token registration + send path are wired and the component is test-registered; delivery to a locked phone (the ≤60 s DoD) needs hardware + EAS.
4. **Vercel deploy / production Convex** — not set up; staging deploy of this branch was explicitly out of scope for this task.
5. **Three-phone staging run** (Phase DoD manual test) — pending 1–4.

## Go-live checklist (roadmap P1, Sat 28 Nov 14:00) — status

| # | Step | Status |
|---|---|---|
| 1 | Merge to `main` → production web + Convex | ⛔ Not done — this branch awaits the independent PR review; production does not exist yet |
| 2 | `bootstrapSuperAdmin` on production; set `fallbackContactPhone`, `contactEmail`, `consentVersion` | ⛔ Production step; code ready (`consentVersion` already `2026-11-28-pilot` in settings defaults) |
| 3 | `seed-places`, `seed-settings`, `import-hospitals` on production | ⛔ Production step; all three functions exist and are test-proven (import idempotency tested against the real CSV + 582-row places seed) |
| 4 | Production Telegram webhook (RB-5) | ⛔ Needs the bot token from the human setup |
| 5 | Build #3 → GitHub Release `v0.1.0` → appConfig version fields | ⛔ EAS not set up; download screen reads the fields when set |
| 6 | Smoke test on production with two practice accounts | ⛔ Depends on 1–5; practice isolation is test-proven |
| 7 | Member 2 opens donor sign-up at the first CU drive | 👥 Team step |

**Recommendation:** review this PR, complete the secret/bot/Vercel human steps, deploy the branch to staging for the three-phone DoD run, then merge.
