import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { SETTING_DEFS } from "../convex/_lib/settingsData";
import { consentSatisfies } from "../src/lib/consent";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => undefined },
}));

/**
 * P6 slice 2 — client side of the re-consent machinery: the G3 gate
 * decision (pure), the source contract that the root layout compares
 * against the SERVER's current version (not the compiled-in fallback),
 * and the guarantee that the legal texts the member is shown carry
 * the same version string as the settings default — so "accept the
 * new texts" always refers to the texts actually bundled.
 */
describe("P6 client — consent gate decision", () => {
  it("old version → blocked; current version → passes; no record → blocked", () => {
    expect(consentSatisfies("2026-11-28-pilot", "2026-12-08-final")).toBe(false);
    expect(consentSatisfies("2026-12-08-final", "2026-12-08-final")).toBe(true);
    expect(consentSatisfies("2026-11-28-pilot", "2026-11-28-pilot")).toBe(true);
    expect(consentSatisfies(null, "2026-11-28-pilot")).toBe(false);
    expect(consentSatisfies(undefined, "2026-11-28-pilot")).toBe(false);
    expect(consentSatisfies("", "2026-11-28-pilot")).toBe(false);
  });

  it("root layout G3 reads the server version via public.appConfig", () => {
    const layout = readFileSync("app/_layout.tsx", "utf8");
    expect(layout).toContain("refs.appConfig");
    expect(layout).toContain("appConfig?.consentVersion");
    expect(layout).toContain("consentSatisfies(localVersion, currentVersion)");
  });

  it("welcome records the acceptance server-side for signed-in members", () => {
    const welcome = readFileSync("app/(onboarding)/welcome.tsx", "utf8");
    expect(welcome).toContain("acceptConsent");
    expect(welcome).toContain('kind: "terms_privacy"');
    expect(welcome).toContain("version: currentVersion");
  });

  it("bundled legal texts carry the settings consentVersion (the texts ARE the version)", () => {
    const def = SETTING_DEFS.find((d) => d.key === "consentVersion");
    expect(def).toBeDefined();
    for (const doc of ["privacy.en", "privacy.bn", "terms.en", "terms.bn"]) {
      const generated = JSON.parse(
        readFileSync(`src/content/generated/legal/${doc}.json`, "utf8"),
      ) as { meta: { version: string } };
      expect(generated.meta.version).toBe(def!.value);
      const md = readFileSync(`src/content/legal/${doc}.md`, "utf8");
      expect(md).toContain(`version: ${def!.value as string}`);
    }
  });
});

describe("P6 client — public pages (SCR-P01/P05/P08)", () => {
  it("landing is wired to GET /public/stats and the keyed hero/how copy", () => {
    const src = readFileSync("app/index.tsx", "utf8");
    expect(src).toContain("/public/stats");
    expect(src).toContain('t("landing.hero")');
    expect(src).toContain('t("landing.how1")');
    expect(src).toContain('t("home.needBlood")');
    expect(src).toContain('t("home.becomeDonor")');
    // Native keeps the specs redirect behaviour.
    expect(src).toContain('Platform.OS === "web"');
  });

  it("about carries all 7 Responsible-AI commitments verbatim (PRD §6.4)", () => {
    const src = readFileSync("app/about.tsx", "utf8");
    for (const line of [
      "AI never decides who is contacted — rules do, and they are visible.",
      "AI suggestions are always labelled and confirmed by a person.",
      "Code removes phone numbers, names and diagnoses before any AI call",
      "No AI medical advice; health questions go to doctors and blood banks.",
      "18+ only.",
      "Every AI feature can be switched off instantly; the app works without AI.",
      "AI inputs (redacted) and outputs are logged for 30 days for review.",
    ]) {
      expect(src).toContain(line);
    }
    // Data credit line verbatim from docs/data-licences.md.
    expect(src).toContain("bangladesh-geocode (MIT)");
    expect(src).toContain("CC BY-IGO");
  });

  it("download page is driven by appConfig (APK + checksum) with the iPhone guide", () => {
    const src = readFileSync("app/download.tsx", "utf8");
    expect(src).toContain("appConfig?.apkUrl");
    expect(src).toContain("appConfig?.apkSha256");
    expect(src).toContain("SHA-256 checksum");
    expect(src).toContain("Add to Home Screen");
    expect(src).toContain("beforeinstallprompt");
  });
});

describe("P6 — web security headers (specs §7.4)", () => {
  it("vercel.json carries the full §7.4 header set on every route", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      headers: { source: string; headers: { key: string; value: string }[] }[];
    };
    const all = vercel.headers.find((h) => h.source === "/(.*)");
    expect(all).toBeDefined();
    const byKey = new Map(all!.headers.map((h) => [h.key, h.value]));
    expect(byKey.get("X-Content-Type-Options")).toBe("nosniff");
    expect(byKey.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(byKey.get("X-Frame-Options")).toBe("DENY");
    expect(byKey.get("Permissions-Policy")).toContain("camera=(self)");
    expect(byKey.get("Permissions-Policy")).toContain("microphone=(self)");
    expect(byKey.get("Permissions-Policy")).toContain("geolocation=(self)");
    const csp = byKey.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("https://*.convex.cloud");
    expect(csp).toContain("https://res.cloudinary.com");
    expect(csp).toContain("https://tiles.openfreemap.org");
    // The CSP must never open script/style to arbitrary https origins.
    expect(csp).not.toContain("script-src *");
    expect(csp).not.toContain("default-src *");
  });

  it("the service worker never caches cross-origin (API/auth) traffic", () => {
    const sw = readFileSync("public/service-worker.js", "utf8");
    expect(sw).toContain("request.url.startsWith(self.location.origin)");
    expect(sw).toContain('request.method !== "GET"');
  });

  it("a11y: shared controls carry roles, labels, state and >=48dp targets (X04 code audit)", () => {
    const button = readFileSync("src/components/Button.tsx", "utf8");
    expect(button).toContain('accessibilityRole="button"');
    expect(button).toContain("accessibilityLabel={props.accessibilityLabel ?? props.label}");
    expect(button).toContain("accessibilityState");
    expect(button).toContain("maxFontSizeMultiplier={2}");
    const chip = readFileSync("src/components/Chip.tsx", "utf8");
    expect(chip).toContain('accessibilityRole="button"');
    expect(chip).toContain("accessibilityLabel={option.label}");
    expect(chip).toContain("minHeight: touch.min");
    const toggle = readFileSync("src/components/LanguageToggle.tsx", "utf8");
    expect(toggle).toContain('accessibilityRole="button"');
    expect(toggle).toContain("minHeight: touch.min");
    const sheet = readFileSync("src/components/Sheet.tsx", "utf8");
    // P6 fix: the backdrop is a real button for assistive tech, and
    // the title is a header so it is announced on open.
    expect(sheet).toContain('accessibilityRole="button"');
    expect(sheet).toContain('accessibilityRole="header"');
    const tokens = readFileSync("src/theme/tokens.ts", "utf8");
    expect(tokens).toContain("min: 48");
    // Status is never colour-only: Banner always renders icon + text,
    // and banners announce via live regions.
    const banner = readFileSync("src/components/Banner.tsx", "utf8");
    expect(banner).toContain("props.icon");
    expect(banner).toContain("props.text");
    expect(banner).toContain('accessibilityLiveRegion="polite"');
    // Inputs grow with text size (minHeight, never a fixed height)
    // and every input carries an accessibility label.
    for (const f of ["app/(onboarding)/sign-in.tsx", "app/(app)/request-new.tsx", "app/(app)/donor-setup.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("minHeight: 52");
      expect(src, f).toContain("accessibilityLabel");
    }
  });
});
