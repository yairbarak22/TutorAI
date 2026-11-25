import { useEffect, useState } from "react";
import { Lightbulb, Timer } from "lucide-react";
import type { ExamSimulation, GradeResult } from "@ruecai/sdk";
import { useEngine } from "../../engine.ts";
import { Alert, Button, Card, inputClass } from "../../ui/components.tsx";
import { LongTask } from "../../ui/LongTask.tsx";
import { expectedSeconds, recordRun } from "../../platform/timing.ts";
import { Markdown } from "../../ui/Markdown.tsx";
import { CitationChips } from "../../ui/Citations.tsx";
import { t } from "../../i18n.tsx";

/** Exam mode: timer, answers saved as you type, grading by rubric after submit. */
export function ExamPlayer({ exam, courseId, artifactId }: { exam: ExamSimulation; courseId: number; artifactId: number }) {
  const engine = useEngine();
  const storeKey = `ruecai.exam.${artifactId}`;
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(storeKey) ?? "{}");
    } catch {
      return {};
    }
  });
  const [started, setStarted] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [grades, setGrades] = useState<Record<string, GradeResult> | null>(null);
  const [grading, setGrading] = useState<{ done: number; startedAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(answers));
    } catch {
      /* ignore */
    }
  }, [answers, storeKey]);
  useEffect(() => {
    if (!started || grades) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [started, grades]);

  const total = exam.questions.reduce((n, q) => n + q.points, 0);
  const left = started ? Math.max(0, exam.duration_minutes * 60 - Math.floor((now - started) / 1000)) : exam.duration_minutes * 60;
  const fmt = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const submit = async () => {
    if (!confirm(t("להגיש את המבחן לבדיקה?", "Submit the exam for grading?"))) return;
    setError(null);
    const out: Record<string, GradeResult> = {};
    setGrading({ done: 0, startedAt: Date.now() });
    try {
      for (const [i, q] of exam.questions.entries()) {
        const t0 = Date.now();
        const g = await engine.grade({ question: q.prompt, answer: answers[q.id] ?? "", modelAnswer: q.model_answer, rubric: q.rubric, maxPoints: q.points, tier: "smart" });
        out[q.id] = g;
        const ratio = g.score / q.points;
        for (const c of q.concepts) engine.recordAttempt(courseId, c, `${artifactId}:${q.id}`, ratio >= 0.7, ratio, "exam", answers[q.id], g.feedback);
        recordRun("grade", (Date.now() - t0) / 1000, undefined, engine.demo);
        setGrading((gr) => (gr ? { ...gr, done: i + 1 } : gr));
      }
      setGrades(out);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGrading(null);
    }
  };

  const score = grades ? exam.questions.reduce((n, q) => n + (grades[q.id]?.score ?? 0), 0) : 0;

  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-5">
        <Markdown text={exam.instructions} />
        {exam.style_notes && <p className="flex items-start gap-1.5 text-sm text-slate-500"><Lightbulb size={15} className="mt-0.5 shrink-0" /> {exam.style_notes}</p>}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <span className="text-sm text-slate-600">
            {t(
              `${exam.questions.length} שאלות · ${total} נק' · ${exam.duration_minutes} דק'`,
              `${exam.questions.length} ${exam.questions.length === 1 ? "question" : "questions"} · ${total} pts · ${exam.duration_minutes} min`,
            )}
          </span>
          {!started && !grades && <Button onClick={() => setStarted(Date.now())}><Timer size={15} /> {t("התחלת המבחן (טיימר)", "Start the exam (timer)")}</Button>}
          {started && !grades && (
            <span className={`ms-auto font-mono text-lg font-semibold ${left < 600 ? "text-red-600" : "text-brand-700"}`} aria-live="polite">
              <Timer size={14} className="inline" /> {fmt(left)}
            </span>
          )}
        </div>
      </Card>

      {grades && (
        <Card className="p-5 text-center">
          <div className="text-sm text-slate-500">{t("ציון", "Score")}</div>
          <div className="text-4xl font-semibold text-brand-700">
            {Math.round((score / total) * 100)}
            <span className="text-lg text-slate-500"> / 100</span>
          </div>
          <p className="text-slate-600">
            {t("משוב מפורט לפי המחוון מופיע מתחת לכל שאלה. התוצאות עודכנו במעקב השליטה.", "Detailed rubric feedback appears under each question. Results were added to your mastery tracking.")}
          </p>
        </Card>
      )}

      {exam.questions.map((q, i) => {
        const g = grades?.[q.id];
        return (
          <Card key={q.id} className="space-y-3 p-5" data-testid="exam-question">
            <div className="flex items-baseline gap-2">
              <span className="font-semibold">{t(`שאלה ${i + 1}`, `Question ${i + 1}`)}</span>
              <span className="text-sm text-slate-500">({t(`${q.points} נק'`, `${q.points} pts`)})</span>
            </div>
            <Markdown text={q.prompt} />
            <textarea
              className={inputClass}
              rows={8}
              disabled={!!grades}
              placeholder={t("כתבו את תשובתכם כאן…", "Write your answer here…")}
              value={answers[q.id] ?? ""}
              onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
            />
            {g && (
              <div className="space-y-2 rounded-lg bg-slate-50 p-4 text-sm">
                <div className="font-semibold">
                  {g.score} / {t(`${q.points} נק'`, `${q.points} pts`)}
                </div>
                <ul className="space-y-1">
                  {g.criteria.map((c, j) => (
                    <li key={j}>
                      <b>{c.criterion}</b>: {t(`${c.awarded} נק'`, `${c.awarded} pts`)} — {c.comment}
                    </li>
                  ))}
                </ul>
                <Markdown text={g.feedback} />
                <details>
                  <summary className="cursor-pointer font-medium text-brand-700">{t("תשובה לדוגמה ומחוון", "Model answer and rubric")}</summary>
                  <Markdown text={q.model_answer} />
                  <ul className="mt-2 list-disc ps-5">
                    {q.rubric.map((r, j) => (
                      <li key={j}>
                        {r.criterion} ({t(`${r.points} נק'`, `${r.points} pts`)})
                      </li>
                    ))}
                  </ul>
                </details>
                <CitationChips ids={q.citations} />
              </div>
            )}
          </Card>
        );
      })}

      {error && <Alert kind="error">{error}</Alert>}
      {!grades &&
        (grading ? (
          <LongTask
            title={t("בודק את המבחן לפי המחוון", "Grading the exam against the rubric")}
            stages={exam.questions.length <= 8 ? exam.questions.map((_, i) => t(`שאלה ${i + 1}`, `Question ${i + 1}`)) : [t("בודק תשובות", "Checking answers"), t("מסכם ציון", "Totaling the score")]}
            stage={exam.questions.length <= 8 ? grading.done : grading.done < exam.questions.length ? 0 : 1}
            detail={t(
              `בודק את שאלה ${Math.min(grading.done + 1, exam.questions.length)} מתוך ${exam.questions.length}: משווה לתשובה לדוגמה ולכל סעיף במחוון`,
              `Grading question ${Math.min(grading.done + 1, exam.questions.length)} of ${exam.questions.length}: comparing to the model answer and each rubric item`,
            )}
            startedAt={grading.startedAt}
            expectedSec={exam.questions.length * expectedSeconds("grade", engine.demo)}
            progress={grading.done / exam.questions.length}
            hint={t("כל שאלה נבדקת בנפרד, עם ניקוד לכל סעיף במחוון ומשוב אישי.", "Each question is graded separately, with points for each rubric item and personal feedback.")}
          />
        ) : (
          <Button size="lg" className="w-full" onClick={submit}>
            {t("הגשה לבדיקה", "Submit for grading")}
          </Button>
        ))}
      {grades && (
        <Button
          variant="secondary"
          onClick={() => {
            setGrades(null);
            setAnswers({});
            setStarted(null);
          }}
        >
          {t("לנסות שוב", "Try again")}
        </Button>
      )}
    </div>
  );
}
