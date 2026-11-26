# UDVASITO — Risk Watchlist (stack- and team-specific)

**Workstream C (independent QA).** Each risk comes from `grilling-notes.md` (G-xx), `ADRs.md`, or `roadmap.md`, and carries an **early-warning check the team can actually run** — a command, a dashboard number, or a 10-minute manual test — plus the trigger point at which to act and the fallback the specs already prescribe. Review weekly (5 minutes, developer + member 4) from P1 onwards.

---

## R1 — Push notifications silently fail on Xiaomi/Redmi and other aggressive battery managers
- **Source:** grilling G-02; roadmap spike S2; PRD F-304; ADRs §3 (Expo Push).
- **Why this stack:** the entire core loop depends on a locked-screen push reaching a cheap Android phone. MIUI/ColorOS battery optimisation kills Expo Push delivery with no error anywhere — the donor simply never knows.
- **Early-warning check:** (a) Spike S2 result must exist in `docs/spikes.md` before P1 go-live (roadmap P0 DoD). (b) From P1, watch the ratio `notification_opened ÷ notification_sent` events per day (PRD §2.2 events, admin dashboard): a falling open rate on Android is the first symptom. (c) Weekly: send a test push to the team's Xiaomi/Redmi test phone with default battery settings, screen locked.
- **Trigger / action:** open rate drops materially week-on-week, or the weekly locked-phone test fails → raise the alert-reliability guide (SCR-D07, brand-specific steps DEP-08) to a first-run blocker for donors, and lean on the mitigations already specified: "Requests for me" inbox on every app open (F-305), waves sized on **opens** not sends (F-302), optional email copy (F-307), and the 30-second volunteer path (F-702) which does not depend on donor push at all.

## R2 — Gemini free-tier quota runs out mid-day (Flash-Lite ≈ 500/day, 15 RPM; Flash ≈ 20/day)
- **Source:** vision §6; PRD §6.3; ADRs §3; grilling G-03, G-13.
- **Why this stack:** limits are per project, reset at midnight Pacific, and can change without notice. Intake, duplicate hints, assistant, appeal text and the weekly summary all share the one quota.
- **Early-warning check:** admin AI page (F-902) shows calls today ÷ limit per model; usage monitor warnings at **70 % / 90 %** (S-30). Before P4 ships, spike S4 must have recorded the **working Flash-Lite model ID** in `settings.ai.models` (roadmap P0). Weekly: re-check the AI Studio quota page against `settings.ai.limits` — the numbers in the specs are from Nov 2026 and drift.
- **Trigger / action:** at **80 %** of the daily limit the assistant and appeal text must already be on their non-AI fallbacks (PRD §6.3 priority order: intake > duplicate > assistant > appeal > summary). If intake itself starts failing, verify the manual form path still posts with the text kept (`request.aiUnavailable`) — that is a P4 DoD item, test it, don't assume it.

## R3 — Telegram phone verification edge cases (no Telegram, mismatched number, expired link, bot webhook down)
- **Source:** grilling G-01; PRD F-103; ADR-004; roadmap P1 DoD.
- **Why this stack:** ৳0 rules out SMS codes, so verification rides on a Telegram bot "share my number" flow plus the in-person fallback (D-R1). Failure modes: user has no Telegram; the Telegram account's number ≠ the number they typed; the 10-minute token expires; the production bot's webhook is not set after a deploy; staging/production bots get crossed (ADRs §5 #11 — two bots, one webhook each).
- **Early-warning check:** the three Telegram paths (success / mismatch / expired) are a named P1 DoD test — re-run them after **every** production deploy and after any webhook change. Track `phoneVerifications` rows stuck in `pending` past expiry in the Convex dashboard: a rising count means the flow, not the users, is broken. Confirm which bot username `settings.verification.telegramBot` points at in each environment.
- **Trigger / action:** any path failing → donors fall back to in-person verification at drives (SCR-V06) and requesters keep posting unverified (1 open request, "phone not yet verified" shown to donors) — posting must never block on verification (GAP-01). Never "fix" this by adding a paid SMS provider (vision D8, hard rule).

## R4 — EAS free build budget exhausted (15 Android builds/month)
- **Source:** roadmap §2.4; ADRs §3.
- **Why this team:** one native-config mistake in P0 can burn builds 1–2; the budget table plans only ~6 named builds (dev client Day 1, pilot APK Day 5 = build #3, release Day 15 = build #5, optional P4/P7 builds) plus reserves. Every `app.config.ts` plugin, permission, icon, or package change costs a build; JS changes must go through EAS Update (fingerprint runtime policy, specs §1.2.1).
- **Early-warning check:** on Day 0 the team was to record the account's monthly quota reset date in roadmap §2.4 — if that blank is still empty, fill it now. Before **every** `eas build`, check the Expo dashboard count and log the build number/purpose against the §2.4 table.
- **Trigger / action:** at 10 builds used with the release build still ahead → stop all non-essential native changes; use the documented fallback: the manual GitHub Actions "Android local build" workflow (`eas build --local` on GitHub's runner, free for public repos).

## R5 — Expo SDK version drift from the accepted ADR (SDK 57 specified; ecosystem moves fast)
- **Source:** ADR-001; CLAUDE rule 1 ("never replace an accepted library without a new ADR approved by the team"); roadmap P7 "Later" list (SDK 58 upgrade is explicitly **post-competition**); specs §7.3 (support matrix written against SDK 57).
- **Early-warning check:** `grep '"expo"' package.json` at every phase gate — the version must match ADR-001. Also pin-check the Better Auth + Convex component versions against the official Expo guide versions the roadmap P0 section requires ("versions pinned exactly").
- **Trigger / action:** any SDK major/minor drift → stop and write the ADR (what changed, what it breaks: Android min version, native modules, EAS profiles) for team approval before building on it. **This risk has already materialised in P0 — see p0-review.md D1.**

## R6 — Convex free-tier function/IO limits hit by unindexed queries or chatty dashboards
- **Source:** ADRs §3 (1M function calls/month, ~1 GB DB IO/month); CLAUDE rule 12; roadmap §2.3; grilling G-03.
- **Why this stack:** the admin dashboard and public stats re-run on every data change; one full-table `.filter()` scan in matching would burn IO on every request and slow the emergency path.
- **Early-warning check:** (a) the A4 grep gate (`\.filter(` in `convex/`) at every phase. (b) Weekly from P1: Convex dashboard usage page — function calls and DB IO vs the ADRs §3 expected pilot use (~300–500k calls/month). (c) `requests.create` p95 ≤ 1.5 s and publish→first-push p95 ≤ 60 s from Convex logs / events (specs §7.1).
- **Trigger / action:** usage trending past 70 % of a monthly limit before month-end (S-30 warning discipline) → apply the ADRs §3 degradation order: public page to cached stats (`statsSnapshots`), admin charts refresh less often, nightly roll-up of raw events. Never degrade the post → match → notify path (specs §7.6).

## R7 — Single developer is a single point of failure; specs are the only backup
- **Source:** grilling G-08; vision §8; CLAUDE.md §3 (session report format).
- **Early-warning check:** after every build session, the CLAUDE §3 report (Done / DoD checklist / human steps waiting / open questions / next session starts with…) must exist and `docs/questions.md` must be current; roadmap phase status (§3 ⬜→🟦→✅) updated. If a session ends without the report, the next session starts by reconstructing state from git log — that is the warning sign.
- **Trigger / action:** two consecutive sessions without reports, or `questions.md` stale → pause feature work for one session and restore the paper trail; the other four members' workstreams (roadmap §4.2) must never be blocked on information only in the developer's head.

## R8 — Request-farming turns the matching engine into the phone directory v1 refused to build
- **Source:** grilling G-09; PRD §5.8, F-801/F-803.
- **Early-warning check:** from P2, the automatic flags exist as data (moderationItems kinds `request_farming`, `reveal_volume`); weekly, member 4 reviews: reveals per requester per day (limit S-23 = 10, flag at S-24 = 20), requests per account per month (5; volunteers 20), accounts posting for many groups/hospitals, requests never closed.
- **Trigger / action:** any account crossing a §5.8 limit without a flag firing means the flag code, not the user, is the bug — treat as sev2. Remember the asymmetry in PRD F-801: an "asked for money" report freezes the account **at once**; a confirmed donor's "fake" report freezes reveals on that request.

## R9 — AI redaction promise breaks in Bangla/Banglish edge cases
- **Source:** grilling G-12; PRD §6.2; vision G5 (0 phone numbers / labelled names / diagnoses to the AI provider).
- **Early-warning check:** the §7.7 fixture suite is the check — ≥ 40 messages at P4 (≥ 15 EN / ≥ 15 BN / ≥ 10 Banglish) growing to the roadmap P4 500-message generated set, asserting zero planted PII survives, **reading the exact payload** sent to Gemini. Add every real-world failure the team spots (new diagnosis word, new name label like জনাব/বেগম, numbers with spaces/dashes/Bangla digits) to the fixture set the same day.
- **Trigger / action:** one surviving phone number in a fixture = stop-ship for the AI feature (the feature ships off via `settings.ai.features`), not a "fix later". The manual form path is the product; AI is the accelerator (vision principle 2).

## R10 — Practice-area data leaks into real numbers (or wakes real donors) before judging
- **Source:** grilling G-20; vision principle 10 / D12; specs §1.9; CLAUDE rule 6.
- **Early-warning check:** the P1-G7 isolation tests at every phase that touches matching, notifications, or stats — not just once. Before judging: run the PRD §2.3 Part 2 loop in production's practice area and confirm (a) no real donor received anything, (b) the admin dashboard's real funnel did not move, (c) every practice screen shows the PRACTICE badge.
- **Trigger / action:** any cross-over = sev1; judging switches to the recorded backup video until fixed and re-proven twice (roadmap P6 DoD requires the test to pass twice in a row on production).

## R11 — Free-tier terms change under the product (Gemini unpaid terms, Vercel Hobby non-commercial, EAS quotas)
- **Source:** vision §6 (Gemini terms: no sensitive data, no clinical use, no under-18-directed app); ADRs §3 (Vercel Hobby = non-commercial); grilling G-13.
- **Early-warning check:** monthly (and once in P6 hardening): re-read the Gemini API terms and each provider's free-tier page; confirm the 18+ gate, redaction, and "not a medical service" disclaimers still match the terms; confirm no card has been added to any account (ADRs §0 golden rule — if a service demands a card, it is not ৳0 and the team decides explicitly).
- **Trigger / action:** a terms change that breaks a feature → the feature degrades to its specified manual path (slip checks are already manual; intake falls back to the form; assistant falls back to the searchable FAQ list) while the team decides — never silently move to a paid tier.

## R12 — Hospitals/places reference data never arrives or arrives dirty (DEP-01)
- **Source:** roadmap §5.1 (`data/hospitals.csv` contract), §5.2 places dataset; P1 depends on DEP-01 by Day 3.
- **Early-warning check:** `wc -l data/hospitals.csv` and the `import-hospitals` bad-row report; the P0-G3 count test for places (64 districts). The importer must print bad rows, be idempotent, and aliases/short names ("CMCH", "চমেক") must be present — the intake parser and hospital search depend on `aliases` + `searchText` (specs change log 1.1).
- **Trigger / action:** CSV still header-only at P1 Day 4 → the place picker ships with the "my place isn't in the list" path (thana + free text, F-202) as the primary flow for the pilot and the team escalates data collection — do not invent hospital rows (specs §1.9: production holds only real data).
