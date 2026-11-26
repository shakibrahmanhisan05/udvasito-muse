/**
 * Gemini intake client — PURE TypeScript (no Convex imports), so tests
 * can build and inspect the EXACT request body the action sends.
 *
 * Contract: specs §6.10 (prompt + JSON schema), PRD §6.2/§6.3, F-206.
 * The text placed in the payload is ALWAYS the output of
 * rules/redaction.ts — this module never sees the original message.
 * The AI is a suggestion engine only (F-1103): it fills fields the
 * rules parser left missing, it never supplies the contact number
 * (the schema has no phone field, and the number is taken by regex
 * in rules/redaction.ts), and it never decides eligibility/matching.
 */
import {
  findHospitalByName,
  type IntakeFields,
  type IntakeRefData,
} from "../rules/intakeParser";
import { containsPhoneNumber } from "../rules/redaction";

/** Fields that must be present before a request makes sense; the AI is
 *  only consulted when one of these is still missing after rules. */
export const AI_REQUIRED_FIELDS: (keyof IntakeFields)[] = [
  "bloodGroup",
  "units",
  "hospitalId",
];

export function missingRequired(fields: IntakeFields): (keyof IntakeFields)[] {
  return AI_REQUIRED_FIELDS.filter((f) => fields[f] === null);
}

/** The specs §6.10 system prompt, verbatim but for the date slot. */
export function intakeSystemPrompt(todayDhaka: string): string {
  return (
    "You extract blood-request details from a short message written in English, " +
    "Bangla, or Banglish (Bangla written in Latin letters). Return only JSON that " +
    "matches the schema. Use null when a value is not clearly stated — never guess. " +
    "Do not output names, phone numbers, or medical details. " +
    `Today's date in Asia/Dhaka is ${todayDhaka}.`
  );
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    bloodGroup: {
      type: "string",
      nullable: true,
      enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "any", null],
    },
    component: { type: "string", nullable: true, enum: ["whole_blood", "platelets", null] },
    isDengue: { type: "boolean", nullable: true },
    units: { type: "integer", nullable: true },
    hospitalName: { type: "string", nullable: true },
    area: { type: "string", nullable: true },
    neededBy: {
      type: "object",
      nullable: true,
      properties: {
        kind: {
          type: "string",
          nullable: true,
          enum: ["now", "today", "tomorrow", "datetime", null],
        },
        isoDateTime: { type: "string", nullable: true },
      },
    },
  },
} as const;

/**
 * The exact request body POSTed to generativelanguage.googleapis.com.
 * `redactedText` MUST already have passed through rules/redaction.ts.
 */
export function buildIntakePayload(redactedText: string, todayDhaka: string) {
  return {
    system_instruction: {
      parts: [{ text: intakeSystemPrompt(todayDhaka) }],
    },
    contents: [{ parts: [{ text: redactedText }] }],
    generation_config: {
      temperature: 0,
      response_mime_type: "application/json",
      response_schema: RESPONSE_SCHEMA,
    },
  };
}

export function geminiUrl(model: string, apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

/** The AI's extraction, in the specs §6.10 schema shape. */
export type AiIntakeFields = {
  bloodGroup: string | null;
  component: "whole_blood" | "platelets" | null;
  isDengue: boolean | null;
  units: number | null;
  hospitalName: string | null;
  area: string | null;
  neededBy: {
    kind: "now" | "today" | "tomorrow" | "datetime" | null;
    isoDateTime: string | null;
  } | null;
};

const GROUPS = new Set(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "any"]);

/**
 * Validate a Gemini API response body into AiIntakeFields. ANY
 * deviation — HTTP error shape, non-JSON text, out-of-enum values,
 * units outside 1–10 — returns null (the caller treats it as
 * "unavailable" and keeps the rules result). A phone-shaped string in
 * any field also voids the whole response: the AI must never be a
 * channel for personal data, even by accident.
 */
export function parseGeminiResponse(body: unknown): AiIntakeFields | null {
  try {
    const text = (body as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    })?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") return null;
    // Void on a phone in ANY written form — spaced, dotted, Bangla
    // digits — not just contiguous Latin digits (P4 review F3): fields
    // like `area` are merged verbatim, so the check must see every
    // form redact() would remove. containsPhoneNumber digit-normalises.
    if (containsPhoneNumber(text)) return null;
    const raw = JSON.parse(text) as Record<string, unknown>;

    const bloodGroup =
      typeof raw.bloodGroup === "string" && GROUPS.has(raw.bloodGroup)
        ? raw.bloodGroup
        : null;
    const component =
      raw.component === "whole_blood" || raw.component === "platelets"
        ? raw.component
        : null;
    const isDengue = typeof raw.isDengue === "boolean" ? raw.isDengue : null;
    const units =
      typeof raw.units === "number" && Number.isInteger(raw.units) && raw.units >= 1 && raw.units <= 10
        ? raw.units
        : null;
    const hospitalName =
      typeof raw.hospitalName === "string" && raw.hospitalName.trim().length > 0
        ? raw.hospitalName.trim()
        : null;
    const area =
      typeof raw.area === "string" && raw.area.trim().length > 0
        ? raw.area.trim()
        : null;
    let neededBy: AiIntakeFields["neededBy"] = null;
    if (raw.neededBy && typeof raw.neededBy === "object") {
      const nb = raw.neededBy as Record<string, unknown>;
      const kind =
        nb.kind === "now" || nb.kind === "today" || nb.kind === "tomorrow" || nb.kind === "datetime"
          ? nb.kind
          : null;
      const isoDateTime = typeof nb.isoDateTime === "string" ? nb.isoDateTime : null;
      if (kind !== null || isoDateTime !== null) neededBy = { kind, isoDateTime };
    }
    return { bloodGroup, component, isDengue, units, hospitalName, area, neededBy };
  } catch {
    return null;
  }
}

/**
 * Merge AI suggestions into the rules result: the AI fills ONLY fields
 * the rules left null (F-206/F-1103). A rules value is never overridden.
 * The AI's hospitalName is matched back to refData — unmatched names
 * are dropped, and a matched hospital may supply its area when the AI
 * gave none.
 */
export function mergeAiFields(
  rulesFields: IntakeFields,
  ai: AiIntakeFields,
  refData: IntakeRefData,
): IntakeFields {
  const out: IntakeFields = { ...rulesFields };
  if (out.bloodGroup === null && ai.bloodGroup !== null) out.bloodGroup = ai.bloodGroup;
  if (out.component === null && ai.component !== null) out.component = ai.component;
  if (out.isDengue === null && ai.isDengue !== null) out.isDengue = ai.isDengue;
  if (out.units === null && ai.units !== null) out.units = ai.units;
  let hospitalArea: string | undefined;
  if (out.hospitalId === null && ai.hospitalName !== null) {
    const match = findHospitalByName(ai.hospitalName, refData);
    if (match) {
      out.hospitalId = match.id;
      hospitalArea = match.area;
    }
  }
  if (out.area === null) {
    if (ai.area !== null) out.area = ai.area;
    else if (hospitalArea) out.area = hospitalArea;
  }
  if (out.neededByKind === null && ai.neededBy !== null) {
    if (ai.neededBy.kind !== null) out.neededByKind = ai.neededBy.kind;
    else if (ai.neededBy.isoDateTime !== null) out.neededByKind = "datetime";
  }
  return out;
}
