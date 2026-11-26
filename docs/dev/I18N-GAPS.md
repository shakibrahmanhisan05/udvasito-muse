# GAPS.md — UDVASITO i18n extraction: gaps, ambiguities, naming decisions

Source: `specs.md` §1.6, §3.0–§3.7, §4, §6.7, §6.8 · Rules applied: `CLAUDE.md` §2 rule 13
(every string from `en.json`/`bn.json` via `t('key')`, exact copy from specs) and
`roadmap.md` P0 (i18n generated from **every** copy table in specs.md).

**Result: 473 keys extracted. 471 (99.6%) have real Bangla from specs, 0 drafted, 2 (0.4%) English fallback.**
The extractor found **zero** keys defined twice with different values, and **zero** `{{placeholder}}`
mismatches between languages. All Bangla in specs is itself a draft — specs §1.6 rule 6:
member 3 reviews every Bangla string before public launch; keys never change after review.

---

## 1. Missing Bangla (key exists, specs gives no Bangla)

| Key | Section | What specs gives | Treatment in `bn.json` |
|---|---|---|---|
| `notifications.NTF-14.body` | §6.8 | Only `` `{{action}}: {{reason}}` `` — no Bangla template at all | English template carried as fallback; marked in `FALLBACKS.json`. Team must decide whether a Bangla frame is wanted — **not** drafted here, because the string is a moderation-action template (legal-adjacent) |
| `notifications.NTF-17.body` | §6.8 | Only `` `{{kind}}` `` | Identical in both files by necessity — the value is a lone placeholder with no words to translate. Listed for completeness in `FALLBACKS.json` |

No other keyed string in §3, §4, §6.7 or §6.8 lacks Bangla. English-only copy exists in specs
only in *unkeyed* prose — see §4 of this file.

## 2. Referenced in specs but never defined

| Key | Referenced at | Note |
|---|---|---|
| `request.addSlip` | §3.2, SCR-M03 layout item 7 ("`request.addSlip` (if-time)") | The **only** genuine i18n key referenced in §3/§4 that has no copy anywhere in specs. Needs EN + BN copy written and reviewed before the slips feature (P7) is built |

A full scan for backticked dotted tokens in §3–§4 found 10 further undefined tokens —
all are Convex **function names**, not i18n keys, and are listed here only so nobody
re-flags them: `consents.accept`, `intake.parse`, `notifications.markOpened`,
`phoneVerification.startInPerson`, `phoneVerification.status`,
`phoneVerification.lookupInPerson`, `phoneVerification.confirmInPerson`,
`profiles.completeOnboarding`, `push.sendTest`, `admin.people.revokeVerification`.

## 3. Naming decisions (specs gives copy but no literal key names)

Fidelity rule applied: values are always verbatim from specs; only these *key names* had
to be derived, each from the pattern specs itself states. All are flagged so the team can
rename before P0's `extract-copy.ts` is finalised (keys must not change after member 3's review).

| Decision | Keys affected | Basis |
|---|---|---|
| Account-status copy keyed as `accountStatus.<status>.title` / `.body` | 8 keys (`frozen`, `suspended`, `banned`, `deletion_pending`) | §3.1 SCR-O06 gives a Status/Title/Body table with **no key column** |
| `errors.ERR_NOT_ELIGIBLE.reason.<reason>` for the 5 sub-rows (`cooldown`, `group`, `platelets`, `age`, `notLive`) | 5 keys | §6.7 shows them as "↳ reason" rows under `ERR_NOT_ELIGIBLE` without naming keys. **Consequence for the nested JSON:** `errors.ERR_NOT_ELIGIBLE` is both a string and a parent, so in `en.json`/`bn.json` its string lives under `errors.ERR_NOT_ELIGIBLE.message` and the reasons under `.reason.*`. Code must call `t('errors.ERR_NOT_ELIGIBLE.message')` |
| Validation keys as `validation.val<NN>.<case>`; single-message rules use `.message` | 45 keys | §4 states the pattern `validation.<rule>.<case>` but never prints literal keys; case names (`empty`, `short`, `long`, `chars`, `invalid`, `over100`, `past`, `far`, `combo`, `range`, `placeText`, `phone`, `missing`, `future`, `areas`, `motivation`, `reason`, `type`, `size`) are taken from §4's own case labels |
| VAL-22 and VAL-23 share one message in §4 ("Keep it under 80 characters.") | `validation.val22.message`, `validation.val23.message` (same value, both assigned) | §4 row "VAL-22 / VAL-23" gives a single message for two rules |
| Notification keys as `notifications.NTF-<nn>.title` / `.body`, variants `.titleRejected` (NTF-15), `.bodyDonorCalls` (NTF-04), `.urgentPrefix` (NTF-01) | 39 keys | §6.8 gives template IDs (NTF-01…NTF-18), not i18n key names |
| `notifications.NTF-02.body` resolved by reference | 1 key | §6.8 defines NTF-02's body only as "same as NTF-01" — the NTF-01 body string is copied verbatim into NTF-02 |

## 4. Copy present in specs with NO key (cannot be extracted — needs keys + copy review)

These strings exist in specs as prose/layout text. Until they are keyed, an implementation
would either hard-code them (violating CLAUDE.md rule 13) or omit them.

| String (EN / BN) | Section | Problem |
|---|---|---|
| "Use the web app" / "ওয়েব অ্যাপ ব্যবহার করুন" (secondary button) | §3.1 SCR-O05 | Sibling buttons `update.title/body/download` are keyed; this one is not |
| "This request is no longer active. Thank you for caring." / "এই অনুরোধটি আর সক্রিয় নয়। আপনার আন্তরিকতার জন্য ধন্যবাদ।" (closed state) | §3.7 SCR-P02 | No key |
| "This page doesn't exist." / "এই পৃষ্ঠাটি নেই।" | §3.7 SCR-P09 | No key |
| "Your confirmed donations will appear here." / "আপনার নিশ্চিত রক্তদান এখানে দেখাবে।" (empty state) | §3.3 SCR-D06 | No key |
| "Nothing to review. 🎉" / "পর্যালোচনার কিছু নেই।" (empty state) | §3.6 SCR-A02 | No key — and the Bangla drops the 🎉 (minor EN/BN inconsistency) |
| "Stats are being prepared" (snapshot-missing banner) | §3.6 SCR-A01 | No key **and no Bangla at all** |
| SCR-O06 action labels: "View my request · Call helpline", "Call helpline", "Contact us (email)", "Cancel deletion" | §3.1 SCR-O06 table, Actions column | English only, no keys, no Bangla. Some may be intended to reuse `signin.helpline` / `common.*` — specs does not say |
| Decision buttons: Dismiss · Warn user · Hide request · Suspend · Ban · Restore | §3.6 SCR-A03 | No keys, no Bangla |
| Call-mode choice labels "Share numbers" / "I'll call them" | §3.3 SCR-D04 layout | No keys (the related `donor.setup.callMode` and `alert.confirmedCallMode` are keyed, these two option labels are not) |
| Gender option labels (Male / Female / Other / Prefer not to say); "I don't know my group" | §3.3 SCR-D02 steps 1 & 3 | No keys (helpers `donor.setup.genderWhy`, `donor.setup.unknownGroup` are keyed; the option labels themselves are not) |
| Layout labels "Open", "Pause", "Open board", "Available now" | §3.2 SCR-M01 layout items 3, 5, 6 | No keys; some may reuse `donor.available` / `volunteer.onDuty` — specs does not say |
| All row labels on the More screen | §3.4 SCR-M10 | The screen has **no copy section at all** — presumably reuses other screens' keys, but specs never states the mapping |
| Entire Download page (APK button, install guides, iPhone guide) | §3.7 SCR-P08 | **No copy keys at all** for a core (Must) public page |
| Header labels "Download app", "Sign in"; footer text "A student initiative, University of Chittagong"; "Updated every 5 minutes" | §3.7 SCR-P01 layout | No keys (hero/how keys are defined; chrome around them is not) |
| Battery-brand step strings `alertGuide.brand.<brand>.stepN` (Xiaomi/Redmi/POCO, Samsung, Oppo/Realme, Vivo, Tecno/Infinix, Other) | §3.3 SCR-D07 | Key *family* is named but **zero concrete strings exist in specs** — member 3 writes them during build (roadmap DEP-08). Nothing to extract |
| Learn / Dengue / About / Privacy / Terms page bodies | §3.7 SCR-P03–P07 | By design these are Markdown content files, not i18n keys — noted so the merge doesn't treat them as missing. The "Reviewed by {{name}} on {{date}}" line format on learn pages is also unkeyed |

## 5. Contradictions and inconsistencies found

| # | Where | Detail |
|---|---|---|
| C1 | §3.2 SCR-M02 States vs §4 form-level summary | §3.2 quotes the validation summary banner as **"Please fix 2 things above" / "উপরের ২টি বিষয় ঠিক করুন"** (hard-coded "2", no trailing "।" in Bangla). §4 defines the form-level summary as **"Please fix {{count}} thing(s) above." / "উপরের {{count}}টি বিষয় ঠিক করুন।"**. These cannot both be the string. Extraction follows §4 (`validation.summary`), since §4 declares its messages "the exact i18n strings". §3.2's wording should be corrected in specs |
| C2 | §3.2 SCR-M03 States | The reveals-frozen notice "Contact details are paused while we review a report." / "একটি অভিযোগ পর্যালোচনার সময় যোগাযোগের তথ্য স্থগিত আছে।" is quoted unkeyed but is **word-identical** to `errors.ERR_REVEALS_FROZEN` (§6.7). Assumed to reuse that key; specs should say so explicitly |
| — | (checked, **not** contradictions) | No key is defined twice anywhere in §3/§4/§6.7/§6.8. Near-duplicate wording across *different* keys is intentional in specs, e.g. `onboarding.dobHelp` "You must be 18 or older to use UDVASITO." vs `errors.ERR_UNDERAGE` "You need to be 18 or older to use UDVASITO." — both extracted as written |

## 6. Other ambiguities and notes for the merge

- **Plural pairs share one Bangla string in specs:** `units_one`/`units_other` and
  `home.requestsForMeCount_one`/`home.requestsForMeCount_other` each have two English forms
  but a single Bangla form in the specs tables. Both keys carry that Bangla string (correct
  for Bangla, which doesn't mark this plural) — do not "fix" this as a duplicate.
- **`request.writePlaceholder` values embed quotation marks** exactly as printed in specs
  (EN: `e.g. "2 bag B+ lagbe kal sokal CMCH e"`). Kept verbatim; the team may want to strip
  the inner quotes when the input component renders it.
- **`common.demo`** (EN "PRACTICE") is the practice-badge label; **`admin.demo`** (EN "Practice
  area") is the admin screen title. Different keys, both extracted as written.
- **§6.7's header** says error strings live at `errors.<CODE>`; the five reason strings and
  `errors.generic.title` (§3.0) are the only error-namespace keys that live outside a plain
  `errors.<CODE>` shape.
- **Scope note:** §1.3.5 component examples (e.g. CMP-CountdownChip "Volunteer contact in 0:21")
  are outside the §3 extraction scope; their production strings are covered inside §3
  (`request.volunteerIn`, `request.nextWaveIn`).
- Extraction was done by `extract.py` (kept alongside the outputs) so the merge can re-run it
  against a revised specs.md and diff. `extraction-meta.json` records, per key, the screen/section
  it came from and its Bangla provenance.
