# P3 Report — Volunteers, a Human Within 30 Seconds, Data Rights

**Branch:** `p3-volunteers-data-rights` (from `p2-matching-lifecycle` @ `929bf44`, local only — not pushed, not deployed)
**Gate:** `npm run check` (tsc + eslint + vitest) green at every slice and at the end: **159/159 tests** (123 at P2 end + 36 new: `tests/p3.test.ts` 29, `tests/p3-rules.test.ts` 7), 14 test files, 0 eslint errors (11 pre-existing warnings unchanged).
**Scope:** roadmap P3 — F-701, F-702, F-703, F-704, F-705, F-903, F-805, F-603, F-803 (data layer), SCR-V06 volunteer gate proof, plus the two P2-review carry-overs (S3-F1, S4-F5). Out of scope per brief: moderation queue screen (P5), admin dashboard (P5), AI (P4).

## Per-commit table

| Commit | Slice |
|---|---|
| `d6182fc` | Carry-over fixes: S-23 reveal cap on standby promotions (S3-F1), confirmation prompt only when a reveal happened (S4-F7), event rename `donor_not_responding_marked` (S4-F5), `contactReveals.requestId` → optional |
| `def48a0` | Volunteers core: apply/getMine/setOnDuty/setAreas/board/getRequest/openCase/claim/unclaim/searchDonors/askDonor/revealOptInDonor; `donors.updateSettings`; VAL-16/VAL-18; NTF-02/03/14/15; `volunteerSearch` rate limit |
| `ba6f511` | Test typing fix (board assertion) |
| `8ca1ec5` | Hotline fan-out: NTF-03 at publish in `startRequest`; escalation reaches on-duty district volunteers (F-704) |
| `d52906d` | Test setup fix (rotation test) |
| `61ce257` | Admin people (F-903) + admin reveal (F-805) + SCR-V06 volunteer-gate proof |
| `79f152b` | Data rights (F-603) + `retention.daily` + farming flags (F-803) |
| `dc9ebdd` | Client screens SCR-V01/V02/V03/A04/A05/M07 + routes/entries; drive-by `more.tsx` role fix |
| (this commit) | This report |

## What was built

- **F-701 Volunteer application** — `volunteers.apply` (verified phone required, VAL-16, `volunteer_number_display` consent at the caller's consent version, NTF-17 to admins, `volunteer_applied` event; re-application after rejection/revocation reopens the row). SCR-V01 with division→district→upazila drill-down.
- **F-903 Approve volunteers & roles** — `convex/admin/people.ts`: `applications` (pending first, phone-free), `reviewVolunteer` (approve → approved + role member→volunteer + NTF-15; reject/revoke need a VAL-18 reason; revoke returns the role to member and clears duty), `search` (name substring or exact ID — **never by phone**), `get` (age, **never full DOB**, no phone), `setRole` (granting admin/superadmin is superadmin-only; **last admin cannot be removed** — `ERR_LAST_ADMIN`, counted within the same practice partition), `setStatus` (NTF-14 + donor-live recompute), `revokeVerification`. Every change is audit-logged with its reason (`volunteer_reviewed`, `role_changed`, `status_changed`, `phone_verification_revoked`).
- **F-805 Admin reveal** — `admin.people.revealPhone`: typed reason (VAL-18) → `recordContactReveal` with audit action `admin_phone_revealed`; the S-24 volume flag runs inside `_lib/visibility` as everywhere else. Person-level reveals carry no request (see schema note below).
- **F-702 On-duty hotline** — duty toggle + areas on SCR-V02; at publish, `startRequest` sends NTF-03 to on-duty volunteers covering the request's district; `internal.matching.volunteerHotline` (S-13, built in P1) rotates least-recently-shown via the shared `onDutyVolunteersCovering` helper; none on duty → the P1 helpline fallback (unchanged).
- **F-703 Request board + claim** — `volunteers.board` (covered districts only, worst-first: urgency, then longest wait without a confirmed donor; number-free), exclusive `claim`/`unclaim` with `activeClaims` counter and `volunteer_claimed` events.
- **F-704 Escalation** — `matching.escalate` now notifies on-duty district volunteers (NTF-07) alongside admins; the `escalatedAt` guard still makes it fire exactly once, and claimed requests are not escalated (both proven).
- **F-705 Donor search & "Ask this donor"** — SCR-V03 case view (`getRequest`: requester phone present **only** when an unexpired `volunteer_case` reveal exists for the caller); `openCase` (one logged reveal per volunteer+request, repeat calls don't re-log); `searchDonors` (no numbers by construction, audit-logged, rate-limited 30/h per PRD §5.8); `askDonor` (wave-0 response + NTF-02, max 10 asks/request, eligibility + group + block checks); `revealOptInDonor` (opt-in donors only, VAL-18 reason, `volunteer_optin_revealed` audit).
- **F-603 Privacy & data control** — SCR-M07: `profiles.whoHasMyNumber` (first names + derived roles, no numbers), `requestDeletion` (VAL-25 `DELETE`/`মুছুন`, returns `deleteBy` = now + S-27), `exportMyData` (own data only — including reveal *metadata* with first names, never anyone else's number; 24 h file; 2/day), `cancelDeletion` (P1) wired into the screen.
- **Retention** — `convex/retention.ts` `internal.retention.daily`, registered as a daily cron at 03:00 Asia/Dhaka (21:00 UTC): due deletions anonymised **exactly per PRD §5.9** (see DoD), S-35 personal-field purge 30 days after close, S-26 slip deletion ≤ 7 days after close, S-36 AI-log retention, events > 90 days rolled into `dailyRollups` then deleted, expired exports removed, reveal/consent/audit records dropped after 12 months.
- **F-803 Automatic flags (data layer)** — money words (P1, unchanged), S-24 reveal volume (P1/P2, unchanged), and new request-farming: pure `farmingSignals` in `rules/limits.ts` (≥3 distinct blood groups, ≥3 distinct hospitals, or ≥3 expired-never-fulfilled requests in 30 days) hooked into `requests.create`, deduped to one open `request_farming` item per requester. Queue screen remains P5.
- **SCR-V06** — the P1 role gate (`admin`/`superadmin`/`volunteer`) already includes approved volunteers; P3 keeps role and roster in sync through the review flow, proven by test (approved volunteer verifies in person; after revocation the gate closes with `ERR_FORBIDDEN`).

## Phase DoD — evidence (all in `tests/p3.test.ts` unless noted)

- **Volunteer gets the requester's number ONLY via openCase or hotline** — board and `getRequest` payloads are scanned with the phone regex before `openCase` (no match) and contain the number only after; repeat `openCase` returns the number with the reveal-row count unchanged (logged once); closed/frozen requests refuse (`ERR_REQUEST_CLOSED`/`ERR_REVEALS_FROZEN`).
- **Volunteer NEVER gets a donor's number except opt-in + reason** — `searchDonors` payload scanned (no phone); `revealOptInDonor` on a non-opt-in donor → `ERR_FORBIDDEN`; short reason → `ERR_VALIDATION`; opt-in + reason returns the number with audit `volunteer_optin_revealed` and a `volunteer_optin_call` reveal row.
- **Hotline rotation picks least-recently-shown** — two on-duty volunteers with staggered `lastShownAt`, `maxVolunteersShown` patched to 1: the older-shown volunteer receives the number; `lastShownAt` advances.
- **Escalation fires exactly once** — two `escalate` calls → one `request_escalated` event, one NTF-07 per admin and per on-duty district volunteer; off-area volunteers get none; claimed requests are not escalated.
- **Deletion anonymises exactly as PRD §5.9** — asserted field-by-field: scrubbed (name → "Deleted user", firstName → "Deleted", DOB/phone → "", verification cleared, statusReason `account_deleted`, donor + volunteer profiles deleted, notifications deleted, own requests' patientName/ward/note cleared + contactPhone "" + `personalDataPurgedAt` set) vs kept (`authUserId`, role, consents, 12-month contact-reveal records, audit trail incl. `deletion_completed`); not-yet-due deletions untouched; second run is a no-op (idempotent).
- **Export contains only the caller's own data** — the stored JSON is read back: own phone/donor profile/responses present; another user's phone and the request's contact phone absent everywhere in the file text; third export in a day → `ERR_RATE_LIMITED`.
- **Role changes audit-logged; last admin cannot be removed** — plain admin granting admin → `ERR_FORBIDDEN`; superadmin grant works with a `role_changed` audit row; after demoting all other admins, demoting the last one → `ERR_LAST_ADMIN`.
- **S3-F1 regression (slice 0)** — a promotion at the S-23 cap performs no reveal, emits `reveal_cap_reached` with `via: "promotion"`, and arms no confirmation prompt; below the cap the promotion reveals and prompts as before.
- **S-35/S-26** — a request closed 31 days ago is purged; its slip file is deleted from storage and `slipFileId` cleared.
- **Events rollup** — after advancing 100 days, `request_published` events are gone and a `dailyRollups` row (metric `events`, dims `{name}`) holds the count.
- **Farming** — 3 requests with 3 different blood groups → exactly one open `request_farming` flag (a 4th doesn't stack); the same group at the same hospital 3× → no flag. Pure-heuristic cases in `tests/p3-rules.test.ts`.

## Bugs the new tests caught (fixed in-slice)

- **Promotion reveal path bypassed S-23** (the assigned S3-F1) — fixed by extracting `requesterRevealsToday`/`requesterUnderRevealCap` into `_lib/visibility.ts` and enforcing in both `responses.accept` and `matching.confirmStandbyResponse`.
- **`donors.updateSettings` did not exist** — specs §6.3 assigns it (incl. the `volunteersMayCall` opt-in); the donor upsert hard-coded the opt-in to false, so F-705's opt-in could never be set. Implemented in slice 1.
- **NTF-02/03/14/15 templates were missing** from `_lib/notify.ts` — added verbatim from specs §6.8 (NTF-15's rejection wording is selected with a `variant: "rejected"` switch, since §6.8 keys one template ID for both outcomes).
- **`dailyRollups` field/index mismatch** — retention initially wrote `count` via a `by_day_metric` index; the schema's field is `value` and the index is `by_metric_day`. Caught by typecheck/tests, fixed.
- **Requests have no `by_status` index** — retention's closed-request sweep now uses `by_closedAt` (closedAt is only set on closed requests). (Note: `convex/schemaTypes.ts` hand-derived typings allowed the wrong name at compile time; the runtime schema is authoritative — worth a P4 look at regenerating schemaTypes.)
- **Drive-by:** `app/(app)/more.tsx` checked role `"super_admin"` (does not exist; the enum is `"superadmin"`) when showing the verify-in-person entry — fixed.

## Interpretation notes

1. **Schema change (widening only):** `contactReveals.requestId` changed from required to `v.optional(...)`. Specs §6.4 gives `admin.people.revealPhone` the signature `{profileId, reason}` — a person-level reveal has no request — while §3.9's table sketch lists `requestId` without a `?`. The widening is backwards-compatible (all existing rows keep their requestId) and is the smallest change that makes F-805 representable. Flagged for the P3 reviewer.
2. **`exportMyData` is a mutation, not the specs §6.1 "action"** — mutations have `ctx.storage`, and keeping identity + the 2/day rate check + the storage write in one transaction is strictly safer. The client-visible contract (`{url, expiresAt}`) is unchanged.
3. **`reviewVolunteer` accepts a third decision, `revoke`** — §6.4 names only approve/reject, but an approved volunteer must be removable (SCR-V06 gate, duty roster); revoke sets the roster row `revoked`, clears duty, and returns the role to member. Reject/revoke both require a VAL-18 reason.
4. **Claiming requires an approved roster row** — admins acting without a volunteer profile can view the board (all districts) and open cases, but cannot claim (claims are recorded against a `volunteerProfiles` row). Matches the schema's `claimedByVolunteerId` typing.
5. **Farming thresholds are named heuristic constants** in `rules/limits.ts` (like the VAL bounds), not settings — PRD §5.8 names the *patterns* but gives no numbers for them; the numeric abuse limits that do exist (S-22 etc.) remain settings-driven. If the team wants them tunable, they should become S-settings in a later phase.
6. **NTF-15 on revoke** reuses the rejection variant wording ("wasn't approved") — §6.8 has no revocation-specific template. Flagged below.
7. **Retention sweeps use pilot-scale collects** in places (blocks, aiCalls, events, log tables) — same documented trade-off as the P2 lifecycle sweep (F8 in P2-REPORT); index-narrowing is a scale task, not a pilot one.
8. **Admin `setStatus` from SCR-A05 suspends for a fixed 7 days** — the screen offers suspend without a date picker (see gaps); the server API takes any future `until`.

## Gaps & flags (honest list)

1. **SCR-A05 copy gaps (i18n):** no keyed copy exists for the role/status action buttons (the screen renders the enum values — staff-facing data, lint-clean because they are expressions, but untranslated), for a "revoke verification" button (server function built + tested; **button omitted from the screen** rather than inventing copy), or for an SCR-A05 screen title. Needs member-3 keys in EN+BN.
2. **SCR-V01 approved-state copy:** `volunteer.apply.*` has pending/rejected strings but no "approved" string; the screen links onward to the volunteer tab instead. Same for a "My data" screen title (SCR-M07 reuses `myData.who` as its heading) and board/open-case button labels (row tap-through is used; `volunteer.reveal` labels the openCase action).
3. **NTF-15 revocation wording** — see interpretation note 6; a dedicated template (or a `variant: "revoked"`) needs specs/copy input.
4. **`volunteer_number_display` consent on re-application** inserts a fresh consent row each time (append-only consent log — consistent with `consents.accept`, but worth a reviewer glance).
5. **Practice/real admin counts:** `ERR_LAST_ADMIN` counts admins within the caller's own practice partition. A deployment with a single real superadmin who is also the only practice admin is protected per-partition; cross-partition bootstrap remains the P1 `bootstrapSuperAdmin` human step.
6. **Retention:** push-subscription rows are deleted on anonymisation, but PRD §5.9's "push tokens until 60 days inactivity" pruning for *active* accounts is not implemented (no inactivity sweep) — small follow-up.
7. **Export `numbersIReceived`/`whoHasMyNumber` include viewers' first names** — deliberate (it is the caller's own reveal record, mirroring SCR-M07), but no other personal data about other people is included; flagged for reviewer confirmation against D07's wording.
8. **Client screens are lean** (as in P1/P2): no area editing UI for duty areas beyond the apply form (`volunteers.setAreas` is API-only for now), no board filters UI (the API accepts group/component/claim filters), admin screens reachable from More/Settings entries only for the right roles.

## Unverifiable until human steps (unchanged from P1/P2)

Nothing in P3 was deployed or pushed. Still outstanding from earlier phases: `GOOGLE_CLIENT_SECRET` into Convex, publishing the OAuth consent screen, Telegram bot + webhook, Vercel/Cloudinary/Sentry/EAS setups, the GitHub branch uploads/PR/merge cycle for P0–P3, and the P1 go-live list. The retention cron registers with the next Convex deploy (code-only here). S-37 `noShowPenalty.count` semantics (P2-REVIEW S3-F3) still needs a product decision from Shakib/team — untouched by P3.
