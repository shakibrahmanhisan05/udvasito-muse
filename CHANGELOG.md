# Changelog

## 2026-11-26 — P0 QA fix pass
- **SDK aligned to 57** per ADR-001 (QA D1): expo ~57.0.0, RN 0.86.3, React 19.2.3 — full check suite green on 57.
- **i18n lint gate on** (QA D2): eslint-plugin-i18next, `i18next/no-literal-string` as error in `npm run check`; planted-literal proof recorded in the P0 report. i18n now 106 keys.
- **CI** (QA D3): `npm audit --omit=dev --audit-level=high` step + Dependabot config added (workflows landed in c892575).
- **Places dataset seeded** (QA D4): nuhil/bangladesh-geocode (pinned commit) — 8/64/495 + 15 Chattogram metro thanas (geoBoundaries/GeoNames points, 2 flagged district-point fallbacks), S-32 neighbours precomputed, count test in tests/places.test.ts, licences in docs/data-licences.md.
- **Hospitals + FAQ data** (QA D6): 23 hospital rows + draft FAQ from the team data pack, provenance in data/SOURCES.md; importer 23 valid / 0 bad.
- **Extras** (QA D7/D8): public/service-worker.js (web push + offline shell, registered on web), api/r/[slug].ts share-link preview (§6.5), src/lib/phone.ts + helpline.ts (D-R3), vercel.json CSP gains OpenFreeMap sources; /r/:slug rewrite added.

## 2026-11-26 — P0 foundations (code)
- Repo scaffold: Expo Router + TypeScript strict (SDK 58 — see docs/questions.md), app identity per specs §1.2.1, brand assets from Brand Kit v1.0.
- Convex: complete §5.1 schema (27 tables), §5.2 settings seed, `_lib` wrappers, Better Auth component wiring, admin bootstrap/ops.
- Design system tokens (§1.3), base components, i18n EN/BN (104 keys, parity-checked), root gates G1–G3 live + G4–G7 skeleton.
- Pure rules: eligibility + compatibility fully implemented and unit-tested; waves/limits/ranking/redaction implemented; intake parser typed stub (P4).
- CI (GitHub Actions), seed/import scripts, Sentry phone scrubber.
- Verification: `tsc --noEmit` ✅, Vitest 32/32 ✅, ESLint 0 errors ✅.
