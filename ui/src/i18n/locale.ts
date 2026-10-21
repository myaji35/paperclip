import { startDomTranslation, type Dictionary } from "./dom-translator";
import koGenerated from "./ko.json";
import koOverrides from "./ko-overrides.json";

export type Locale = "ko" | "en";

const STORAGE_KEY = "paperclip.locale";
const DEFAULT_LOCALE: Locale = "ko";

export function getLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "ko" || stored === "en") return stored;
  } catch {
    // Storage unavailable (private mode etc.) — fall back to default.
  }
  return DEFAULT_LOCALE;
}

export function setLocale(locale: Locale) {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Ignore — reload still applies the default.
  }
  // Translations are applied to the live DOM; a reload is the simplest clean switch.
  window.location.reload();
}

export function initLocale() {
  const locale = getLocale();
  document.documentElement.lang = locale;
  if (locale !== "ko") return;
  const dict: Dictionary = { ...(koGenerated as Dictionary), ...(koOverrides as Dictionary) };
  startDomTranslation(dict);
}
