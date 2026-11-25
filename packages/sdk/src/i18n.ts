/**
 * Interface language (Hebrew or English), shared by the app, the core and plugins.
 *
 * UI copy is written inline in both languages: `t("שלום", "Hello")`. This keeps every string
 * next to its translation, so nothing is left half-translated and contributors see both.
 * The AI is told to answer in the same language (see `languageName`).
 */
export type Lang = "he" | "en";

let current: Lang = "he";
const listeners = new Set<() => void>();

export function getLanguage(): Lang {
  return current;
}

export function setLanguage(lang: Lang) {
  if (lang === current) return;
  current = lang;
  listeners.forEach((f) => f());
}

export function onLanguageChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Pick the string for the current language. */
export function t(he: string, en: string): string {
  return current === "en" ? en : he;
}

export const isRTL = (lang: Lang = current) => lang === "he";

/** Name of the language as the model should read it in instructions. */
export const languageName = (lang: Lang = current) => (lang === "en" ? "English" : "Hebrew");
