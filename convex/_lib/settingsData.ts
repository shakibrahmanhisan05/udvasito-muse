/**
 * Every rule number in the product lives here as a seeded `settings` row
 * (docs/specs.md §5.2, PRD §5.10). Logic NEVER hard-codes these numbers —
 * it reads them through convex/_lib/settings.ts (CLAUDE.md rule 9).
 * Grouped rows in §5.2 (e.g. confirmPromptHours / confirmReminderHours)
 * are stored as individual keys.
 */
/** Validation rule for one field of an object-valued setting (specs §5.2). */
export type SettingFieldRule = {
  /** Inclusive range for a numeric field. */
  range?: [number, number];
  /** Required string format — currently only the S-21 "HH:mm" clock time. */
  format?: "HH:mm";
};

export type SettingDef = {
  key: string;
  /** Default value seeded in P0. */
  value: unknown;
  /** Inclusive numeric range for single-number settings (validated on write). */
  range?: [number, number];
  /**
   * Per-field rules for object-valued settings, keyed by field name
   * (specs §5.2 grouped rows). The value's structure itself — field
   * set and primitive types — is validated against the default's shape.
   */
  fieldRules?: Record<string, SettingFieldRule>;
  /** Inclusive range applied to every element of an array-of-numbers setting. */
  elementRange?: [number, number];
  /**
   * Element type for an array-valued setting whose default is empty, so
   * the element type cannot be inferred from a default element.
   */
  elementType?: "number" | "string" | "boolean";
  ref: string; // PRD §5.10 S-xx reference
};

export const SETTING_DEFS: SettingDef[] = [
  { key: "minAge", value: 18, ref: "S-01" }, // fixed — cannot be lowered
  { key: "maxDonorAge", value: 65, range: [60, 70], ref: "S-02" },
  { key: "minWeightKg", value: 50, range: [45, 60], ref: "S-03" },
  { key: "intervalWholeMaleDays", value: 90, range: [56, 180], ref: "S-04" },
  { key: "intervalWholeOtherDays", value: 120, range: [56, 180], ref: "S-05" },
  { key: "intervalPlateletDays", value: 14, range: [2, 30], ref: "S-06" },
  { key: "intervalPlateletToWholeDays", value: 14, range: [2, 90], ref: "S-07" },
  { key: "waveSizes", value: [10, 25, 50], elementRange: [1, 200], ref: "S-08" },
  {
    key: "waveIntervalMin",
    value: { now: 5, today: 15, later: 30 },
    fieldRules: { now: { range: [1, 120] }, today: { range: [1, 120] }, later: { range: [1, 120] } },
    ref: "S-09",
  },
  { key: "waveCount", value: 3, range: [1, 5], ref: "S-10" },
  { key: "compatibleInFinalWave", value: true, ref: "S-11" },
  { key: "extraConfirmedSlots", value: 1, range: [0, 3], ref: "S-12" },
  { key: "volunteerHotlineDelaySec", value: 30, range: [10, 600], ref: "S-13" },
  { key: "maxVolunteersShown", value: 2, range: [1, 5], ref: "S-14" },
  {
    key: "stillComingAfterMin",
    value: { now: 10, other: 20 },
    fieldRules: { now: { range: [5, 120] }, other: { range: [5, 120] } },
    ref: "S-15",
  },
  { key: "stillComingBeforeNeededMin", value: 30, range: [10, 180], ref: "S-15c" },
  { key: "stillComingAnswerMin", value: 5, range: [2, 30], ref: "S-16" },
  { key: "autoCloseAfterNeededHours", value: 6, range: [1, 48], ref: "S-17" },
  { key: "contactVisibleAfterCloseDays", value: 7, range: [1, 30], ref: "S-18" },
  { key: "confirmPromptHours", value: 24, range: [1, 72], ref: "S-19" },
  { key: "confirmReminderHours", value: 24, range: [1, 72], ref: "S-19" },
  { key: "donorAlertCapPerDay", value: 3, range: [1, 10], ref: "S-20" },
  {
    key: "quietHours",
    value: { start: "00:00", end: "07:00" },
    fieldRules: { start: { format: "HH:mm" }, end: { format: "HH:mm" } },
    ref: "S-21",
  },
  { key: "openRequestsUnverified", value: 1, range: [1, 50], ref: "S-22" },
  { key: "openRequestsVerified", value: 2, range: [1, 50], ref: "S-22" },
  { key: "requestsPerMonth", value: 5, range: [1, 50], ref: "S-22" },
  { key: "volunteerRequestsPerMonth", value: 20, range: [1, 50], ref: "S-22" },
  { key: "revealsPerRequesterPerDay", value: 10, range: [1, 50], ref: "S-23" },
  { key: "revealFlagPerDay", value: 20, range: [5, 200], ref: "S-24" },
  { key: "signupsPerDevicePerHour", value: 5, range: [1, 50], ref: "S-25" },
  { key: "slipDeleteMaxDaysAfterClose", value: 7, range: [0, 30], ref: "S-26" },
  { key: "deletionDays", value: 30, range: [1, 30], ref: "S-27" },
  { key: "availabilityNudgeDays", value: 90, range: [30, 365], ref: "S-28" },
  { key: "aiIntakeCallsPerRequest", value: 2, range: [0, 10], ref: "S-29" },
  { key: "assistantQuestionsPerDay", value: 10, range: [0, 50], ref: "S-29" },
  { key: "usageWarnPct", value: 70, range: [50, 99], ref: "S-30" },
  { key: "usageCriticalPct", value: 90, range: [50, 99], ref: "S-30" },
  { key: "duplicateWindowHours", value: 24, range: [1, 72], ref: "S-31" },
  { key: "neighbourKm", value: 10, range: [2, 50], ref: "S-32" },
  { key: "realtimeFallbackSec", value: 15, range: [5, 60], ref: "S-33" },
  { key: "reopenWindowHours", value: 24, range: [0, 72], ref: "S-34" },
  { key: "purgePersonalFieldsDays", value: 30, range: [7, 90], ref: "S-35" },
  { key: "aiLogRetentionDays", value: 30, range: [1, 30], ref: "S-36" },
  {
    key: "noShowPenalty",
    value: { count: 2, days: 90 },
    fieldRules: { count: { range: [1, 10] }, days: { range: [30, 180] } },
    ref: "S-37",
  },
  { key: "consentVersion", value: "2026-11-28-pilot", ref: "X08" },
  { key: "minimumAppVersion", value: "0.1.0", ref: "ADR-007" },
  { key: "latestAppVersion", value: "0.1.0", ref: "ADR-007" },
  // Set at first release (RB-11) — empty until a real APK exists. Never invent values.
  { key: "apkUrl", value: "", ref: "ADR-007" },
  { key: "apkSha256", value: "", ref: "ADR-007" },
  // HUMAN STEP (DEP-05): the super-admin's real 24/7 number. Empty until set
  // by bootstrap — the app must never ship an invented number (specs §1.9).
  { key: "fallbackContactPhone", value: "", ref: "OQ-06" },
  { key: "contactEmail", value: "", ref: "OQ-10" },
  { key: "medicalReviewer", value: { name: "", reviewedAt: 0 }, ref: "OQ-01" },
  {
    key: "ai.features",
    value: { intake: true, duplicate: true, assistant: true, appeal: true, summary: true },
    ref: "F-902",
  },
  // Model IDs recorded after spike S4 (roadmap P0). Empty = AI stays off.
  { key: "ai.models", value: { lite: "", flash: "" }, ref: "ADR-010" },
  { key: "ai.limits", value: { liteDaily: 500, liteRpm: 15, flashDaily: 20 }, ref: "PRD §6.3" },
  {
    key: "verification",
    value: { telegram: true, whatsapp: false, inPerson: true, telegramBot: "", whatsappNumber: "" },
    ref: "ADR-004",
  },
  { key: "inPersonVerificationsPerDay", value: 60, range: [10, 200], ref: "D-R1" },
  { key: "emailSignInEnabled", value: false, ref: "T-5" },
  // Staging is set to true at deploy time; production stays false until judging prep.
  { key: "demoAreaEnabled", value: false, ref: "F-912" },
  // Filled after seed-places loads Chattogram district (OQ-12).
  { key: "pilotDistrictIds", value: [] as string[], elementType: "string", ref: "OQ-12" },
  {
    key: "features",
    value: {
      duplicateWarning: false, sharedLinks: false, campaignStats: false,
      impactNumbers: false, learnPages: false, assistant: false,
      volunteerPost: false, slips: false, repeatRequest: false,
      donorHistory: false, reminders: false, editProfile: false,
      alertLimits: false, settingsEdit: false, directoryUi: false,
      faqUi: false, dataImportExport: false, weeklySummary: false,
      emailAlerts: false, installPrompts: false, pinMap: false,
    },
    ref: "roadmap P7",
  },
];

export const SETTING_KEYS = SETTING_DEFS.map((d) => d.key);
