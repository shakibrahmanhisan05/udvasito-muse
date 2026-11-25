# UDVASITO (উদ্ভাসিত)

**Find blood donors when time matters.** A free, bilingual (English / Bangla)
blood-donor network for Bangladesh, starting in Chattogram. A family posts one
request — by form, by Bangla voice, or by pasting a post — deterministic rules
(not AI) match it to compatible, eligible, nearby donors and notify them in
waves, and a donor's phone number is shared **only after that donor agrees**.

One Expo codebase serves the Android app and the web app/PWA
(`udvasito.vercel.app`); the backend is Convex. Built by Team T37 (University
of Chittagong) for the "AI Battle" build phase. Hard budget: **৳0/month** —
free tiers only, no credit card on any account.

> UDVASITO connects people. It is **not** a blood bank or a medical service.

## Documents

Read `CLAUDE.md` first if you are the coding agent. The full specification
set lives in [`docs/`](docs/): vision, user stories, grilling notes, PRD,
ADRs (technology decisions), specs (screens, schema, API), roadmap (phases),
and build prompts.

## Stack

Expo SDK · Expo Router · TypeScript (strict) · React Native Web · NativeWind
v4 · Convex (EU) with scheduler/crons · Better Auth (Google sign-in) ·
Telegram + in-person phone verification (৳0) · Expo Push + Web Push ·
Gemini Flash-Lite (free tier, server-side, after code redaction) ·
Sentry · Vitest + convex-test + Playwright · Vercel Hobby · EAS Build/Update.

## Setup (human steps — roadmap §6 runbooks)

1. Create the free accounts (RB-1…RB-9): team Google account, GitHub, Convex
   (projects `udvasito-staging` + `udvasito-prod`, EU), Vercel, Google Cloud
   OAuth client, Telegram bots via BotFather, Firebase (Spark) for FCM,
   Expo/EAS, Google AI Studio, Cloudinary, Sentry. **Never add a card.**
2. Copy `.env.example` to `.env.local` and fill in the names for your
   environment; put server secrets in Convex/Vercel/EAS env — never in git.
3. `npm install`
4. `npx convex login` then `npm run convex` (first run generates
   `convex/_generated/` and deploys to your dev deployment).
5. `npx convex run seed:seedSettings` to load the §5.2 settings.
6. Sign in once with the team Google account, finish onboarding, then run
   `npx convex run admin/bootstrap:bootstrapSuperAdmin '{"authUserId":"…"}'`.

## Commands (contract — CLAUDE.md §4)

| Command | Does |
|---|---|
| `npm run dev` | Expo dev server (web + dev client) |
| `npm run convex` | `npx convex dev` against the dev deployment |
| `npm run check` | Type check + ESLint + Vitest (rules + convex-test) |
| `npm test` | Vitest only |
| `npm run test:e2e` | Playwright web smoke test (practice area) |
| `npm run copy:extract` | Verify/regenerate `en.json` / `bn.json` key parity |
| `npm run content:build` | `src/content/*.md` → `src/content/generated/*.json` |
| `npm run seed:places` · `npm run seed:settings` · `npm run import:hospitals` | Idempotent reference-data loaders (`-- --prod` where applicable) |
| `npm run seed:staging` | Fake data for **staging only** — refuses production |
| `npm run build:web` | Static web export for Vercel |

## Branches & environments

`main` → production (`udvasito-prod`, `udvasito.vercel.app`, EAS channel
`production`). `staging` → staging (`udvasito-staging`, Vercel staging,
channel `preview`). Feature branches → Vercel previews against staging.

## Licence

MIT — see [LICENSE](LICENSE). The UDVASITO logo and brand artwork identify
the project and are not licensed for use representing other projects.
