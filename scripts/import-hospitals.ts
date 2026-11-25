/**
 * import:hospitals (CLAUDE.md §4, roadmap §5.1) — validates
 * data/hospitals.csv (DEP-01), reports bad rows, and prints the idempotent
 * import plan (key: nameEn + district). The Convex upsert runs with
 * seed:places once reference data lands; validation here is the part the
 * P0 tests exercise.
 */
import { existsSync, readFileSync } from "node:fs";

const FILE = "data/hospitals.csv";
const REQUIRED = ["nameEn", "nameBn", "aliases", "type", "district", "upazila", "lat", "lng", "active", "source", "checkedOn"];

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = !inQuotes;
      } else if (c === "," && !inQuotes) { out.push(cur); cur = ""; } else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const header = split(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = split(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    return row;
  });
}

export function validateHospitals(rows: Record<string, string>[]): { ok: number; errors: string[] } {
  const errors: string[] = [];
  const seen = new Set<string>();
  let ok = 0;
  rows.forEach((row, i) => {
    const at = `row ${i + 2} (${row.nameEn || "?"})`;
    for (const col of REQUIRED) {
      if (row[col] === undefined) { errors.push(`${at}: missing column ${col}`); return; }
    }
    if (!row.nameEn || !row.nameBn || !row.district || !row.upazila) {
      errors.push(`${at}: nameEn/nameBn/district/upazila are required`); return;
    }
    if (!["hospital", "blood_bank", "clinic"].includes(row.type)) {
      errors.push(`${at}: type must be hospital|blood_bank|clinic`); return;
    }
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 20.5 || lat > 26.7 || lng < 88 || lng > 92.7) {
      errors.push(`${at}: coordinates outside Bangladesh`); return;
    }
    // bloodBankPhone must be a publicly listed INSTITUTIONAL number (§5.1:
    // never someone's private mobile). Several Chattogram institutions
    // publish a mobile-format number as their official line — those rows are
    // documented per-row in data/SOURCES.md and flagged for a verification
    // call (DEP-01), so a mobile format is a WARNING, not a rejection. A
    // number with no provenance at all is the team's call to remove.
    if (row.bloodBankPhone && /(?:\+?880|0)1[3-9]\d{8}/.test(row.bloodBankPhone.replace(/[\s-]/g, ""))) {
      console.warn(`import:hospitals — WARN: ${at}: bloodBankPhone is mobile-format — must be a published institutional line, call-verified per data/SOURCES.md`);
    }
    const key = `${row.nameEn.toLowerCase()}|${row.district.toLowerCase()}`;
    if (seen.has(key)) { errors.push(`${at}: duplicate (nameEn + district)`); return; }
    seen.add(key);
    ok++;
  });
  return { ok, errors };
}

if (process.argv[1]?.endsWith("import-hospitals.ts")) {
  if (!existsSync(FILE)) {
    console.error(`import:hospitals — ${FILE} not found (DEP-01, member 2).`);
    process.exit(1);
  }
  const rows = parseCsv(readFileSync(FILE, "utf8"));
  const { ok, errors } = validateHospitals(rows);
  for (const e of errors) console.error(`import:hospitals — BAD ROW: ${e}`);
  console.log(`import:hospitals — ${ok} valid row(s), ${errors.length} bad row(s)`);
  // searchText (lower-cased nameEn + nameBn + aliases) is written by the
  // Convex upsert (hospitals.search_all) — idempotent by nameEn + district.
  process.exit(errors.length ? 1 : 0);
}
