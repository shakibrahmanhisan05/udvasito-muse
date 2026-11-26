/**
 * F-1005 appeal text + share-card image rules (pure; PRD §6.4 F-1005,
 * specs §3.2 SCR-M05). The appeal text comes from the specced template
 * (share.template, quoted verbatim in specs SCR-M05 for EN and BN);
 * the optional AI polish (ai.features.appeal) may only rephrase it —
 * never change its facts, never add a phone number (the owner's number,
 * when they opt in, is appended by code AFTER any AI step, and the
 * image NEVER contains a phone number).
 */

export type AppealData = {
  units: number;
  bloodGroup: string;
  componentLabel: string;
  hospitalName: string;
  areaName: string;
  timeText: string;
  link: string;
};

/** share.template, verbatim from specs §3.2 SCR-M05. */
export const APPEAL_TEMPLATE: Record<"en" | "bn", string> = {
  en: "URGENT: {{units}} bag {{group}} {{component}} needed at {{hospital}}, {{area}} by {{time}}. If you can donate, tap: {{link}}",
  bn: "জরুরি: {{hospital}}, {{area}}-এ {{time}}-এর মধ্যে {{units}} ব্যাগ {{group}} {{component}} প্রয়োজন। রক্ত দিতে পারলে ট্যাপ করুন: {{link}}",
};

export function buildAppealText(data: AppealData, lang: "en" | "bn"): string {
  return APPEAL_TEMPLATE[lang]
    .replaceAll("{{units}}", String(data.units))
    .replaceAll("{{group}}", data.bloodGroup)
    .replaceAll("{{component}}", data.componentLabel)
    .replaceAll("{{hospital}}", data.hospitalName)
    .replaceAll("{{area}}", data.areaName)
    .replaceAll("{{time}}", data.timeText)
    .replaceAll("{{link}}", data.link);
}

/**
 * Guard for AI-polished appeal text: it must keep the link and the
 * blood group verbatim, stay a sane length, and contain no phone-like
 * number (checked by the caller with the redaction rules and passed in
 * as `containsPhone`). Anything else → the caller keeps the template.
 */
export function appealPolishAcceptable(
  polished: string,
  data: AppealData,
  containsPhone: boolean,
): boolean {
  const text = polished.trim();
  if (text.length < 20 || text.length > 600) return false;
  if (containsPhone) return false;
  if (!text.includes(data.link)) return false;
  if (!text.includes(data.bloodGroup)) return false;
  return true;
}

export type CloudinaryConfig = { cloudName?: string; templateId?: string };

/** Cloudinary text overlays treat , / % as syntax — encode them. */
function overlayText(text: string): string {
  return encodeURIComponent(text).replace(/'/g, "%27");
}

/**
 * The public share-card image URL (Cloudinary URL API: the specced
 * template image with text overlays — logo/group/component/units/
 * hospital/area/needed-by/link; NO phone, ever). Returns null when
 * Cloudinary is not configured, so the caller serves the honest
 * template fallback (the bundled og-image) instead.
 */
export function shareCardImageUrl(
  config: CloudinaryConfig,
  data: AppealData,
): string | null {
  if (!config.cloudName || !config.templateId) return null;
  const headline = `${data.units} bag ${data.bloodGroup} ${data.componentLabel}`;
  const detail = `${data.hospitalName}, ${data.areaName} — by ${data.timeText}`;
  const transforms = [
    `l_text:Arial_72_bolder:${overlayText(headline)},co_rgb:FFFFFF,g_center,y_-60`,
    `l_text:Arial_44:${overlayText(detail)},co_rgb:FFFFFF,g_center,y_30`,
    `l_text:Arial_36:${overlayText(data.link)},co_rgb:FFFFFF,g_south,y_40`,
  ].join("/");
  return `https://res.cloudinary.com/${config.cloudName}/image/upload/${transforms}/${config.templateId}`;
}
