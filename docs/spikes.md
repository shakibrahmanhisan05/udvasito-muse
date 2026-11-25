# Spikes (roadmap P0 — 1 hour each, time-boxed)

Status at P0 code completion: **not yet run** — S1/S2 need the physical test
phones (DEP-14) and S3/S4 need the live accounts (RB-2/RB-4/RB-9). They are
recorded here honestly as open; no result is claimed without evidence
(specs §1.9).

| # | Question | Status | If it fails |
|---|---|---|---|
| S1 | Does Bangla (`bn-BD`) speech recognition work on the 3 test phones and in Chrome? | ⬜ Needs test phones | Voice shows "not available" on that device; judging walkthrough uses a phone where it works |
| S2 | Does a push reach a locked Xiaomi/Redmi phone with default battery settings? | ⬜ Needs dev build #1 + test phone | Raises the priority of the alert guide (P4) and the in-app `donor.alertsOff` banner |
| S3 | Can the Google sign-in callback run through `udvasito.vercel.app` (Vercel rewrite to the Convex site)? | ⬜ Needs RB-3/RB-4 | Keep the Convex site address on Google's screen for the pilot (R-12) |
| S4 | Does a Gemini free-tier call from a Convex action (EU) return JSON with the current Flash-Lite model ID? | ⬜ Needs RB-9 key | Record the working model ID in `settings.ai.models`; if blocked, AI stays off and the rules parser carries intake (R-06) |
