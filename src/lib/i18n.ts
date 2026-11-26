import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import * as Localization from "expo-localization";
import AsyncStorage from "@react-native-async-storage/async-storage";
import en from "../i18n/en.json";
import bn from "../i18n/bn.json";

export type AppLanguage = "en" | "bn";
export const LANGUAGE_STORAGE_KEY = "udvasito.language";
/** Selectable app languages, in welcome-screen order (Bangla first). */
export const APP_LANGUAGES: AppLanguage[] = ["bn", "en"];

/**
 * Language rules (F-104, specs §1.6): English by default; Bangla when the
 * device/browser language is Bangla or the shared link carries ?lang=bn;
 * the user's stored choice always wins once picked.
 */
export function detectInitialLanguage(urlLang?: string | null): AppLanguage {
  if (urlLang === "bn" || urlLang === "en") return urlLang;
  const locales = Localization.getLocales();
  const first = locales[0]?.languageCode ?? "en";
  return first === "bn" ? "bn" : "en";
}

export async function getStoredLanguage(): Promise<AppLanguage | null> {
  const v = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
  return v === "bn" || v === "en" ? v : null;
}

export async function setLanguage(lang: AppLanguage): Promise<void> {
  await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  await i18n.changeLanguage(lang);
}

export async function initI18n(urlLang?: string | null): Promise<AppLanguage> {
  const stored = await getStoredLanguage();
  const lang = stored ?? detectInitialLanguage(urlLang);
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      resources: { en: { translation: en }, bn: { translation: bn } },
      lng: lang,
      fallbackLng: "en",
      interpolation: { escapeValue: false },
    });
  } else if (i18n.language !== lang) {
    await i18n.changeLanguage(lang);
  }
  return lang;
}

export default i18n;
