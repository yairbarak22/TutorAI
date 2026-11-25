import { t } from "@ruecai/sdk";
import type { ConceptInfo, StudyPlan } from "@ruecai/sdk";

export interface PlanInput {
  concepts: ConceptInfo[];
  today: string; // yyyy-mm-dd
  examDate: string; // yyyy-mm-dd
  minutesPerDay: number;
  title?: string;
}

const DAY = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY);

/** Orders concepts so prerequisites come first (Kahn), ties broken by weakness. */
export function prerequisiteOrder(concepts: ConceptInfo[]): ConceptInfo[] {
  const byName = new Map(concepts.map((c) => [c.name, c]));
  const indeg = new Map(concepts.map((c) => [c.name, 0]));
  for (const c of concepts) for (const p of c.prerequisites) if (byName.has(p) && p !== c.name) indeg.set(c.name, indeg.get(c.name)! + 1);
  const ready = concepts.filter((c) => indeg.get(c.name) === 0);
  const out: ConceptInfo[] = [];
  const seen = new Set<string>();
  const weakFirst = (a: ConceptInfo, b: ConceptInfo) => a.mastery - b.mastery;
  ready.sort(weakFirst);
  while (ready.length) {
    const c = ready.shift()!;
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    out.push(c);
    for (const d of concepts)
      if (d.prerequisites.includes(c.name)) {
        indeg.set(d.name, indeg.get(d.name)! - 1);
        if (indeg.get(d.name) === 0) {
          ready.push(d);
          ready.sort(weakFirst);
        }
      }
  }
  // cycles: append the rest
  for (const c of concepts) if (!seen.has(c.name)) out.push(c);
  return out;
}

/**
 * Deterministic study plan (no LLM): learn weak concepts in prerequisite order,
 * practice them the day after, review with growing gaps (1/3/7 days), and leave
 * the last day before the exam for a full review of everything not yet strong.
 */
export function buildStudyPlan({ concepts, today, examDate, minutesPerDay, title }: PlanInput): StudyPlan {
  const totalDays = Math.max(1, Math.min(90, daysBetween(today, examDate)));
  const days: StudyPlan["days"] = Array.from({ length: totalDays }, (_, i) => ({ date: addDays(today, i), items: [] }));
  const load = new Array(totalDays).fill(0);

  const place = (fromDay: number, item: StudyPlan["days"][number]["items"][number]) => {
    for (let d = fromDay; d < totalDays; d++) {
      if (load[d] + item.minutes <= minutesPerDay || d === totalDays - 1) {
        days[d].items.push(item);
        load[d] += item.minutes;
        return d;
      }
    }
    return -1;
  };

  const lastStudyDay = totalDays > 1 ? totalDays - 2 : 0;
  const ordered = prerequisiteOrder(concepts);
  let cursor = 0;
  for (const c of ordered) {
    const m = c.mastery;
    if (m >= 0.8 && c.attempts >= 3) continue; // strong → only the final review
    const learnDay =
      m < 0.4
        ? place(Math.min(cursor, lastStudyDay), { concept: c.name, activity: "learn", minutes: 30, reason: c.attempts ? t("שליטה נמוכה", "Low mastery") : t("מושג חדש", "New concept") })
        : cursor;
    cursor = Math.max(cursor, learnDay >= 0 ? learnDay : cursor);
    const practiceDay = place(Math.min(cursor + (m < 0.4 ? 1 : 0), lastStudyDay), {
      concept: c.name,
      activity: "practice",
      minutes: 20,
      reason: m < 0.4 ? t("תרגול אחרי למידה", "Practice after learning") : t("חיזוק שליטה חלקית", "Strengthen partial mastery"),
    });
    for (const gap of [3, 7]) {
      const d = practiceDay + gap;
      if (practiceDay >= 0 && d <= lastStudyDay) place(d, { concept: c.name, activity: "review", minutes: 10, reason: t(`חזרה מרווחת (+${gap} ימים)`, `Spaced review (+${gap} days)`) });
    }
    if (load[cursor] >= minutesPerDay * 0.8) cursor = Math.min(cursor + 1, lastStudyDay);
  }

  // Final day: review everything that is not strong.
  const finalDay = totalDays - 1;
  for (const c of ordered.filter((c) => !(c.mastery >= 0.8 && c.attempts >= 3)).slice(0, 12))
    days[finalDay].items.push({ concept: c.name, activity: "review", minutes: 10, reason: t("חזרה לפני המבחן", "Review before the exam") });

  return {
    title: title ?? t(`תוכנית לימוד עד ${examDate}`, `Study plan until ${examDate}`),
    exam_date: examDate,
    days: days.filter((d) => d.items.length > 0),
  };
}
