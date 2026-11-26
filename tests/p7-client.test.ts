import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SETTING_DEFS } from "../convex/_lib/settingsData";

/**
 * P7 client contracts — source assertions in the p4/p5/p6 style:
 * every P7 feature's entry point is gated on its settings switch in
 * the client (the server gates are covered in tests/p7.test.ts), and
 * every switch exists in SETTING_DEFS with default OFF.
 */

const read = (path: string) => readFileSync(path, "utf8");

describe("P7 client — feature switches exist and default OFF", () => {
  it("the features def carries every P7 switch, all false", () => {
    const def = SETTING_DEFS.find((d) => d.key === "features");
    expect(def).toBeDefined();
    const features = def!.value as Record<string, boolean>;
    for (const name of [
      "duplicateWarning", "sharedLinks", "campaignStats", "impactNumbers",
      "learnPages", "assistant", "volunteerPost", "slips", "repeatRequest",
      "donorHistory", "reminders", "editProfile", "alertLimits",
      "settingsEdit", "directoryUi", "faqUi", "dataImportExport",
      "weeklySummary", "emailAlerts", "installPrompts",
    ]) {
      expect(features[name], name).toBe(false);
    }
  });
});

describe("P7 client — entry points are switch-gated", () => {
  it("share button + duplicate dialog ride on their switches", () => {
    const live = read("app/(app)/request-live.tsx");
    expect(live).toContain("features?.sharedLinks");
    const form = read("app/(app)/request-new.tsx");
    expect(form).toContain("features?.duplicateWarning");
    expect(form).toContain("requestsCheckDuplicate");
  });

  it("campaigns, assistant, volunteer-post and slips entries are gated", () => {
    const volunteer = read("app/(app)/volunteer.tsx");
    expect(volunteer).toContain("features?.campaignStats");
    expect(volunteer).toContain("features?.volunteerPost");
    expect(volunteer).toContain("features?.slips");
    const more = read("app/(app)/more.tsx");
    expect(more).toContain("features?.assistant");
    expect(more).toContain("features?.directoryUi");
    expect(more).toContain("features?.faqUi");
    expect(more).toContain("features?.dataImportExport");
    expect(more).toContain("features?.weeklySummary");
    expect(more).toContain("features?.installPrompts");
  });

  it("landing impact card, learn links and download link are gated", () => {
    const landing = read("app/index.tsx");
    expect(landing).toContain("features?.impactNumbers");
    expect(landing).toContain("features?.learnPages");
    expect(landing).toContain("features?.installPrompts");
    const download = read("app/download.tsx");
    expect(download).toContain("features?.installPrompts");
  });

  it("donor history, reminders confirm, edit profile and email opt-in are gated", () => {
    const donor = read("app/(app)/donor.tsx");
    expect(donor).toContain("features?.donorHistory");
    expect(donor).toContain("features?.reminders");
    expect(donor).toContain("donorsConfirmStillAvailable");
    const settings = read("app/(app)/settings.tsx");
    expect(settings).toContain("features?.editProfile");
    const donorSettings = read("app/(app)/donor/settings.tsx");
    expect(donorSettings).toContain("features?.alertLimits");
    expect(donorSettings).toContain("features?.emailAlerts");
    const requests = read("app/(app)/requests.tsx");
    expect(requests).toContain("features?.repeatRequest");
  });

  it("admin settings editing is gated on settingsEdit", () => {
    const adminSettings = read("app/(app)/admin-settings.tsx");
    expect(adminSettings).toContain("features?.settingsEdit");
    expect(adminSettings).toContain("adminSettingsUpdate");
  });
});

describe("P7 client — lazy-loading contracts (S2-F1)", () => {
  it("root layout keeps Sentry + notifications behind dynamic imports", () => {
    const layout = read("app/_layout.tsx");
    expect(layout).toContain('import("@/lib/sentry")');
    expect(layout).not.toMatch(/^import \* as Sentry/m);
  });

  it("slip attach uses dynamically imported picker/manipulator", () => {
    const live = read("app/(app)/request-live.tsx");
    expect(live).toContain('import("expo-image-picker")');
    expect(live).toContain('import("expo-image-manipulator")');
  });
});
