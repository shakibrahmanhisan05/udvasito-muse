# Data licences

Reference data used by UDVASITO, its source and licence (credited on the
About page, roadmap §5.2).

| Dataset | Source | Licence | Status |
|---|---|---|---|
| Places (divisions, districts, upazilas) | **nuhil/bangladesh-geocode**, pinned commit `c4b950b5cd2a65d42d75b12f7fad459e12777df6`, downloaded 2026-11-26; raw files in `data/geo/` | Repo compilation **MIT**; BBS/HDX-derived fields **CC BY-IGO** (Bangladesh Bureau of Statistics / OCHA); GeoNames-derived fields **CC BY 4.0** | ✅ Seeded — 8 divisions / 64 districts / 495 upazilas, `bbs_code` as `places.code`. Pre-seed checks: metro-thana gap confirmed by grep (no Kotwali/Panchlaish rows); 0 rows with empty lat/lon; all 495 upazila names diff-matched against HDX COD-AB **v03** (valid 2023-05-21), 0 differences |
| Chattogram metro thanas (15 seeded as upazila-equivalents, `isMetroThana`) | Names: CCC thana list per data-pack `places-notes.md` §2. Centres: **geoBoundaries ADM3** polygon centroids (11 thanas; boundary licence **CC BY 3.0 IGO**, BBS/OCHA, 2020 snapshot); **GeoNames** points (EPZ, Sadarghat; **CC BY 4.0**); district-point fallback for Akbarshah + Chawkbazar (no licence-clean point found — flagged in `data/places.json` as `pointSource: district-fallback`, member 2 to replace). Bangla names hand-curated in `data/thana-overrides.json`, member 2 verification pending (Day 2). Karnaphuli resolves via the primary dataset's upazila row | As listed per row (`pointSource` in `data/places.json`) | ✅ Seeded with 2 flagged fallbacks |
| Hospitals (Chattogram, 23 rows) | Team data pack (DEP-01 draft): `data/hospitals.csv` + per-row provenance in `data/SOURCES.md` | Team-compiled from public institutional listings (DGHS registry, official hospital sites) | 🟦 Draft in repo — several rows flagged ⚠️ in SOURCES.md for member 2 verification calls before public launch |
| FAQ (draft) | `data/faq.csv` (team data pack) | Team-authored | 🟦 Draft — `reviewedBy`/`reviewedOn` empty = not yet reviewed; importer must keep them draft |
| Brand assets | Team UDVASITO Brand Kit v1.0 ("The Ripple Drop") | © 2026 Team UDVASITO | ✅ In repo (`assets/`, `public/`) |

About-page credit line (EN): *"Geographic data: bangladesh-geocode (MIT),
incorporating Bangladesh Bureau of Statistics data via HDX COD-AB
(CC BY-IGO) and GeoNames (CC BY 4.0); thana boundaries via geoBoundaries
(CC BY 3.0 IGO)."*

**Never used:** GADM (licence-disqualified — non-commercial / no
redistribution), per ADR-013 research in the data pack.
