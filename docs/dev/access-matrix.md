# Access-Control Matrix — every public Convex function (specs §7.4)

**What this is.** The P6 security pass deliverable: every client-callable
Convex function, the minimum identity/role it requires, and the test that
proves the negative case (wrong caller → refusal). Server-side
authorisation is enforced by the wrappers in `convex/_lib/auth.ts`
(specs §6.0): no identity → `ERR_UNAUTHENTICATED`; signed in but wrong
role → `ERR_FORBIDDEN`; right role but someone else's row (or the other
side of the practice wall) → `ERR_NOT_FOUND`. Internal functions
(`internal*`) are not client-callable at all and are listed separately.

**Systematic proof (new in P6)** — `tests/p6-access.test.ts` ("P6-A"
below) calls, with schema-valid arguments:

- **47 functions as a visitor** (no identity) — every one refuses with
  `ERR_UNAUTHENTICATED`; the 4 public functions answer and
  `profiles:me` returns `null`.
- **5 volunteer functions + 16 admin functions as a member** — all
  `ERR_FORBIDDEN`; **5 admin functions as a volunteer** — all
  `ERR_FORBIDDEN`, with admin positive controls proving the refusals
  are role checks, not broken functions.
- **Wrong-owner cases** — another member's request close/owner-view,
  notification mark-opened and phone-verification status are all
  `ERR_NOT_FOUND`; a live donor accepting a request they were never
  notified on is `ERR_NOT_FOUND`.

Per-phase suites (roadmap §2.3 DoD required an access test for every
new public function) provide the remaining per-function negatives:
`tests/p1.test.ts` (accounts, requests, responses), `tests/p2.test.ts`
(lifecycle, reports/blocks), `tests/p3.test.ts` (volunteers, data
rights), `tests/p4.test.ts` (intake, push — including the
admin/people negative matrix that closed the P3 review S3),
`tests/p5.test.ts` (every admin family + practice wall),
`tests/p6.test.ts` (moderation freeze choice, re-consent).

## Public (no sign-in)

| Function | Returns | Negative-case proof |
|---|---|---|
| `public:appConfig` | Public config only (versions, feature switches, public contact/reviewer values) — never personal data | P6-A visitor test asserts the shape; p6 slice 3 test pins the new fields |
| `places:children`, `places:list` | Reference geography | P6-A visitor test (answers); tests/places.test.ts |
| `hospitals:search`, `hospitals:list` | Hospital directory (demo-aware: a signed-in practice caller sees practice rows only) | P6-A visitor test (answers); p1/p5 wall tests |
| `profiles:me` | `null` when signed out; own profile only when signed in | P6-A visitor test |

## Member (any signed-in, active account) — visitor → `ERR_UNAUTHENTICATED` proven in P6-A for every row

| Function | Extra rule beyond membership | Proof |
|---|---|---|
| `profiles:completeOnboarding` | Signed-in identity without a complete profile; S-25 rate limit | p1.test.ts (incl. rate-limit trip) |
| `profiles:updateLanguage`, `profiles:updateProfile` | Own profile only (no id argument exists) | p1/p3 tests |
| `profiles:cancelDeletion` | Own profile; only from `deletion_pending` | p3.test.ts |
| `profiles:requestDeletion` | VAL-25 confirm word | p3.test.ts |
| `profiles:exportMyData` | Own data only; 2/day limit (§6.1) | p3.test.ts |
| `profiles:whoHasMyNumber` 📞-meta | Reveal metadata about the caller only — never a number | p3.test.ts |
| `consents:accept` | terms_privacy only for the CURRENT `consentVersion` (P6) | p6.test.ts slice 2 (visitor + stale-version negatives) |
| `donors:upsert`, `donors:getMine`, `donors:setAvailability`, `donors:confirmStillAvailable`, `donors:updateSettings` | Own donor profile only (no id argument); setAvailability without a donor profile → `ERR_NOT_FOUND` | p1/p2 tests; P6-A (visitor) |
| `hospitals:bloodBanksNear` | Member-only directory view | P6-A (visitor) |
| `phoneVerification:start`, `phoneVerification:startInPerson` | Own verification only; 5/hour limit | p1 tests (incl. limit); P6-A (visitor) |
| `phoneVerification:status` | Own verification only → other member `ERR_NOT_FOUND` | P6-A wrong-owner |
| `phoneVerification:acceptMismatch` | Own verification only | p1 tests |
| `requests:create` | S-22 open/monthly caps; practice wall on hospital/place | p1/p2/p5 tests |
| `requests:listMine` | Caller's requests only | P6-A (visitor) |
| `requests:close`, `requests:update`, `requests:reopen`, `requests:markDonorNotResponding` | Owner (or the claiming volunteer for close) → others `ERR_NOT_FOUND` | p1/p2 tests; P6-A wrong-owner (close) |
| `requests:getForOwner` | Owner only → others `ERR_NOT_FOUND` | P6-A wrong-owner |
| `responses:inbox`, `responses:getForDonor` | Caller's donor profile only | p1/p2 tests; P6-A (visitor) |
| `responses:accept`, `responses:decline`, `responses:markOpened`, `responses:answerStillComing`, `responses:recordOutcome`, `responses:withdraw` | Donor must hold a response row for the request → unnotified donor `ERR_NOT_FOUND`; accept is idempotent per `clientId` | p1/p2 tests; P6-A wrong-owner (accept) |
| `notifications:markOpened` | Recipient only → others `ERR_NOT_FOUND` | P6-A wrong-owner |
| `blocks:create`, `blocks:remove` | Own block list only; cross-wall target `ERR_NOT_FOUND` | p2 tests; P6-A (visitor) |
| `reports:create` | 10/day limit; cross-wall subject/request `ERR_NOT_FOUND` | p2 tests (incl. limit); P6-A (visitor) |
| `support:helpline` 📞 | The helpline number is served only to signed-in members here (D-R3); signed-out callers use the rate-limited HTTP endpoint | P6-A (visitor) |
| `volunteers:apply`, `volunteers:getMine` | Own application only | p3 tests; P6-A (visitor) |
| `push:registerExpoToken`, `push:registerWebSubscription`, `push:unregister`, `push:webPushStatus` | Tokens/subscriptions bind to the caller's own profile | p4 tests; P6-A (visitor) |
| `push:sendTest` | Own devices only; 3/hour limit | p4 tests; P6-A (visitor) |
| `intake:refData` | Member-only reference data for the parser | P6-A (visitor) |
| `intake:parse` (action) | Identity checked in the action; S-29 quota + 10/hour limit; AI receives redacted text only | p4 tests (incl. limit trip + redaction); P6-A (visitor) |

## Volunteer (role volunteer/admin/superadmin) — member → `ERR_FORBIDDEN`

| Function | Extra rule | Proof |
|---|---|---|
| `volunteers:setOnDuty`, `volunteers:setAreas` | Own volunteer profile | p3 tests; P6-A (member) |
| `volunteers:board`, `volunteers:getRequest` | Practice wall; request payloads carry no requester number until the visibility rules allow it | p3 tests; P6-A (member) |
| `volunteers:openCase`, `volunteers:claim`, `volunteers:unclaim` | Claim ownership enforced | p3 tests |
| `volunteers:searchDonors` | 30/hour limit; results contain NO phone numbers | p3 tests (incl. limit + phone-free payloads); P6-A (member) |
| `volunteers:askDonor` | Creates a response only; no number moves | p3 tests |
| `volunteers:revealOptInDonor` 📞 | Only donors who opted in (`volunteersMayCall`); reason required (VAL-18); reveal logged + S-24 flag | p3 tests |
| `phoneVerification:lookupInPerson`, `phoneVerification:confirmInPerson` | Verifier ≠ subject (`ERR_SELF_VERIFICATION`); per-day limit | p1/p3 tests; P6-A (member) |

## Admin (role admin/superadmin) — member AND volunteer → `ERR_FORBIDDEN`

| Function | Extra rule | Proof |
|---|---|---|
| `stats:dashboard`, `stats:recomputeStats` | Snapshot data only; practice rows excluded by construction | p5 tests; P6-A (member + volunteer) |
| `admin/moderation:list`, `admin/moderation:get` | Practice wall (cross-wall item `ERR_NOT_FOUND`); payloads contain no phone numbers or patient names | p5 tests; P6-A (member) |
| `admin/moderation:decide` | VAL-18 reason; dismiss/warn on a frozen item require the freeze choice (P6) | p5 + p6 slice 1 tests; P6-A (member) |
| `admin/people:applications`, `admin/people:search`, `admin/people:get` | Search is by name/internal id — never by phone | p3/p4 tests; P6-A (member, search + applications) |
| `admin/people:reviewVolunteer`, `admin/people:setRole`, `admin/people:setStatus`, `admin/people:revokeVerification` | Last-admin guard on role/status changes | p3/p4 negative matrix (member, volunteer, frozen admin) |
| `admin/people:revealPhone` 📞 | Reason required; audit + S-24 farming flag; the ONLY admin path to a number | p3/p4 tests |
| `admin/audit:list` | Read-only (the module exports nothing else — asserted in p5 tests); actor-wall scoped | p5 tests; P6-A (member) |
| `admin/ai:status`, `admin/ai:log` | Log previews are the redacted stored text, truncated at 200 chars | p5 tests; P6-A (member) |
| `admin/ai:setFeature` | Known feature names only; audited | p5 tests; P6-A (member) |
| `admin/usage:get`, `admin/usage:setManualEntry` | Manual entries validated + audited | p5 tests; P6-A (member) |
| `admin/settings:list` | Read-only (no update function exists in core) | p5 tests; P6-A (member) |
| `admin/demo:status`, `admin/demo:setEnabled`, `admin/demo:reset` | Reset deletes ONLY `isDemo` rows (asserted by id in p5 tests) | p5 tests; P6-A (member + volunteer) |
| `admin/demo:createAccount`, `admin/demo:newPin`, `admin/demo:removeAccount` (actions) | **Superadmin only** — checked inside the action (admin → `ERR_FORBIDDEN` in p5 tests); PIN returned once, never stored | p5 tests |

## HTTP endpoints (Convex site + Vercel)

| Endpoint | Who | Rule | Proof |
|---|---|---|---|
| `GET /public/stats` | Public | Serves the precomputed public snapshot only (practice excluded); `Cache-Control: public, max-age=300` | p5 tests (HTTP layer, exact §6.5 key set) |
| `GET /public/helpline` | Public | 30/hour per network (IP hash) → `429 {retryAfterMin}`; `Cache-Control: no-store` | p1 tests |
| `POST /telegram/webhook` | Telegram | `X-Telegram-Bot-Api-Secret-Token` header must match the env secret | p1 tests |
| `GET /r/[slug]` (Vercel function `api/r/[slug].ts`) | Public | Anonymised request only — no names, no numbers | p0/p2 tests (helpline-bundle + share payload) |
| Better Auth routes (`/api/auth/*`) | Public | Handled by the Better Auth component; practice ID+PIN gate hooks in `convex/auth.ts` (D-R4) | p5 tests (gate internals); live sign-in is a staging-verification item |

## Internal functions (never client-callable)

`seed:seedSettings`, `places:seedPlaces`, `hospitals:importHospitals`,
`matching:*`, `lifecycle:*`, `retention:daily`, `stats:computeSnapshots`,
`stats:getPublicSnapshot`, `intake:guard/reserveQuota/recordAiCall`,
`support:helplineFetch`, `push:webSubscriptionsFor/webPush*`,
`pushWeb:sendToProfile`, `phoneVerification:handleTelegramUpdate`,
`auth:onCreateAuthUser/onUpdateAuthUser/onDeleteAuthUser`,
`admin/bootstrap:bootstrapSuperAdmin`, `admin/ops:*`,
`admin/demo:callerProfile/accountById/practiceById/practiceAuthUsers/
preparePracticeAccount/linkPracticeAccount/deletePracticeAccountData/
recordPinReset/gateCheck/gateAttempt/gateSuccess/revokePracticeSessions`.
Convex enforces this boundary itself: internal functions have no public
API path. Several additionally re-check their actor (e.g.
`preparePracticeAccount` re-verifies a non-demo superadmin actor).

## Rate limits (specs §6.0/§6.1/§6.4/§6.5, PRD §5.8) — coverage audit

| Limit | Where enforced | Trip-tested |
|---|---|---|
| Sign-ups S-25 (5/hour/device) | `profiles:completeOnboarding` via `signUp` limiter | p1 (6th → `ERR_RATE_LIMITED`) |
| Verification starts 5/hour | `phoneVerification:start`/`startInPerson` via `verificationStart` | p1 |
| In-person confirms/day (setting) | `phoneVerification:confirmInPerson` via `inPersonConfirm` | p3 |
| Reports 10/day | `reports:create` via `reportCreate` | p2 |
| Volunteer donor searches 30/hour | `volunteers:searchDonors` via `volunteerSearch` | p3 |
| Intake parses 10/hour + S-29 per-request AI quota | `intake:parse` via `intakeParse` + `intake:guard` | p4 (11th → `ERR_RATE_LIMITED`) |
| Test push 3/hour | `push:sendTest` via `pushTest` | p4 |
| Helpline HTTP 30/hour/IP | `support:helplineFetch` via `helplineFetch` | p1 |
| Data export 2/day (§6.1) | `profiles:exportMyData` — hand-rolled count over the `exports` table (documented in the function: one transaction for identity + check + storage write) | p3 |
| Request caps S-22 (open + monthly) | `requests:create` via `convex/rules/limits.ts` (count rules, not the token limiter) | p1/p2 |
| Reveals S-23 (per requester/day) | `convex/_lib/visibility.ts` (shared by accept-promotions and reveals) | p2/p3 |
| Practice sign-in lock (5 fails / 15 min) | `convex/auth.ts` gate hooks (D-R4) | p5 (gate internals) |

Not yet built (P7 features, so their limits land with them):
`assistant:ask` (S-29 daily cap) and the SCR-A13 personal-data CSV
export (3/day, superadmin).
