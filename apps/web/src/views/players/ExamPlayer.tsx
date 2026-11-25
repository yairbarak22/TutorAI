import { useEffect, useState } from "react";
import type { ExamSimulation, GradeResult } from "@ruecai/sdk";
import { useEngine } from "../../engine.ts";
import { Alert, Button, Card, ProgressBar, Spinner, inputClass } from "../../ui/components.tsx";
import { Markdown } from "../../ui/Markdown.tsx";
import { CitationChips } from "../../ui/Citations.tsx";

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
  const [grading, setGrading] = useState(0);
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
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [started, grades]);

  const total = exam.questions.reduce((n, q) => n + q.points, 0);
  const left = started ? Math.max(0, exam.duration_minutes * 60 - Math.floor((now - started) / 1000)) : exam.duration_minutes * 60;
  const fmt = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const submit = async () => {
    if (!confirm("להגיש את המבחן לבדיקה?")) return;
    setError(null);
    const out: Record<string, GradeResult> = {};
    setGrading(0.01);
    try {
      for (const [i, q] of exam.questions.entries()) {
        const g = await engine.grade({ question: q.prompt, answer: answers[q.id] ?? "", modelAnswer: q.model_answer, rubric: q.rubric, maxPoints: q.points, tier: "smart" });
        out[q.id] = g;
        const ratio = g.score / q.points;
        for (const c of q.concepts) engine.recordAttempt(courseId, c, `${artifactId}:${q.id}`, ratio >= 0.7, ratio, "exam", answers[q.id], g.feedback);
        setGrading((i + 1) / exam.questions.length);
      }
      setGrades(out);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGrading(0);
    }
  };

  const score = grades ? exam.questions.reduce((n, q) => n + (grades[q.id]?.score ?? 0), 0) : 0;

  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-5">
        <Markdown text={exam.instructions} />
        {exam.style_notes && <p className="text-sm text-slate-500">💡 {exam.style_notes}</p>}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <span className="text-sm text-slate-600">
            {exam.questions.length} שאלות · {total} נק' · {exam.duration_minutes} דק'
          </span>
          {!started && !grades && <Button onClick={() => setStarted(Date.now())}>▶️ התחלת המבחן (טיימר)</Button>}
          {started && !grades && (
            <span className={`ms-auto font-mono text-lg font-bold ${left < 600 ? "text-red-600" : "text-brand-700"}`} aria-live="polite">
              ⏱️ {fmt(left)}
            </span>
          )}
        </div>
      </Card>

      {grades && (
        <Card className="p-5 text-center">
          <div className="text-sm text-slate-500">ציון</div>
          <div className="text-4xl font-bold text-brand-700">
            {Math.round((score / total) * 100)}
            <span className="text-lg text-slate-500"> / 100</span>
          </div>
          <p className="text-slate-600">משוב מפורט לפי המחוון מופיע מתחת לכל שאלה. התוצאות עודכנו במעקב השליטה.</p>
        </Card>
      )}

      {exam.questions.map((q, i) => {
        const g = grades?.[q.id];
        return (
          <Card key={q.id} className="space-y-3 p-5" data-testid="exam-question">
            <div className="flex items-baseline gap-2">
              <span className="font-bold">שאלה {i + 1}</span>
              <span className="text-sm text-slate-500">({q.points} נק')</span>
            </div>
            <Markdown text={q.prompt} />
            <textarea
              className={inputClass}
              rows={8}
              disabled={!!grades}
              placeholder="כתבו את תשובתכם כאן…"
              value={answers[q.id] ?? ""}
              onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
            />
            {g && (
              <div className="space-y-2 rounded-lg bg-slate-50 p-4 text-sm">
                <div className="font-bold">
                  {g.score} / {q.points} נק'
                </div>
                <ul className="space-y-1">
                  {g.criteria.map((c, j) => (
                    <li key={j}>
                      <b>{c.criterion}</b>: {c.awarded} נק' — {c.comment}
                    </li>
                  ))}
                </ul>
                <Markdown text={g.feedback} />
                <details>
                  <summary className="cursor-pointer font-medium text-brand-700">תשובה לדוגמה ומחוון</summary>
                  <Markdown text={q.model_answer} />
                  <ul className="mt-2 list-disc ps-5">
                    {q.rubric.map((r, j) => (
                      <li key={j}>
                        {r.criterion} ({r.points} נק')
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
        (grading > 0 ? (
          <Card className="space-y-2 p-4">
            <Spinner label="בודק לפי המחוון…" />
            <ProgressBar value={grading} />
          </Card>
        ) : (
          <Button size="lg" className="w-full" onClick={submit}>
            הגשה לבדיקה
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
          לנסות שוב
        </Button>
      )}
    </div>
  );
}
