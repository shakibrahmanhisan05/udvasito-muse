# P2 Report — Matching Engine & Request Lifecycle

**Branch:** `p2-matching-lifecycle` (from `p1-walking-skeleton` @ `7be8d4c`)
**Commits:** 6 · **Check:** `npm run check` green — tsc clean, eslint 0 errors,
**123/123 tests passing** (85 pre-existing P0/P1 + 38 new P2 tests).
Nothing pushed, nothing deployed (no `convex dev`/deploy, no env changes) —
local commits only, per the build brief.

## What was built

| Commit | Contents |
|---|---|
| `003da93` | **Rules slice.** `rules/ranking.ts` completed to the full PRD §5.3 tie-break order: tier → exact group before compatible → lastActiveAt desc → alerts last 7 days asc → no-show count (S-37) asc. New `rules/alertPolicy.ts`: `isQuietHours` (S-21, midnight-wrap, Dhaka wall clock), `alertAllowed` (S-20 cap + quiet hours), `startOfDhakaDay`, `noShowCountWithin`/`pruneNoShows` (S-37 90-day window). 13 unit tests. |
| `a5c28a9` | **Backend.** Matching v2 in `matching.ts`: full eligibility filters (availability incl. paused/`lastDonatedAt`-derived state, verified-requests-only D16, alert cap, quiet hours, thana travel range VAL-18/S-11, blocks both ways, `canDonate` re-check, platelets opt-in + exact group F-204); compatible groups only in the final wave (S-08 = total across waves); wave chaining inside `doWave`; `internal.matching.escalate` (F-704 hook — admins notified now, volunteers join in P3). New `lifecycle.ts`: still-coming check + timeout (F-405), self-rescheduling `autoClose` (S-17), `confirmationPrompt` + 24 h reminder (S-19, NTF-10), `hourlySweep` (pause auto-resume NTF-13, suspension end, verification expiry, availability-stale flags). `responses`: `withdraw`, `answerStillComing`, `recordOutcome` (F-502/F-503), `getConfirmations`; accept now allows final-wave compatible donors, schedules still-coming checks + the confirmation prompt, enforces the S-23 requester reveal cap. `requests`: `update` (need-more re-opens matching), `reopen` (S-34), `markDonorNotResponding` (F-406), auto-close armed at create. `donors.setAvailability` (VAL-20) + `confirmStillAvailable`. New `reports.ts`/`blocks.ts` (F-801): automatic freezes per PRD §5.8 (a single money report freezes the subject's account immediately; a confirmed donor's fake-request report freezes that request's reveals; all other reports wait for the moderation queue), NTF-17 to admins, report rate limit 10/day. Gate G6 via a new `ownerViewQueryV` wrapper (`requests.getForOwner` only). S-24 reveal-volume flag inside `_lib/visibility.ts` (staff reasons only). Notify templates NTF-07/08/10/13/17 added verbatim from specs §6.8. Hourly cron registered. |
| `2e98943` | **Tests part 1** (7): wave sizes/intervals per urgency, opened-unanswered shrink, final-wave compatible + flag, escalate, quiet hours + urgent override, alert cap, verified-only, platelets. Also pins the P1 suite's seeded quiet-hours window to empty (see Notes). |
| `b038b51` | **Tests part 2** (18): still-coming ×3, withdraw ×2, not-responding, need-more, reopen, auto-close, confirmation + cooldown ×2, availability pause/resume, reports/fake-freeze/G6, fake-report reveal freeze, report rate limit, blocks exclusion, S-23 cap, S-24 flag. Two real bugs found & fixed by these tests (below). |
| `ae29a6a` | **Client.** Donor tab availability segmented control + pause sheet (F-602); new SCR-M09 confirm screen (`confirm.*` keys); new SCR-C01 report screen (`report.*` keys); alert detail: still-coming card (`alert.stillComing`/`onMyWay`/`cantMakeIt`) + can't-make-it withdraw + report link; request screen: donor-not-responding (with the keyed confirm copy), need-more, reopen, confirm link. New refs in `src/lib/refs.ts`. |

## Phase DoD — evidence (all in `tests/p2.test.ts` + `tests/p2-rules.test.ts`)

- ✅ Wave 1→2→3 at the right minutes per urgency (5/15/30 min from S-09,
  asserted by advancing fake timers to interval−1 and +1).
- ✅ Next wave shrinks by opened-but-unanswered (3 opened of a 5-target wave →
  wave 2 notifies exactly the remaining 2).
- ✅ Final wave adds compatible groups, flagged `compatibleGroup` on the
  donor payload and counted in the `wave_sent` event.
- ✅ Still-coming timeout promotes the first standby; the original donor
  stays confirmed (F-405 wording honoured literally).
- ✅ Withdraw promotes the standby at once; with no standby it runs the next
  wave immediately.
- ✅ Auto-close fires at needed-by + S-17 (6 h) and not a minute before.
- ✅ Cooldown starts **only** from the donor's own confirmation: after the
  requester confirms, the donor stays eligible; after the donor confirms,
  `lastDonatedAt` is set and `eligibleFrom` = donation date + 90 d (S-06,
  gender `unspecified` → conservative 120 d path covered by P0 rules tests).
- ✅ Alert cap (S-20) and quiet hours (S-21, urgent override S-22) hold.
- ✅ A frozen account cannot post (ERR_FROZEN) but **can** view its own
  request (gate G6) — plus cannot accept or file reports while frozen.

## Bugs the new tests caught (fixed in-slice)

1. `requests.update` wrote an event prop named `note`, which the events
   guard rejects (PII-shaped keys) — renamed to `{units, neededBy, text}`.
2. `confirmationPrompt` deduped on "any NTF-10 exists for this request", but
   auto-close also sends NTF-10 — the prompt would have been silently
   suppressed for every auto-closed request. Dedupe now uses the
   `confirmation_prompted` event.

## Interpretation notes

- **S-12 semantics drive several tests:** the first `units + 1` acceptors
  are all state `confirmed`; standby starts after that. "Promote standby"
  therefore adds a donor *in addition* — matching specs F-405/F-406.
- **Verified-requests-only (D16)** reads `request.contactPhoneVerified`
  (the requester's phone verified for this request) — the only per-request
  verification signal in the schema.
- **Candidate pool** is the request's district (as in P1). The ranking
  "division" tier is therefore unreachable until cross-district search
  exists; neighbours (S-32) resolve within the district. Ranking still
  implements all tiers for when the pool widens.
- **Escalate (F-704)** notifies admins only in P2, per the roadmap
  (volunteer duty roster is P3). It is an internal mutation callable by
  admins and by the future volunteer flow.
- **Withdraw** has no push template in specs §6.8 — the family sees the
  change in-app (live query) and the promoted donor gets NTF-16. No copy
  invented.
- **Compatible-group label (OQ-03):** specs define no i18n key for the
  label, so the flag is exposed structurally (`compatibleGroup` on
  `responses.getForDonor`/`inbox` payloads + `wave_sent` event) and the
  copy key is flagged below rather than invented.
- **Quiet-hours waves are spent:** if every candidate is filtered by quiet
  hours/cap, the wave still counts (specs: the wave happened; donors were
  protected). The next wave runs at the next interval. Risk noted: a
  request created at 02:00 with all donors in quiet hours effectively
  starts matching at 07:00 — intended by S-21, but worth a product look.
- **Availability "stale" (NTF-14)** needs a "last confirmed" timestamp the
  schema doesn't carry; the sweep uses `availabilityConfirmedAt ??
  updatedAt` and flags at S-39 (60 d). The flag lands as a moderation item
  + NTF-07 reminder nudge is *not* sent (NTF-14 copy is volunteer-facing
  wording about donors; sending it to the donor was judged wrong — flagged).
- **P1 suite determinism:** `tests/p1.test.ts` seeds the real settings,
  whose quiet-hours window (00:00–07:00) depends on the wall clock. With
  P2 enforcing S-21, the P1 suite failed when run at ~04:00 Dhaka. The P1
  test setup now patches the seeded `quietHours` to an empty window with
  an explanatory comment — P1's assertions are unchanged; quiet hours are
  covered by P2's own tests at a fixed epoch.

## Gaps & flags (honest list)

1. **DEP-08 (new):** no i18n key exists for the compatible-group label
   (OQ-03) or for pause-duration options ("1 week"/"1 month"/"until
   date"). Client pause sheet labels its rows with the keyed
   `donor.paused` + resulting date instead. Add keys in both languages
   before launch.
2. **SCR-D05 (alert & privacy settings)** is P2-adjacent but its core
   toggles (platelets opt-in, call mode, volunteers-may-call, verified
   only) already save through `donors.upsert` from donor setup; the
   dedicated `/donor/settings` screen and the if-time limits UI remain
   unbuilt (settings *enforcement* is fully server-side in P2).
3. **Client screens are wired but not runtime-verified** — same status as
   P1: no device/emulator pass, no live deploy (per brief). The P1-era
   loose payload typing (`any`-shaped reads in screens) is unchanged.
4. **NTF-14** copy is not sent to donors (see Notes); the stale flag is
   raised for staff only.
5. **Travel range** uses thana adjacency + straight-line distance from
   thana centroids (schema has no per-donor coordinates) — same
   approximation as P1 ranking; VAL-18's "default 25" fallback applies
   when a donor never set a range.
6. **Gender** remains `unspecified` for everyone (P1 gap: picker labels
   unkeyed in specs), so the conservative 120-day interval applies
   universally until the labels are keyed.
7. *(Corrected by the independent P2 review — not a gap.)* `requests.update`
   changing `neededBy` **does** re-arm the auto-close job, and `autoClose`
   also self-corrects against the current `neededBy`; there is no defect
   here. An earlier draft of this report claimed otherwise.

## Unverifiable until human steps (unchanged from P1)

Live push delivery, Telegram verification against real bots, OAuth
sign-in on the deployed site, and any on-device behaviour still require
the accounts/keys only Shakib can provide. Nothing in P2 was deployed;
the staging deployment still runs P0 code (verified during P1 review).
