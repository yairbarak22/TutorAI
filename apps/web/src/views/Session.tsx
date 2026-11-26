import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleCheck, Flame, Layers, NotebookPen, RotateCcw, Target, X, Zap } from "lucide-react";
import { previewIntervals, sessionReasonLabel, type ReviewGrade, type SessionItem, type SessionPlan } from "@ruecai/core";
import type { GradeResult } from "@ruecai/sdk";
import { useEngine } from "../engine.ts";
import { go, href } from "../router.ts";
import { Alert, Badge, Button, Card, Empty, Panel, errorMessage, inputClass } from "../ui/components.tsx";
import { Markdown } from "../ui/Markdown.tsx";
import { CitationChips } from "../ui/Citations.tsx";
import { LongTask, Thinking } from "../ui/LongTask.tsx";
import { expectedChars, expectedSeconds, recordRun } from "../platform/timing.ts";
import { clock } from "../platform/timing.ts";
import { fmtNumber, t } from "../i18n.tsx";

type Result = { correct: boolean; reason: "card" | "retry" | "weak" | "mixed"; resolved?: boolean; logged?: boolean };

/**
 * The daily session: a short, mixed practice run — past mistakes as new questions, due flashcards,
 * weak concepts and one older concept — one item at a time.
 */
export function DailySession({ courseId }: { courseId: number }) {
  const engine = useEngine();
  const [phase, setPhase] = useState<"start" | "building" | "running" | "done">("start");
  const [plan, setPlan] = useState<SessionPlan | null>(null);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState<{ startedAt: number; chars: number } | null>(null);
  const startedAt = useRef(0);
  const preview = useMemo(() => engine.sessionPreview(courseId), [engine, courseId, phase]);

  const start = async () => {
    setError(null);
    const t0 = Date.now();
    let chars = 0;
    const needsModel = preview.mistakes.length + preview.weak.length + preview.mixed.length > 0;
    setBuilding({ startedAt: t0, chars: 0 });
    setPhase(needsModel ? "building" : "running");
    try {
      const p = await engine.buildSession(courseId, (n) => {
        chars = n;
        setBuilding((b) => (b ? { ...b, chars: n } : b));
      });
      if (needsModel) recordRun("session", (Date.now() - t0) / 1000, chars, engine.demo);
      if (!p.items.length) {
        setPhase("start");
        return;
      }
      setPlan(p);
      setIndex(0);
      setResults([]);
      startedAt.current = Date.now();
      setPhase("running");
    } catch (e) {
      setError(errorMessage(e));
      setPhase("start");
    } finally {
      setBuilding(null);
    }
  };

  const next = (r: Result) => {
    const all = [...results, r];
    setResults(all);
    if (plan && index + 1 >= plan.items.length) {
      engine.finishSession(courseId, all.length, all.filter((x) => x.correct).length, (Date.now() - startedAt.current) / 1000);
      setPhase("done");
    } else setIndex(index + 1);
  };

  if (phase === "building" && building)
    return (
      <div className="mx-auto max-w-2xl">
        <LongTask
          title={t("מכין את הסשן של היום", "Preparing today's session")}
          stages={[t("בוחר מה לתרגל", "Choosing what to practice"), t("Claude כותב שאלות חדשות", "Claude is writing new questions"), t("מוכן", "Ready")]}
          stage={building.chars > 0 ? 1 : 0}
          startedAt={building.startedAt}
          expectedSec={expectedSeconds("session", engine.demo)}
          chars={building.chars}
          expectedChars={expectedChars("session")}
          hint={t(
            "כל טעות מהעבר חוזרת כשאלה חדשה על אותה נקודה, כדי לבדוק שבאמת הבנתם ולא רק זכרתם את התשובה.",
            "Each past mistake comes back as a new question on the same point, to check that you understood it rather than remembered the answer.",
          )}
        />
      </div>
    );

  if (phase === "running" && plan) {
    const item = plan.items[index];
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <SessionHeader index={index} total={plan.items.length} item={item} onExit={() => setPhase("done")} />
        {item.kind === "card" ? (
          <CardStep key={`c${index}`} item={item} courseId={courseId} onDone={next} />
        ) : (
          <QuestionStep key={`q${index}`} item={item} courseId={courseId} onDone={next} />
        )}
      </div>
    );
  }

  if (phase === "done") return <SessionDone courseId={courseId} results={results} seconds={(Date.now() - startedAt.current) / 1000} onAgain={() => setPhase("start")} />;

  // Start screen
  const total = preview.mistakes.length + preview.cards.length + preview.weak.length * 2 + preview.mixed.length;
  const streak = engine.streak(courseId);
  const hasMaterial = engine.store.sources(courseId).some((s) => s.status === "ready");
  if (!total)
    return (
      <Empty icon={<CircleCheck size={26} strokeWidth={1.6} />} title={t("אין כרגע מה לתרגל", "Nothing to practice right now")}>
        {hasMaterial
          ? t("כל הכרטיסיות והטעויות מתוזמנות לימים הבאים. כדאי לנסות חידון חדש.", "All cards and mistakes are scheduled for later days. Try a new quiz.")
          : t("העלו חומר לקורס כדי שאפשר יהיה לבנות סשן יומי.", "Upload course material so a daily session can be built.")}
        <div className="mt-3">
          <a className="underline" href={href.course(courseId, hasMaterial ? "studio" : "materials", hasMaterial ? "quiz" : undefined)}>
            {hasMaterial ? t("לחידון חדש", "New quiz") : t("להעלאת חומר", "Upload material")}
          </a>
        </div>
      </Empty>
    );

  return (
    <div className="mx-auto max-w-2xl space-y-6" data-testid="session-start">
      <div className="text-center">
        <span className="tile-grad-5 mx-auto grid h-14 w-14 place-items-center rounded-2xl text-ink/80">
          <Zap size={26} strokeWidth={1.8} />
        </span>
        <h2 className="mt-4 text-[24px] font-semibold tracking-tight">{t("הסשן של היום", "Today's session")}</h2>
        <p className="mt-1 text-[14px] text-muted">
          {t(`${total} פריטים · כ-${preview.minutes} דקות`, `${total} items · about ${preview.minutes} minutes`)}
          {streak > 0 && (
            <span className="ms-2 inline-flex items-center gap-1 font-medium text-amber-700">
              <Flame size={14} /> {t(`${streak} ימים ברצף`, `${streak}-day streak`)}
            </span>
          )}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={<RotateCcw size={17} />} grad={8} n={preview.mistakes.length} label={t("טעויות לתיקון", "Mistakes to fix")} />
        <Stat icon={<Layers size={17} />} grad={2} n={preview.cards.length} label={t("כרטיסיות לחזרה", "Cards to review")} />
        <Stat icon={<Target size={17} />} grad={3} n={preview.weak.length + preview.mixed.length} label={t("מושגים לחיזוק", "Concepts to strengthen")} />
      </div>

      {(preview.weak.length > 0 || preview.mixed.length > 0) && (
        <Panel className="px-4 py-3 text-[13px] text-ink-2">
          <span className="font-medium">{t("מושגים בסשן: ", "Concepts in this session: ")}</span>
          {[...preview.weak, ...preview.mixed].join(" · ")}
        </Panel>
      )}

      {error && <Alert kind="error">{error}</Alert>}
      <Button size="lg" className="w-full" onClick={start}>
        <Zap size={16} /> {t("התחלת הסשן", "Start session")}
      </Button>
      <p className="text-center text-[12.5px] text-muted">
        {t(
          "שילוב של שליפה מהזיכרון, חזרה מרווחת ותרגול מעורב, שלוש השיטות עם הראיות החזקות ביותר ללמידה.",
          "A mix of retrieval, spaced repetition and interleaved practice, the three techniques with the strongest evidence for learning.",
        )}
      </p>
    </div>
  );
}

function Stat({ icon, grad, n, label }: { icon: React.ReactNode; grad: number; n: number; label: string }) {
  return (
    <Panel className="flex items-center gap-3 p-4">
      <span className={`tile-grad-${grad} grid h-9 w-9 shrink-0 place-items-center rounded-xl text-ink/75`}>{icon}</span>
      <span>
        <span className="block text-[22px] font-semibold leading-none tabular-nums">{fmtNumber(n)}</span>
        <span className="mt-1 block text-[12.5px] text-muted">{label}</span>
      </span>
    </Panel>
  );
}

function SessionHeader({ index, total, item, onExit }: { index: number; total: number; item: SessionItem; onExit: () => void }) {
  const reason = item.kind === "card" ? t("כרטיסייה", "Flashcard") : sessionReasonLabel(item.reason);
  const color = item.kind === "question" && item.reason === "retry" ? "red" : item.kind === "card" ? "blue" : "slate";
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-[13px]">
        <span className="font-medium tabular-nums">
          {index + 1} / {total}
        </span>
        <Badge color={color as "red" | "blue" | "slate"}>{reason}</Badge>
        <button className="ms-auto inline-flex items-center gap-1 text-muted hover:text-ink" onClick={onExit}>
          <X size={14} /> {t("סיום", "End")}
        </button>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06]">
        <div className="h-full rounded-full bg-ink transition-[width] duration-500" style={{ width: `${(index / total) * 100}%` }} />
      </div>
    </div>
  );
}

/** Enter = continue once answered. */
function useEnter(enabled: boolean, fn: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const on = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [enabled, fn]);
}

function QuestionStep({ item, courseId, onDone }: { item: Extract<SessionItem, { kind: "question" }>; courseId: number; onDone: (r: Result) => void }) {
  const engine = useEngine();
  const q = item.q;
  const mistake = item.mistakeId ? engine.store.mistake(item.mistakeId) : undefined;
  const [choice, setChoice] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [state, setState] = useState<{ correct: boolean; grade?: GradeResult; resolved?: boolean; logged?: boolean } | null>(null);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settle = (correct: boolean, answer: string, grade?: GradeResult) => {
    engine.recordAttempt(courseId, q.concept, `session:${q.id}:${q.prompt.length}`, correct, grade ? grade.score / 10 : correct ? 1 : 0, q.kind, answer, grade?.feedback ?? "");
    let resolved = false;
    let logged = false;
    if (item.mistakeId) {
      engine.retryMistake(item.mistakeId, correct);
      resolved = engine.store.mistake(item.mistakeId)?.status === "resolved";
    } else if (!correct) {
      engine.recordMistake({
        courseId,
        concept: q.concept,
        origin: "session",
        itemRef: `session:${Date.now()}:${q.id}`,
        question: q.kind === "mcq" ? `${q.prompt}\n\n${q.options.map((o, i) => `${i + 1}. ${o}`).join("\n")}` : q.prompt,
        studentAnswer: answer,
        correctAnswer: q.kind === "mcq" ? (q.options[q.correct_index] ?? q.model_answer) : q.model_answer,
        explanation: q.explanation,
        citations: q.citations,
      });
      logged = true;
    }
    setState({ correct, grade, resolved, logged });
  };

  const check = async () => {
    if (q.kind === "mcq") {
      if (choice === null) return;
      settle(choice === q.correct_index, q.options[choice] ?? "");
      return;
    }
    if (!text.trim()) return;
    setGrading(true);
    setError(null);
    try {
      const g = await engine.grade({ question: q.prompt, answer: text, modelAnswer: q.model_answer, rubric: [], maxPoints: 10, tier: "fast" });
      settle(g.correct, text, g);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setGrading(false);
    }
  };

  const proceed = () => state && onDone({ correct: state.correct, reason: item.reason, resolved: state.resolved, logged: state.logged });
  useEnter(!!state, proceed);
  useEffect(() => {
    if (state || q.kind !== "mcq") return;
    const on = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= q.options.length) setChoice(n - 1);
      if (e.key === "Enter" && choice !== null) void check();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  return (
    <div className="space-y-4" data-testid="session-question">
      {mistake && (
        <Panel className="flex items-start gap-2.5 px-4 py-3 text-[13px] text-ink-2">
          <RotateCcw size={15} className="mt-0.5 shrink-0 text-red-500" />
          <span>
            <span className="font-medium">{t("הזדמנות שנייה: ", "Second chance: ")}</span>
            {mistake.misconception || t("בפעם הקודמת טעיתם בנקודה הזו. זו שאלה חדשה על אותו רעיון.", "You got this point wrong last time. Here is a new question on the same idea.")}
          </span>
        </Panel>
      )}
      <Card className="space-y-4 p-6">
        <div className="text-[12px] font-medium text-muted">{q.concept}</div>
        <Markdown text={q.prompt} className="text-[16px]" />
        {q.kind === "mcq" ? (
          <div className="space-y-2" role="radiogroup">
            {q.options.map((o, j) => {
              const cls = state
                ? j === q.correct_index
                  ? "border-emerald-500 bg-emerald-50"
                  : j === choice
                    ? "border-red-400 bg-red-50"
                    : "border-black/10 opacity-70"
                : choice === j
                  ? "border-ink bg-black/[0.03] ring-1 ring-ink"
                  : "border-black/10 hover:bg-black/[0.02]";
              return (
                <button
                  key={j}
                  role="radio"
                  aria-checked={choice === j}
                  disabled={!!state}
                  onClick={() => setChoice(j)}
                  className={`flex w-full items-start gap-3 rounded-xl border p-3 text-start transition ${cls}`}
                >
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border border-black/15 text-[11px] font-medium text-muted">{j + 1}</span>
                  <Markdown text={o} className="flex-1" />
                </button>
              );
            })}
          </div>
        ) : (
          <textarea
            className={inputClass}
            rows={4}
            disabled={!!state || grading}
            placeholder={t("כתבו את התשובה במילים שלכם…", "Write your answer in your own words…")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label={t("תשובה", "Answer")}
          />
        )}
      </Card>

      {error && <Alert kind="error">{error}</Alert>}

      {!state ? (
        <Button size="lg" className="w-full" disabled={grading || (q.kind === "mcq" ? choice === null : !text.trim())} onClick={check}>
          {grading ? <Thinking label={t("בודק את התשובה", "Checking your answer")} /> : t("בדיקה", "Check")}
        </Button>
      ) : (
        <div className="space-y-3">
          <div className={`rounded-2xl border p-4 ${state.correct ? "border-emerald-200 bg-emerald-50/60" : "border-red-200 bg-red-50/60"}`} data-testid="session-feedback">
            <div className="mb-1 flex items-center gap-2 text-[14px] font-semibold">
              {state.correct ? <Check size={16} className="text-emerald-600" /> : <X size={16} className="text-red-600" />}
              {state.correct ? t("נכון!", "Correct!") : t("לא בדיוק", "Not quite")}
              {state.resolved && <Badge color="green">{t("הטעות תוקנה ✓", "Mistake fixed ✓")}</Badge>}
              {state.logged && <Badge color="amber">{t("נשמר למחברת הטעויות", "Saved to your mistakes")}</Badge>}
            </div>
            {state.grade && <Markdown text={state.grade.feedback} />}
            <Markdown text={q.explanation} />
            {q.kind === "open" && !state.correct && <Markdown text={`**${t("תשובה לדוגמה", "Model answer")}:** ${q.model_answer}`} />}
            <CitationChips ids={q.citations} />
          </div>
          <Button size="lg" className="w-full" onClick={proceed}>
            {t("המשך", "Continue")}
          </Button>
        </div>
      )}
    </div>
  );
}

function CardStep({ item, courseId, onDone }: { item: Extract<SessionItem, { kind: "card" }>; courseId: number; onDone: (r: Result) => void }) {
  const engine = useEngine();
  const card = item.card;
  const [shown, setShown] = useState(false);
  const intervals = useMemo(() => previewIntervals(card.fsrs, new Date()), [card.fsrs]);
  const grades: { g: ReviewGrade; label: string; tone: string }[] = [
    { g: "again", label: t("שכחתי", "Again"), tone: "text-red-600" },
    { g: "hard", label: t("קשה", "Hard"), tone: "text-amber-600" },
    { g: "good", label: t("טוב", "Good"), tone: "text-emerald-600" },
    { g: "easy", label: t("קל", "Easy"), tone: "text-sky-600" },
  ];
  const rate = (g: ReviewGrade) => {
    engine.review(card.id, card.fsrs, g, courseId, card.concept);
    onDone({ correct: g === "good" || g === "easy", reason: "card" });
  };
  useEnter(!shown, () => setShown(true));
  useEffect(() => {
    if (!shown) return;
    const on = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= 4) rate(grades[n - 1].g);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });
  return (
    <div className="space-y-4" data-testid="session-card">
      <Card className="min-h-[220px] space-y-4 p-6">
        <div className="text-[12px] font-medium text-muted">{card.concept}</div>
        <Markdown text={card.front} className="text-[17px]" />
        {shown && (
          <div className="border-t border-black/[0.06] pt-4">
            <Markdown text={card.back} />
            <CitationChips ids={card.citations} />
          </div>
        )}
      </Card>
      {!shown ? (
        <Button size="lg" className="w-full" onClick={() => setShown(true)}>
          {t("הצגת התשובה", "Show answer")}
        </Button>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {grades.map((b, i) => (
            <button key={b.g} onClick={() => rate(b.g)} className="rounded-xl border border-black/10 bg-white px-2 py-2.5 transition hover:bg-black/[0.02]">
              <div className={`text-[14px] font-semibold ${b.tone}`}>{b.label}</div>
              <div className="text-[11.5px] text-muted">
                {intervals[b.g]} · {i + 1}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SessionDone({ courseId, results, seconds, onAgain }: { courseId: number; results: Result[]; seconds: number; onAgain: () => void }) {
  const engine = useEngine();
  const correct = results.filter((r) => r.correct).length;
  const fixed = results.filter((r) => r.reason === "retry" && r.correct).length;
  const logged = results.filter((r) => r.logged).length;
  const streak = engine.streak(courseId);
  const pct = results.length ? Math.round((correct / results.length) * 100) : 0;
  return (
    <div className="mx-auto max-w-2xl space-y-6 text-center" data-testid="session-done">
      <span className="tile-grad-3 mx-auto grid h-14 w-14 place-items-center rounded-2xl text-ink/80">
        <CircleCheck size={26} strokeWidth={1.8} />
      </span>
      <div>
        <h2 className="text-[24px] font-semibold tracking-tight">{results.length ? t("סיימתם את הסשן!", "Session complete!") : t("הסשן הסתיים", "Session ended")}</h2>
        <p className="mt-1 text-[14px] text-muted">
          {t(`${correct} מתוך ${results.length} נכונות (${pct}%) · ${clock(seconds)}`, `${correct} of ${results.length} correct (${pct}%) · ${clock(seconds)}`)}
        </p>
      </div>
      <div className="grid gap-3 text-start sm:grid-cols-3">
        <Stat icon={<Flame size={17} />} grad={5} n={streak} label={t("ימים ברצף", "Day streak")} />
        <Stat icon={<Check size={17} />} grad={3} n={fixed} label={t("טעויות שעניתם עליהן נכון", "Past mistakes answered right")} />
        <Stat icon={<NotebookPen size={17} />} grad={8} n={logged} label={t("נוספו למחברת", "Added to notebook")} />
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="secondary" onClick={() => go(href.course(courseId, "mistakes"))}>
          <NotebookPen size={15} /> {t("למחברת הטעויות", "Open mistakes notebook")}
        </Button>
        <Button variant="secondary" onClick={() => go(href.course(courseId, "progress"))}>
          {t("להתקדמות", "See progress")}
        </Button>
        <Button variant="ghost" onClick={onAgain}>
          {t("עוד סשן", "Another session")}
        </Button>
      </div>
    </div>
  );
}
