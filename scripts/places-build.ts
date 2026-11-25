/**
 * Places transform (ADR-013, roadmap §5.2, data-pack places-notes.md).
 * Pure functions — unit-tested in tests/places.test.ts; the CLI runner is
 * scripts/seed-places.ts.
 *
 * Sources (see docs/data-licences.md):
 * - Primary: nuhil/bangladesh-geocode @ c4b950b (MIT; BBS/HDX CC BY-IGO;
 *   GeoNames CC BY 4.0) — 8 divisions / 64 districts / 495 upazilas, EN+BN,
 *   lat/lon on every row, `bbs_code` as the stable code.
 * - Chattogram metro thanas: data/thana-overrides.json (geoBoundaries ADM3
 *   centroids / GeoNames points / flagged district-point fallbacks).
 * - Neighbours: haversine between upazila-level centres within the same
 *   district, radius = settings.neighbourKm (S-32), computed at seed time.
 */
export type PlaceLevel = "division" | "district" | "upazila";

export type PlaceRow = {
  level: PlaceLevel;
  code: string;
  nameEn: string;
  nameBn: string;
  parentCode: string | null;
  lat: number;
  lng: number;
  isMetroThana: boolean;
  pointSource: string;
  neighbourCodes: string[];
};

type RawRow = Record<string, string>;

/** The dataset's JSON files are phpMyAdmin-style exports: header + table. */
export function parseGeocodeTable(json: unknown): RawRow[] {
  const parts = json as Array<{ type?: string; data?: RawRow[] }>;
  const table = parts.find((p) => p.type === "table");
  if (!table?.data) throw new Error("geocode JSON: no table part found");
  return table.data;
}

export type ThanaOverride = {
  nameEn: string;
  nameBn: string;
  pointSource: string;
  sourceName?: string;
  lat?: number;
  lng?: number;
};

const BD_BBOX = { minLat: 20.5, maxLat: 26.7, minLng: 88.0, maxLng: 92.7 };

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function buildPlaces(input: {
  divisions: RawRow[];
  districts: RawRow[];
  upazilas: RawRow[];
  thanaOverrides: { districtCode: string; thanas: ThanaOverride[] };
}): PlaceRow[] {
  const rows: PlaceRow[] = [];
  const divById = new Map<string, string>();
  const distById = new Map<string, string>();

  for (const d of input.divisions) {
    divById.set(d.id, d.bbs_code);
    rows.push({
      level: "division", code: d.bbs_code, nameEn: d.name, nameBn: d.bn_name,
      parentCode: null, lat: Number(d.lat), lng: Number(d.lon),
      isMetroThana: false, pointSource: "bangladesh-geocode", neighbourCodes: [],
    });
  }
  for (const d of input.districts) {
    distById.set(d.id, d.bbs_code);
    rows.push({
      level: "district", code: d.bbs_code, nameEn: d.name, nameBn: d.bn_name,
      parentCode: divById.get(d.division_id) ?? null, lat: Number(d.lat), lng: Number(d.lon),
      isMetroThana: false, pointSource: "bangladesh-geocode", neighbourCodes: [],
    });
  }
  for (const u of input.upazilas) {
    rows.push({
      level: "upazila", code: u.bbs_code, nameEn: u.name, nameBn: u.bn_name,
      parentCode: distById.get(u.district_id) ?? null, lat: Number(u.lat), lng: Number(u.lon),
      isMetroThana: false, pointSource: "bangladesh-geocode", neighbourCodes: [],
    });
  }

  // Metro thanas (Chattogram CCC) as upazila-equivalent rows.
  const district = rows.find((r) => r.code === input.thanaOverrides.districtCode);
  if (!district) throw new Error(`thana overrides: district ${input.thanaOverrides.districtCode} not found`);
  for (const t of input.thanaOverrides.thanas) {
    const fallback = t.pointSource === "district-fallback";
    rows.push({
      level: "upazila",
      code: `THANA-${district.nameEn.toUpperCase()}-${t.nameEn.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`,
      nameEn: t.nameEn, nameBn: t.nameBn,
      parentCode: district.code,
      lat: fallback ? district.lat : (t.lat as number),
      lng: fallback ? district.lng : (t.lng as number),
      isMetroThana: true, pointSource: t.pointSource, neighbourCodes: [],
    });
  }
  return rows;
}

/** Neighbours: same-district upazila-level pairs within radiusKm (S-32). */
export function computeNeighbours(rows: PlaceRow[], radiusKm: number): void {
  const byDistrict = new Map<string, PlaceRow[]>();
  for (const r of rows) {
    if (r.level !== "upazila" || !r.parentCode) continue;
    const list = byDistrict.get(r.parentCode) ?? [];
    list.push(r);
    byDistrict.set(r.parentCode, list);
  }
  for (const list of byDistrict.values()) {
    for (const a of list) {
      a.neighbourCodes = list
        .filter((b) => b.code !== a.code && haversineKm(a, b) <= radiusKm)
        .map((b) => b.code)
        .sort();
    }
  }
}

export function validatePlaces(rows: PlaceRow[]): string[] {
  const errors: string[] = [];
  const codes = new Set<string>();
  for (const r of rows) {
    if (codes.has(r.code)) errors.push(`duplicate code ${r.code}`);
    codes.add(r.code);
    if (!r.nameEn || !r.nameBn) errors.push(`${r.code}: missing EN/BN name`);
    if (!(r.lat >= BD_BBOX.minLat && r.lat <= BD_BBOX.maxLat && r.lng >= BD_BBOX.minLng && r.lng <= BD_BBOX.maxLng)) {
      errors.push(`${r.code}: coordinate outside Bangladesh bbox`);
    }
    if (r.level !== "division" && !r.parentCode) errors.push(`${r.code}: missing parent`);
    if (r.parentCode && !rows.some((p) => p.code === r.parentCode)) {
      errors.push(`${r.code}: parent ${r.parentCode} not found`);
    }
  }
  const count = (lvl: PlaceLevel) => rows.filter((r) => r.level === lvl).length;
  if (count("division") !== 8) errors.push(`expected 8 divisions, got ${count("division")}`);
  if (count("district") !== 64) errors.push(`expected 64 districts, got ${count("district")}`);
  const datasetUpazilas = rows.filter((r) => r.level === "upazila" && !r.isMetroThana).length;
  if (datasetUpazilas !== 495) errors.push(`expected 495 dataset upazilas, got ${datasetUpazilas}`);
  // Neighbour symmetry.
  const byCode = new Map(rows.map((r) => [r.code, r]));
  for (const r of rows) {
    for (const n of r.neighbourCodes) {
      if (!byCode.get(n)?.neighbourCodes.includes(r.code)) {
        errors.push(`neighbour link ${r.code} -> ${n} is not symmetric`);
      }
    }
  }
  return errors;
}
