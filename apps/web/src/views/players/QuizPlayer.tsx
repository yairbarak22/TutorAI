import { useState } from "react";
import { Thinking } from "../../ui/LongTask.tsx";
import { Dumbbell, Trophy } from "lucide-react";
import type { GradeResult, Quiz } from "@tutorai/sdk";
import { useEngine } from "../../engine.ts";
import { Button, Card, Spinner, errorMessage, inputClass } from "../../ui/components.tsx";
import { Markdown } from "../../ui/Markdown.tsx";
import { CitationChips } from "../../ui/Citations.tsx";
import { t } from "../../i18n.tsx";

type Answer = { choice?: number; text?: string; checked?: boolean; correct?: boolean; grade?: GradeResult; grading?: boolean; error?: string };

export function QuizPlayer({ quiz, courseId, artifactId }: { quiz: Quiz; courseId: number; artifactId: number }) {
  const engine = useEngine();
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const set = (id: string, a: Answer) => setAnswers((prev) => ({ ...prev, [id]: { ...prev[id], ...a } }));

  /** Wrong answers go to the mistakes notebook and come back later as new questions. */
  const logMistake = (q: Quiz["questions"][number], studentAnswer: string) =>
    engine.recordMistake({
      courseId,
      concept: q.concept,
      origin: "quiz",
      itemRef: `${artifactId}:${q.id}`,
      question: q.kind === "mcq" ? `${q.prompt}\n\n${q.options.map((o, i) => `${i + 1}. ${o}`).join("\n")}` : q.prompt,
      studentAnswer,
      correctAnswer: q.kind === "mcq" ? (q.options[q.correct_index] ?? q.model_answer) : q.model_answer,
      explanation: q.explanation,
      citations: q.citations,
    });

  const check = async (q: Quiz["questions"][number]) => {
    const a = answers[q.id] ?? {};
    if (q.kind === "mcq") {
      const correct = a.choice === q.correct_index;
      set(q.id, { checked: true, correct });
      engine.recordAttempt(courseId, q.concept, `${artifactId}:${q.id}`, correct, correct ? 1 : 0, "mcq", String(a.choice));
      if (!correct) logMistake(q, q.options[a.choice ?? -1] ?? "");
    } else {
      set(q.id, { grading: true, error: undefined });
      try {
        const grade = await engine.grade({ question: q.prompt, answer: a.text ?? "", modelAnswer: q.model_answer, rubric: [], maxPoints: 10, tier: "fast" });
        set(q.id, { checked: true, grading: false, correct: grade.correct, grade });
        engine.recordAttempt(courseId, q.concept, `${artifactId}:${q.id}`, grade.correct, grade.score / 10, "open", a.text, grade.feedback);
        if (!grade.correct) logMistake(q, a.text ?? "");
      } catch (e) {
        set(q.id, { grading: false, error: errorMessage(e) });
      }
    }
  };

  const done = quiz.questions.filter((q) => answers[q.id]?.checked);
  const score = done.filter((q) => answers[q.id]?.correct).length;

  return (
    <div className="space-y-4">
      {quiz.questions.map((q, i) => {
        const a = answers[q.id] ?? {};
        return (
          <Card key={q.id} className="space-y-3 p-5" data-testid="quiz-question">
            <div className="flex gap-2">
              <span className="font-semibold text-brand-600">{i + 1}.</span>
              <Markdown text={q.prompt} className="flex-1" />
            </div>
            {q.kind === "mcq" ? (
              <div className="space-y-2" role="radiogroup">
                {q.options.map((o, j) => {
                  const state = a.checked ? (j === q.correct_index ? "border-emerald-500 bg-emerald-50" : j === a.choice ? "border-red-400 bg-red-50" : "border-slate-200") : a.choice === j ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:bg-slate-50";
                  return (
                    <button
                      key={j}
                      role="radio"
                      aria-checked={a.choice === j}
                      disabled={a.checked}
                      onClick={() => set(q.id, { choice: j })}
                      className={`block w-full rounded-lg border p-3 text-start ${state}`}
                    >
                      <Markdown text={o} />
                    </button>
                  );
                })}
              </div>
            ) : (
              <textarea className={inputClass} rows={4} disabled={a.checked} placeholder={t("כתבו את תשובתכם…", "Write your answer…")} value={a.text ?? ""} onChange={(e) => set(q.id, { text: e.target.value })} />
            )}
            {!a.checked && (
              <Button size="sm" disabled={a.grading || (q.kind === "mcq" ? a.choice === undefined : !a.text?.trim())} onClick={() => check(q)}>
                {a.grading ? <Thinking label={q.kind === "mcq" ? t("בודק", "Checking") : t("בודק את התשובה מול התשובה לדוגמה", "Checking your answer against the model answer")} /> : t("בדיקה", "Check")}
              </Button>
            )}
            {a.error && <p className="text-sm text-red-700">{a.error}</p>}
            {a.checked && (
              <div className={`rounded-lg p-3 text-sm ${a.correct ? "bg-emerald-50" : "bg-amber-50"}`}>
                <div className="mb-1 font-semibold">{a.correct ? t("נכון!", "Correct!") : q.kind === "mcq" ? t("לא מדויק", "Not quite") : t("משוב", "Feedback")}</div>
                {a.grade && <Markdown text={t(`**ציון: ${a.grade.score}/10** — ${a.grade.feedback}`, `**Score: ${a.grade.score}/10** — ${a.grade.feedback}`)} />}
                <Markdown text={q.explanation} />
                {q.kind === "open" && <Markdown text={t(`**תשובה לדוגמה:** ${q.model_answer}`, `**Model answer:** ${q.model_answer}`)} />}
                <CitationChips ids={q.citations} />
              </div>
            )}
          </Card>
        );
      })}
      {done.length === quiz.questions.length && (
        <Card className="p-5 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl tile-grad-3 text-ink/80">{score / quiz.questions.length >= 0.7 ? <Trophy size={22} /> : <Dumbbell size={22} />}</div>
          <div className="text-xl font-semibold">
            {t(`${score} מתוך ${quiz.questions.length}`, `${score} out of ${quiz.questions.length}`)}
          </div>
          <p className="text-slate-600">{t("התוצאות עודכנו במעקב השליטה שלכם.", "Your results were added to your mastery tracking.")}</p>
        </Card>
      )}
    </div>
  );
}
