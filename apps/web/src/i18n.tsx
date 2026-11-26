/**
 * App-side language handling: which language the UI is in, switching it, and direction-aware
 * helpers. Strings themselves are written inline with `t("עברית", "English")` (from @tutorai/sdk).
 */
import { useSyncExternalStore } from "react";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, type LucideProps } from "lucide-react";
import { getLanguage, isRTL, onLanguageChange, setLanguage, t, type Lang, type ToolManifest } from "@tutorai/sdk";

export { t, getLanguage, isRTL };
export type { Lang };

const KEY = "tutorai.lang";

function apply(lang: Lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
  document.title = lang === "he" ? "TutorAI · עוזר לימודים" : "TutorAI · AI study companion";
}

/** Call once before the first render. Saved choice, else the browser language (Hebrew → he, otherwise en). */
export function initLanguage() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    /* private mode */
  }
  const lang: Lang = saved === "he" || saved === "en" ? saved : navigator.language?.toLowerCase().startsWith("he") ? "he" : "en";
  setLanguage(lang);
  apply(lang);
}

export function switchLanguage(lang: Lang) {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* ignore */
  }
  setLanguage(lang);
  apply(lang);
}

/** Re-renders the caller when the language changes. */
export function useLanguage(): Lang {
  return useSyncExternalStore(onLanguageChange, getLanguage);
}

export const locale = () => (getLanguage() === "he" ? "he-IL" : "en-US");
export const fmtNumber = (n: number) => n.toLocaleString(locale());
export const fmtDate = (d: Date | string) => new Date(d).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });
export const fmtTime = (d: Date) => d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });

/* Direction-aware icons: "forward" points the way text reads (left in Hebrew, right in English). */
export const ArrowForward = (p: LucideProps) => (isRTL() ? <ArrowLeft {...p} /> : <ArrowRight {...p} />);
export const ArrowBack = (p: LucideProps) => (isRTL() ? <ArrowRight {...p} /> : <ArrowLeft {...p} />);
export const ChevronForward = (p: LucideProps) => (isRTL() ? <ChevronLeft {...p} /> : <ChevronRight {...p} />);

/** Localized texts of a tool manifest (English is the base; other languages come from `i18n`). */
export function toolText(m: ToolManifest) {
  const tr = m.i18n?.[getLanguage()];
  return {
    name: tr?.name ?? m.name,
    description: tr?.description ?? m.description,
    label: (input: string) => tr?.inputs?.[input]?.label ?? m.inputs.find((i) => i.name === input)?.label ?? input,
    help: (input: string) => tr?.inputs?.[input]?.help ?? m.inputs.find((i) => i.name === input)?.help,
    option: (input: string, value: string) => tr?.inputs?.[input]?.options?.[value] ?? value,
  };
}
