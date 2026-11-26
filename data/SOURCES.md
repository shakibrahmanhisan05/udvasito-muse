# SOURCES.md — provenance for the UDVASITO data pack

Researched **2026-11-26** from public web sources. Rules applied throughout:
no personal phone numbers anywhere; `bloodBankPhone` values are publicly listed
**institutional** numbers only; anything that could not be verified is either left
blank, parked as `active=false`, or listed under "Withheld / excluded" below —
never invented.

**Important framing for `hospitals.csv`:** despite the column name, most institutions do
not publish a *blood-bank-direct* line. Unless a row says otherwise below, the number is
the institution's publicly listed main/facility line, which is what a requester actually
calls. Rows flagged ⚠️ need a verification call by the team (member 2, roadmap DEP-01)
before public launch.

## 1. Hospitals (`data/hospitals.csv`) — per-row provenance

| # | Institution | Key sources | Phone: what it is / status | Other flags |
|---|---|---|---|---|
| 1 | Chittagong Medical College Hospital | DGHS facility registry https://hrm.dghs.gov.bd/public/facility-registry/facilities/751/profile · http://cmch.gov.bd/ | `02-41356220` = DGHS-listed facility number (HIGH). ⚠️ Dedicated blood-bank line NOT found on an official page — verify. Other listings show +880 31-630335 | Registry spells it "Chattogram…"; CSV keeps the roadmap §5.1 example spelling, with the Chattogram spelling as an alias. Coords 22.35928, 91.83078 from the maps listing linked from cmch.gov.bd (±100 m) |
| 2 | Chattagram Maa-O-Shishu Hospital | Official site https://www.cmoshbd.org/index.html | `02333320063` = official-site main line (HIGH); site also lists hotline 10613 | **Private/charitable, NOT government.** Thana Double Mooring (Agrabad). Coords from official-domain maps listing |
| 3 | Chittagong General Hospital | https://hospital.chittagong.gov.bd/ · Wikipedia · BedKoi listing | `01872902555` = number shown on the official-site-linked listing (MEDIUM ⚠️ — a mobile-format institutional contact; verify by call) | Andarkilla, Kotwali thana. Coords from Wikipedia (±100 m) |
| 4 | Bangladesh Institute of Tropical and Infectious Diseases (BITID) | DGHS registry https://hrm.dghs.gov.bd/public/facility-registry/facilities/2245/profile | `02333398016` = DGHS land phone 1 (HIGH); registry also lists …98044, …98046 | In **Sitakunda** upazila (not the city). Coords only 3-decimal precision in DGHS (22.392, 91.758) ⚠️ pin-grade only |
| 5 | Evercare Hospital Chattogram | Official site https://www.evercarebd.com/en/chattogram | `09610800444` = official helpline (HIGH; site also lists 10663) | ⚠️ **Thana uncertain in sources** (listings variously imply Hathazari / Bayezid / Chandgaon for the Anannya–Oxygen area). CSV uses `Hathazari` — member 2 must confirm the upazila/thana on the Day-2 check or the importer/matching tier will be wrong. **Correction:** Evercare is NOT the former Apollo Imperial — separate hospitals ~9 km apart |
| 6 | Apollo Imperial Hospitals | Official site https://aihlbd.org/ · Wikipedia | `09610847847` = official appointment line (HIGH; emergency 09610833833 also listed) | Current official name; opened 2019 as Imperial Hospital, renamed under Apollo management in 2022 — "Imperial Hospital" kept as alias. Khulshi thana (some listings say Pahartali — boundary ⚠️). Coords from Wikipedia (22.35920, 91.79312) |
| 7 | Chevron Clinical Laboratory | http://chevronlab.com/ · medic.bd listing | `01755666969` = institution's published contact (MEDIUM-HIGH) | Type `clinic`: diagnostic lab + specialised/eye hospital units at one Panchlaish complex; operates a blood bank (chevronlab.com/service/blood-bank/). Bangla name sourced |
| 8 | Max Hospital & Diagnostic | http://maxhospitalbd.com/ place data · medic.bd | `01713998166` = official-site place-data number (MEDIUM ⚠️; appointment listings widely use …8199 instead — verify which is the public line) | Mehedibag; thana tagged Kotwali in listings (MEDIUM ⚠️) |
| 9 | Parkview Hospital | http://parkview.com.bd/ place data · medic.bd | `09610818888` (HIGH-MEDIUM) | Panchlaish. DGHS list also shows it as a licensed blood bank |
| 10 | Chattogram Metropolitan Hospital | Official site https://ctgmhpl.com/ | `01814651077` = official-site number (MEDIUM ⚠️ mobile-format; site also lists 01810030998) | O.R. Nizam Road, Panchlaish (GEC Mor area) |
| 11 | National Hospital Chattogram | Official site https://nationalhospital.com.bd/ | `09648250250` = official hotline (HIGH) | Dampara/Mehedibag; thana Kotwali per listings (MEDIUM ⚠️, one listing says Panchlaish) |
| 12 | Medical Centre Hospital | http://medicalcentrebd.com/ place data · doctlab listing | `0241355611` = newer official-site place-data number (MEDIUM ⚠️ — older listings show 031-658501; verify which is live) | Advertises a blood bank. GEC Mor, Panchlaish. Bangla name sourced |
| 13 | CSCR Hospital | ratings.com.bd listing | `01887656565` (MEDIUM-LOW ⚠️ aggregator-sourced; older listings 031-656565) | O.R. Nizam Road, Panchlaish |
| 14 | Royal Hospital | bdmedicare.com listing | `0241355934` (MEDIUM-LOW ⚠️ aggregator-sourced; …35935 also listed) | GEC Mor, Panchlaish |
| 15 | Popular Diagnostic Centre Chattogram | Official site https://www.populardiagnostic.com/ | `09666787810` = official hotline (HIGH) | Diagnostic centre only — no blood-bank evidence; type `clinic` |
| 16 | Ibn Sina Diagnostic & Consultation Center Chattogram | Official branch page https://ibnsinatrust.com/ibn_sina_diagnostic_&_consultation_center_chattogram.php | `09610009622` = official hotline (HIGH; branch landlines +8802334455151-4 also listed) | Diagnostic only; type `clinic`. Katalganj, Panchlaish |
| 17 | Epic Health Care | Official sites https://www.epichcl.com/ · https://www.epichealthcarebd.com/ | `09610800111` = official number (HIGH) | Lists an "Epic Blood Bank" service at the Main Gate branch opposite CMCH; row typed `clinic` with "Epic Blood Bank" as alias |
| 18 | Fatema Begum Red Crescent Blood Center | BDRCS http://www.bdrcs.org/ place data · blood-bank directories | `031-612395` = BDRCS-domain place-data number (MEDIUM ⚠️ — directories conflict: 031-620926 / 031-620685 also listed; verify) | Standalone Red Crescent blood centre, Anderkilla, Kotwali |
| 19 | Sandhani Chattogram Medical College Unit | Sandhani CMC unit's own Facebook page · directories | **Blank in CSV.** A landline (031-616625) appears in directories/place data but its currency could not be verified ⚠️ — team to confirm and fill | Voluntary student-run blood bank inside CMCH campus, Panchlaish. Bangla name sourced from its own page |
| 20 | Chittagong Blood Bank & Transfusion Centre | DGHS Chattogram district licensed-blood-bank list (file-chittagong.portal.gov.bd PDF, licence HSM24477) · doctoraidbd.com | `01837690914` (MEDIUM ⚠️ aggregator-sourced mobile) | Existence/licence HIGH (DGHS list); CMCH East Gate, Panchlaish |
| 21 | Combined Military Hospital Chattogram | Public listings (VyMaps etc.) · Wikipedia (Chattogram Cantonment) | **Withheld.** Listings repeat +880 31-681551 but no official source confirms it (LOW) | `active=false`: military, access-restricted — team decides whether/how to list. Bayezid thana |
| 22 | BNS Patenga (Bangladesh Navy Hospital) | Bangladesh Navy https://navy.mil.bd/ · Navy health-care page | **Not found** on official pages (a number on the Navy Medical College site is the college's, not the hospital's — not used) | `active=false`: naval, access-restricted. New Mooring, Patenga thana |
| 23 | Chattogram Port Hospital | OpenStreetMap/MapCarta node 6134171853 · listings | **Withheld** (only low-grade listing sources) | `active=false`: ⚠️ one listing aggregator marks a same-named Port Authority hospital "permanently closed" (updated 2025-09-24) — status and even the thana (Bandar vs Kotwali per OSM ward tag) need on-the-ground verification |

### Withheld / excluded entirely
- **Lions Blood Bank** (at Chattogram Lions Eye Institute & Hospital, Nasirabad, Khulshi —
  inaugurated 2025-05-25 per the hospital's own Facebook): real, but **no coordinates and
  no blood-bank-direct phone** could be verified from public listings (host hospital line
  +8801511624052 exists). Excluded from the CSV because `lat`/`lng` are required —
  team to pin it on a map and add the row on Day 2.
- **Chittagong University Medical Centre** (Hathazari): excluded — CU's own site says it
  serves students/teachers/staff families only (6 temporary beds); not a public facility.
  No institutional phone found on the official page (a maps-listing mobile was withheld
  as unverifiable as institutional).
- **Quantum Foundation Chattogram**: excluded — only a meditation centre is documented in
  Chattogram; Quantum's voluntary blood donation / lab is documented in Dhaka only.
- **Rotary blood bank, Chattogram**: no public source found — not listed.
- **Upazila Health Complexes** (Patiya, Hathazari, Sitakunda, Raozan, etc., 50-bed,
  DGHS list http://hospitaldghs.gov.bd/wp-content/uploads/2020/03/List-of-50-bed-Hospital.pdf):
  real but below the "major" tier for the pilot directory; candidates for a later import.

### Bangla names
Sourced verbatim: CMCH, Maa-O-Shishu, General Hospital, BITID (DGHS registry BN name),
Chevron, Medical Centre Hospital, Sandhani CMC Unit. All other Bangla names are careful
transliterations of the English proper noun (marked here as **transliteration-unverified**)
— member 3 (Bangla content) should confirm each against the institution's own signage/site.

### Coordinates
All coordinates are listing/OSM/DGHS-grade approximations (±50–200 m), suitable for the
directory pin and thana-tier matching, not navigation. Sources are the institution's own
site place data, Wikipedia, MapCarta/OSM or DGHS as noted per row above.

## 2. FAQ (`data/faq.csv`)

Content source is **the specs themselves** — PRD §5.1 (eligibility table) and §5.2
(compatibility, final-wave-only), PRD §5.4–5.5 (confirmation/cooldown mechanics),
F-801 (money reports freeze accounts), and the SCR-M08 assistant copy in specs §3
(banner / ask-a-doctor fixed reply). PRD §5.1 in turn cites a Bangladeshi medical
journal (age 18–65, ≥50 kg, Hb ≥12.5 g/dL, 3-month men / 4-month women intervals) and
WHO (18–65, ≥50 kg); platelet intervals cite UK guidance (14 days) — see PRD §5.1 for
those citations; no rule in the FAQ goes beyond PRD §5.1/§5.2. Every clinical-personal
topic (medication, chronic conditions, pregnancy, tattoos, recent illness incl. dengue)
is answered only with the fixed "ask a doctor / the blood bank" position, per F-604.
`reviewedBy`/`reviewedOn` are **empty for all 24 rows on purpose**: per roadmap §5.3
they import as `draft` and the assistant must never use them until the team's medical
reviewer approves them (PRD OQ-01). Bangla translations are drafts for member 3's review.

## 3. Places (`data/places-notes.md`)

- Primary: **nuhil/bangladesh-geocode**, https://github.com/nuhil/bangladesh-geocode —
  MIT (LICENSE in repo); layered attributions CC BY-IGO (BBS via HDX COD-AB) and
  CC BY 4.0 (GeoNames postcodes) from its README sources table. Counts 8/64/495/4,540,
  EN+BN + lat/lng at every level, `bbs_code` join key.
- HDX COD-AB: https://data.humdata.org/dataset/cod-ab-bgd — BBS via OCHA, CC BY-IGO;
  v03 ADM3 = 495 upazilas + 12 city corporations (600-feature source incl. metro thanas).
- geoBoundaries Bangladesh ADM3 (544 features incl. metro thanas): CC BY 4.0 /
  source CC BY 3.0 IGO — https://www.geoboundaries.org/.
- GeoNames Bangladesh dumps (CC BY 4.0): https://download.geonames.org/export/dump/.
- Metro-thana checklist: `@bangladeshi/bangladesh-address` (MIT),
  https://github.com/rajuAhmed1705/bangladesh-address; CCC thana list (16 thanas) via
  Chattogram City Corporation / Wikipedia listings.
- Rejected: bayeziddev/Bangladesh-geocode (494 upazilas, district-only coords);
  GADM (https://gadm.org/data.html — non-commercial, no redistribution: cross-check only).
- The ADR-013 candidate names `bd-geocode-with-lat-long` and `bangladesh-geo-data` were
  **not found as GitHub repositories**; `bangladesh-geo-data` exists only as a PyPI
  redistribution of bayeziddev's data. Recorded so the team doesn't chase them again.

## 4. Intake test set (`intake-test-set.md` + `data/intake.jsonl`)

Written for this pack in the style of public Facebook/WhatsApp blood-request posts
(roadmap §5.6 format). **All 40 cases are fictional**: invented names, and phone numbers
in the clearly sequential test pattern `01800-0000NN`. No real post, name or number was
copied. Expected fields use the canonical hospital names from `data/hospitals.csv`.
The roadmap P4 target set is "40 real messages" collected by the team (DEP-09) — this
draft gives the build a working acceptance set now; the team should progressively swap
in anonymised real posts (names/numbers replaced before saving, per §5.6) before judging.
