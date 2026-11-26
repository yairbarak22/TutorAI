import { z } from "zod";
import { Quiz, getLanguage, languageName, t, type LLMApi } from "@ruecai/sdk";
import type { Card, Mistake, Store } from "../db/store.ts";
import { baseSystemPrompt } from "../llm/prompts.ts";
import { retrieve } from "../retrieve.ts";
import { conceptInfos } from "../runtime.ts";

/**
 * The daily session: one button that mixes what the research says works best —
 * retrieval of due flashcards, a second shot at past mistakes (as new questions on the same
 * misconception), questions on the weakest concepts, and one older concept mixed in (interleaving).
 */
export type QuizQuestion = Quiz["questions"][number];

export type SessionItem =
  | { kind: "card"; card: Card }
  | { kind: "question"; reason: "retry" | "weak" | "mixed"; mistakeId?: number; q: QuizQuestion };

export interface SessionPlan {
  items: SessionItem[];
  minutes: number;
  counts: { retry: number; cards: number; weak: number; mixed: number };
}

/** What the session will contain, without calling the model (for the start screen). */
export interface SessionPreview {
  mistakes: Mistake[];
  cards: Card[];
  weak: string[];
  mixed: string[];
  minutes: number;
}

const MIN_PER = { card: 0.5, mcq: 1.2, open: 2.5 };

export function previewSession(store: Store, courseId: number, now: Date, budgetMinutes = 20): SessionPreview {
  const nowIso = now.toISOString();
  const mistakes = store.dueMistakes(courseId, nowIso).slice(0, 4);
  const concepts = conceptInfos(store, courseId);
  const lastSeen = new Map<string, string>();
  for (const a of store.attempts(courseId)) lastSeen.set(a.concept, a.created_at);

  // Weakest practiced concepts first, then untried ones whose prerequisites are not weak.
  const practicedWeak = concepts.filter((c) => c.attempts > 0 && c.mastery < 0.6).sort((a, b) => a.mastery - b.mastery);
  const weakNames = new Set(practicedWeak.map((c) => c.name));
  const fresh = concepts.filter((c) => c.attempts === 0 && c.prerequisites.every((p) => !weakNames.has(p)));
  const retryConcepts = new Set(mistakes.map((m) => m.concept));
  const weak = [...practicedWeak, ...fresh]
    .map((c) => c.name)
    .filter((n) => !retryConcepts.has(n))
    .slice(0, 3);

  // Interleaving: one solid concept that hasn't been practiced for the longest time.
  const solid = concepts
    .filter((c) => c.attempts > 0 && c.mastery >= 0.6 && !weak.includes(c.name))
    .sort((a, b) => (lastSeen.get(a.name) ?? "").localeCompare(lastSeen.get(b.name) ?? ""));
  const mixed = solid.slice(0, 1).map((c) => c.name);

  const questionMinutes = (mistakes.length + weak.length * 2 + mixed.length) * MIN_PER.mcq;
  const cardBudget = Math.max(4, Math.floor((budgetMinutes - questionMinutes) / MIN_PER.card));
  const cards = store.dueCards(courseId, nowIso).slice(0, Math.min(12, cardBudget));
  const minutes = Math.max(3, Math.round(questionMinutes + cards.length * MIN_PER.card));
  return { mistakes, cards, weak, mixed, minutes };
}

/** Structured output for the session questions, one per requested slot, in order. */
const SessionQuestions = z.object({
  questions: z.array(
    Quiz.shape.questions.element.extend({
      slot: z.number().int().describe("The slot number this question answers (1-based, as listed in the request)."),
    }),
  ),
});

type Slot = { reason: "retry" | "weak" | "mixed"; concept: string; mistake?: Mistake };

export async function buildSession(
  deps: { store: Store; llm: LLMApi; courseId: number; now?: Date; budgetMinutes?: number; onOutput?: (chars: number) => void },
): Promise<SessionPlan> {
  const now = deps.now ?? new Date();
  const p = previewSession(deps.store, deps.courseId, now, deps.budgetMinutes);
  const slots: Slot[] = [
    ...p.mistakes.map((m) => ({ reason: "retry" as const, concept: m.concept, mistake: m })),
    ...p.weak.flatMap((c) => [
      { reason: "weak" as const, concept: c },
      { reason: "weak" as const, concept: c },
    ]),
    ...p.mixed.map((c) => ({ reason: "mixed" as const, concept: c })),
  ];

  const questions: SessionItem[] = [];
  if (slots.length) {
    const course = deps.store.course(deps.courseId);
    const query = [...new Set(slots.map((s) => s.concept).filter(Boolean))].join(" ");
    const material = retrieve(deps.store, deps.courseId, { mode: "search", query, budgetChars: 60_000 });
    const seen = new Set(material.sections.map((s) => s.id));
    const request = slots
      .map((s, i) => {
        if (s.reason === "retry" && s.mistake) {
          const m = s.mistake;
          return `Slot ${i + 1} (second chance on a past mistake): write a NEW question, different from the original, that tests exactly the same misconception.
  Original question: ${m.question}
  Student's wrong answer: ${m.student_answer || "(empty)"}
  Correct answer: ${m.correct_answer}
  ${m.misconception ? `Diagnosed misconception: ${m.misconception}` : ""}`;
        }
        return `Slot ${i + 1} (${s.reason === "weak" ? "the student is weak in this concept" : "an older concept, mixed in for interleaving"}): a question on "${s.concept}".`;
      })
      .join("\n\n");

    let generated: z.infer<typeof SessionQuestions>["questions"] = [];
    try {
      const out = await deps.llm.object(SessionQuestions, {
        system: baseSystemPrompt(getLanguage()),
        context: material.text,
        tier: "smart",
        tag: "session",
        maxTokens: 12_000,
        onOutput: deps.onOutput,
        prompt: [
          `Write practice questions for today's study session in the course "${course?.name ?? ""}", one question per slot below, in slot order.`,
          request,
          "Rules: about two thirds multiple-choice (kind=mcq, exactly 4 options, correct_index 0–3, plausible distractors based on common mistakes) and the rest short open questions (kind=open, options=[], correct_index=-1). Questions test understanding and application with new numbers and examples, not memorization. explanation: why the answer is right and the others wrong. model_answer: short and complete. citations: section IDs from the context. id: s1, s2, ...",
          `Write everything in ${languageName()}.`,
        ].join("\n\n"),
      });
      generated = out.questions;
    } catch (e) {
      // Retries still work without the model: fall back to re-asking the original question.
      if (!p.mistakes.length) throw e;
    }

    slots.forEach((s, i) => {
      const g = generated.find((q) => q.slot === i + 1) ?? generated[i];
      if (g) {
        const { slot: _slot, ...q } = g;
        q.id = `s${i + 1}`;
        q.concept = s.concept || q.concept;
        q.citations = q.citations.filter((c) => seen.has(c));
        questions.push({ kind: "question", reason: s.reason, mistakeId: s.mistake?.id, q });
      } else if (s.mistake) {
        const m = s.mistake;
        questions.push({
          kind: "question",
          reason: "retry",
          mistakeId: m.id,
          q: {
            id: `s${i + 1}`,
            kind: "open",
            prompt: m.question,
            options: [],
            correct_index: -1,
            model_answer: m.correct_answer,
            explanation: m.explanation,
            concept: m.concept,
            citations: m.citations,
          },
        });
      }
    });
  }

  // Interleave: a question, then a card, … starting with a past mistake while attention is fresh.
  const cards: SessionItem[] = p.cards.map((card) => ({ kind: "card", card }));
  const items: SessionItem[] = [];
  while (questions.length || cards.length) {
    if (questions.length) items.push(questions.shift()!);
    if (cards.length) items.push(cards.shift()!);
    if (cards.length && items.length % 3 === 0) items.push(cards.shift()!);
  }
  return {
    items,
    minutes: p.minutes,
    counts: { retry: p.mistakes.length, cards: p.cards.length, weak: p.weak.length, mixed: p.mixed.length },
  };
}

/** Consecutive days (ending today or yesterday) with a finished session. */
export function streakDays(days: string[], today: string): number {
  const set = new Set(days);
  const d = new Date(today + "T12:00:00");
  if (!set.has(today)) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(d.toISOString().slice(0, 10))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export const localDay = (d = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

export const sessionReasonLabel = (r: "retry" | "weak" | "mixed") =>
  r === "retry" ? t("תיקון טעות", "Fixing a mistake") : r === "weak" ? t("מושג לחיזוק", "Weak concept") : t("חזרה משולבת", "Mixed review");
