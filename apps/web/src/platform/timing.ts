import { t } from "@ruecai/sdk";

/**
 * Learns how long each kind of long task takes on this device / key / model, so waiting screens
 * can say "about 40 seconds left" instead of spinning forever. Stored per browser in localStorage
 * (a convenience only: losing it just falls back to the defaults below).
 */

/** Typical durations (seconds) with a mid-size course on the default models. */
const DEFAULT_SECONDS: Record<string, number> = {
  "tool:summary": 45,
  "tool:quiz": 40,
  "tool:flashcards": 30,
  "tool:diagram": 25,
  "tool:explainer": 70,
  "tool:exam-from-samples": 90,
  "tool:study-plan": 3,
  "tool:case-brief": 45,
  "tool:worked-example": 45,
  "repair:explainer": 50,
  session: 30,
  "tool:check-solution": 35,
  grade: 12,
  "ingest:per-mb": 25,
  "ingest:base": 15,
};
/** Typical size of the model's answer (characters), for "how much is written" progress. */
const DEFAULT_CHARS: Record<string, number> = {
  "tool:summary": 6000,
  "tool:quiz": 7000,
  "tool:flashcards": 4500,
  "tool:diagram": 1500,
  "tool:explainer": 9000,
  "tool:exam-from-samples": 9000,
  "tool:case-brief": 5000,
  "tool:worked-example": 5000,
  "repair:explainer": 9000,
  session: 7000,
  "tool:check-solution": 5000,
  grade: 900,
};

const KEY = "ruecai.timing.v1";
type Stats = Record<string, { sec?: number; chars?: number; n: number }>;

function load(): Stats {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Stats;
  } catch {
    return {};
  }
}
function save(s: Stats) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}

/** Expected duration in seconds. Demo mode answers are pre-recorded and fast. */
export function expectedSeconds(key: string, demo: boolean): number {
  if (demo) return key.startsWith("ingest") ? 3 : 2;
  const s = load()[key];
  return Math.round(s?.sec ?? DEFAULT_SECONDS[key] ?? 40);
}

/** Expected output size in characters, or undefined when unknown. */
export function expectedChars(key: string): number | undefined {
  return load()[key]?.chars ?? DEFAULT_CHARS[key];
}

/** Record a finished run (exponential moving average, so it adapts to the student's model and material). */
export function recordRun(key: string, seconds: number, chars?: number, demo = false) {
  if (demo || !(seconds > 0)) return;
  const all = load();
  const prev = all[key] ?? { n: 0 };
  const a = prev.n === 0 ? 1 : 0.35;
  all[key] = {
    n: prev.n + 1,
    sec: prev.sec == null ? seconds : prev.sec * (1 - a) + seconds * a,
    chars: chars ? (prev.chars == null ? chars : prev.chars * (1 - a) + chars * a) : prev.chars,
  };
  save(all);
}

/** "0:42" */
export const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/** Friendly remaining-time phrase in the UI language. */
export function remainingText(sec: number): string {
  if (sec <= 4) return t("עוד רגע", "Almost done");
  if (sec < 60) {
    const s = Math.max(5, Math.round(sec / 5) * 5);
    return t(`נשארו כ-${s} שניות`, `About ${s} seconds left`);
  }
  const m = Math.round(sec / 60);
  return m === 1 ? t("נשארה כדקה", "About a minute left") : t(`נשארו כ-${m} דקות`, `About ${m} minutes left`);
}
