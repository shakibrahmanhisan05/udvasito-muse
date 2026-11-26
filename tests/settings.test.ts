import { describe, expect, it } from "vitest";
import { SETTING_DEFS, SETTING_KEYS } from "../convex/_lib/settingsData";
import { validateSettingValue } from "../convex/_lib/settings";

describe("settings (specs §5.2)", () => {
  it("every key is unique and has a default", () => {
    expect(new Set(SETTING_KEYS).size).toBe(SETTING_KEYS.length);
    for (const def of SETTING_DEFS) expect(def.value).not.toBeUndefined();
  });
  it("all defaults are inside their allowed ranges", () => {
    for (const def of SETTING_DEFS) {
      expect(() => validateSettingValue(def.key, def.value)).not.toThrow();
    }
  });
  it("out-of-range values are rejected; minAge cannot be lowered", () => {
    expect(() => validateSettingValue("waveCount", 99)).toThrow();
    expect(() => validateSettingValue("minAge", 16)).toThrow();
    expect(() => validateSettingValue("doesNotExist", 1)).toThrow();
  });
  it("core rule defaults match PRD §5.10", () => {
    const get = (k: string) => SETTING_DEFS.find((d) => d.key === k)?.value;
    expect(get("waveSizes")).toEqual([10, 25, 50]);
    expect(get("volunteerHotlineDelaySec")).toBe(30);
    expect(get("donorAlertCapPerDay")).toBe(3);
    expect(get("neighbourKm")).toBe(10);
  });
});
