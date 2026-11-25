import { t } from "@ruecai/sdk";
import { createEmptyCard, fsrs, Rating, type Card as FsrsCard, type Grade } from "ts-fsrs";

/** Spaced repetition with FSRS (the algorithm modern Anki uses). */
const scheduler = fsrs({ enable_fuzz: false });

export type ReviewGrade = "again" | "hard" | "good" | "easy";
const RATING: Record<ReviewGrade, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

export function newCardState(now: Date): { fsrs: string; due: string } {
  const card = createEmptyCard(now);
  return { fsrs: JSON.stringify(card), due: card.due.toISOString() };
}

function revive(json: string): FsrsCard {
  const c = JSON.parse(json);
  return { ...c, due: new Date(c.due), last_review: c.last_review ? new Date(c.last_review) : undefined };
}

export function reviewCard(fsrsJson: string, grade: ReviewGrade, now: Date): { fsrs: string; due: string; intervalDays: number } {
  const result = scheduler.repeat(revive(fsrsJson), now)[RATING[grade]];
  const due = result.card.due;
  return {
    fsrs: JSON.stringify(result.card),
    due: due.toISOString(),
    intervalDays: Math.max(0, Math.round((due.getTime() - now.getTime()) / 86_400_000)),
  };
}

/** Preview of the next interval for each button ("10 min", "3 d"…), in the UI language. */
export function previewIntervals(fsrsJson: string, now: Date): Record<ReviewGrade, string> {
  const all = scheduler.repeat(revive(fsrsJson), now);
  const fmt = (d: Date) => {
    const mins = Math.round((d.getTime() - now.getTime()) / 60_000);
    if (mins < 60) return t(`${Math.max(1, mins)} דק'`, `${Math.max(1, mins)} min`);
    if (mins < 60 * 24) return t(`${Math.round(mins / 60)} שע'`, `${Math.round(mins / 60)} h`);
    return t(Math.round(mins / 1440) === 1 ? "יום" : `${Math.round(mins / 1440)} ימים`, `${Math.round(mins / 1440)} d`);
  };
  return {
    again: fmt(all[Rating.Again].card.due),
    hard: fmt(all[Rating.Hard].card.due),
    good: fmt(all[Rating.Good].card.due),
    easy: fmt(all[Rating.Easy].card.due),
  };
}
