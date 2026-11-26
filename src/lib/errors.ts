import type { TFunction } from "i18next";

/** Extract the stable ERR_* code from a ConvexError thrown by our functions. */
export function errorCode(e: unknown): string | null {
  const data = (e as { data?: { code?: unknown } } | null)?.data;
  return data && typeof data.code === "string" ? data.code : null;
}

/** User-facing message for a thrown error: errors.<CODE> copy, else generic. */
export function errorText(t: TFunction, e: unknown): string {
  const code = errorCode(e);
  if (code) {
    const key = `errors.${code}`;
    const translated = t(key);
    if (translated !== key) return translated;
  }
  return t("errors.generic.title");
}

/** Validation messageKey from an ERR_VALIDATION payload, when present. */
export function validationKey(e: unknown): string | null {
  const data = (e as { data?: { messageKey?: unknown } } | null)?.data;
  return data && typeof data.messageKey === "string" ? data.messageKey : null;
}
