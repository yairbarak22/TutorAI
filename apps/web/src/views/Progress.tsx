import { useState } from "react";
import { CalendarDays, ChartLine } from "lucide-react";
import { conceptInfos, masteryLevel, MASTERY_LABEL } from "@ruecai/core";
import type { StudyPlan } from "@ruecai/sdk";
import { useEngine } from "../engine.ts";
import { go, href } from "../router.ts";
import { Alert, Button, Card, Empty, Panel, ProgressBar, Spinner, errorMessage } from "../ui/components.tsx";
import { daysUntil } from "./Home.tsx";

export function ProgressView({ courseId }: { courseId: number }) {
  const engine = useEngine();
  const course = engine.store.course(courseId)!;
  const concepts = conceptInfos(engine.store, courseId).sort((a, b) => a.mastery - b.mastery);
  const attempts = engine.store.attempts(courseId);
  const plan = engine.store.artifacts(courseId).find((a) => a.type === "study_plan");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const todayPlan = plan ? (plan.data as StudyPlan).days.find((d) => d.date === today) : undefined;
  const d = daysUntil(course.exam_date);

  if (concepts.length === 0) return <Empty icon={<ChartLine size={26} strokeWidth={1.6} />} title="עוד אין נתונים">העלו חומר ותרגלו כדי לראות התקדמות.</Empty>;

  const avg = concepts.reduce((n, c) => n + c.mastery, 0) / concepts.length;
  const makePlan = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await engine.run("study-plan", courseId, { exam_date: course.exam_date ?? "", minutes_per_day: course.minutes_per_day });
      if (r.kind === "artifact") go(href.course(courseId, "artifacts", r.artifactId));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Panel className="p-4">
          <div className="text-sm text-slate-500">שליטה ממוצעת</div>
          <div className="mt-1 text-[28px] font-semibold tracking-tight text-ink">{Math.round(avg * 100)}%</div>
        </Panel>
        <Panel className="p-4">
          <div className="text-sm text-slate-500">תשובות שנבדקו</div>
          <div className="mt-1 text-[28px] font-semibold tracking-tight text-ink">{attempts.length}</div>
        </Panel>
        <Panel className="p-4">
          <div className="text-sm text-slate-500">ימים למבחן</div>
          <div className="mt-1 text-[28px] font-semibold tracking-tight text-ink">{d ?? "—"}</div>
        </Panel>
      </div>

      <Panel className="space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-2 font-semibold"><CalendarDays size={16} /> היום בתוכנית</h2>
          <Button size="sm" className="ms-auto" onClick={makePlan} disabled={busy}>
            {busy ? <Spinner label="בונה…" /> : plan ? "עדכון התוכנית לפי המצב הנוכחי" : "יצירת תוכנית לימוד"}
          </Button>
        </div>
        {!course.exam_date && <Alert kind="info">הגדירו תאריך מבחן (כפתור "עריכה" למעלה) כדי לבנות תוכנית.</Alert>}
        {error && <Alert kind="error">{error}</Alert>}
        {todayPlan ? (
          <ul className="space-y-1 text-sm">
            {todayPlan.items.map((it, i) => (
              <li key={i}>
                • {it.activity === "learn" ? "ללמוד" : it.activity === "practice" ? "לתרגל" : "לחזור על"}{" "}
                <a className="font-medium text-brand-700 hover:underline" href={href.course(courseId, "studio", `${it.activity === "learn" ? "explainer" : "quiz"}?concept=${encodeURIComponent(it.concept)}`)}>
                  {it.concept}
                </a>{" "}
                <span className="text-slate-400">({it.minutes} דק')</span>
              </li>
            ))}
          </ul>
        ) : (
          plan && (
            <p className="text-sm text-slate-500">
              אין משימות להיום. <a className="underline" href={href.course(courseId, "artifacts", plan.id)}>לתוכנית המלאה</a>
            </p>
          )
        )}
      </Panel>

      <Card className="p-5">
        <h2 className="mb-3 font-semibold">שליטה לפי מושג</h2>
        <div className="space-y-3">
          {concepts.map((c) => {
            const level = masteryLevel(c.mastery, c.attempts);
            const color = level === "strong" ? "bg-emerald-500" : level === "progress" ? "bg-amber-400" : level === "weak" ? "bg-red-400" : "bg-slate-300";
            return (
              <div key={c.name} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3" data-testid="mastery-row">
                <a className="truncate text-sm font-medium hover:underline" href={href.course(courseId, "studio", `quiz?concept=${encodeURIComponent(c.name)}`)}>
                  {c.name}
                </a>
                <ProgressBar value={c.attempts ? c.mastery : 0.02} color={color} />
                <span className="w-24 text-xs text-slate-500">
                  {MASTERY_LABEL[level]} {c.attempts > 0 && `· ${c.attempts}`}
                </span>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
