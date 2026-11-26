import { useState } from "react";
import { Check, NotebookPen, Play, Sparkles, Trash2 } from "lucide-react";
import type { Mistake } from "@tutorai/core";
import { diagnoseMistake } from "@tutorai/core";
import { useEngine } from "../engine.ts";
import { go, href } from "../router.ts";
import { Badge, Button, Empty, Tabs } from "../ui/components.tsx";
import { Markdown } from "../ui/Markdown.tsx";
import { CitationChips } from "../ui/Citations.tsx";
import { Thinking } from "../ui/LongTask.tsx";
import { fmtDate, t } from "../i18n.tsx";

/** Every wrong answer, why it probably happened, and when it comes back. */
export function MistakesNotebook({ courseId }: { courseId: number }) {
  const engine = useEngine();
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const open = engine.store.mistakes(courseId, "open");
  const resolved = engine.store.mistakes(courseId, "resolved");
  const list = tab === "open" ? open : resolved;
  const now = new Date().toISOString();
  const dueNow = open.filter((m) => m.due <= now).length;

  const byConcept = new Map<string, Mistake[]>();
  for (const m of list) byConcept.set(m.concept || t("כללי", "General"), [...(byConcept.get(m.concept || t("כללי", "General")) ?? []), m]);

  if (open.length + resolved.length === 0)
    return (
      <Empty icon={<NotebookPen size={26} strokeWidth={1.6} />} title={t("המחברת ריקה, וזה בסדר", "Your notebook is empty, and that's fine")}>
        <p className="max-w-md">
          {t(
            "כל תשובה שגויה בחידון, במבחן או בסשן היומי נשמרת כאן עם הסבר למה זה כנראה קרה, וחוזרת אליכם כשאלה חדשה כמה ימים אחר כך.",
            "Every wrong answer in a quiz, exam or daily session is saved here with an explanation of why it probably happened, and comes back as a new question a few days later.",
          )}
        </p>
        <div className="mt-3">
          <a className="underline" href={href.course(courseId, "studio", "quiz")}>
            {t("לחידון חדש", "Try a quiz")}
          </a>
        </div>
      </Empty>
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight">{t("מחברת הטעויות", "Mistakes notebook")}</h2>
          <p className="mt-0.5 text-[13px] text-muted">
            {t(
              `${open.length} פתוחות · ${resolved.length} תוקנו. טעות נחשבת מתוקנת אחרי שתי תשובות נכונות בימים שונים.`,
              `${open.length} open · ${resolved.length} fixed. A mistake counts as fixed after two correct answers on different days.`,
            )}
          </p>
        </div>
        {dueNow > 0 && (
          <Button onClick={() => go(href.course(courseId, "session"))}>
            <Play size={14} /> {t(`תרגול ${dueNow} טעויות עכשיו`, `Practice ${dueNow} now`)}
          </Button>
        )}
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: "open", label: t(`פתוחות (${open.length})`, `Open (${open.length})`) },
          { id: "resolved", label: t(`תוקנו (${resolved.length})`, `Fixed (${resolved.length})`) },
        ]}
      />

      {list.length === 0 && (
        <p className="py-8 text-center text-[13px] text-muted">
          {tab === "open" ? t("אין טעויות פתוחות. כל הכבוד!", "No open mistakes. Well done!") : t("עוד לא תוקנו טעויות.", "No fixed mistakes yet.")}
        </p>
      )}

      {[...byConcept.entries()].map(([concept, items]) => (
        <section key={concept} className="space-y-3">
          <h3 className="text-[13px] font-medium text-muted">
            {concept} · {items.length}
          </h3>
          {items.map((m) => (
            <MistakeCard key={m.id} m={m} courseId={courseId} />
          ))}
        </section>
      ))}
    </div>
  );
}

function MistakeCard({ m, courseId }: { m: Mistake; courseId: number }) {
  const engine = useEngine();
  const [diagnosing, setDiagnosing] = useState(false);
  const now = new Date().toISOString();
  const fresh = Date.now() - Date.parse(m.created_at.replace(" ", "T") + "Z") < 45_000;
  const origin = { quiz: t("חידון", "Quiz"), exam: t("מבחן", "Exam"), session: t("סשן יומי", "Daily session"), check: t("בדיקת פתרון", "Solution check") }[m.origin];

  const diagnose = async () => {
    setDiagnosing(true);
    try {
      await diagnoseMistake(engine.llm, engine.store, m.id);
    } finally {
      setDiagnosing(false);
    }
  };

  return (
    <article className="rounded-2xl border border-black/[0.08] bg-white p-5" data-testid="mistake-card">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
        <Badge>{origin}</Badge>
        {m.status === "resolved" ? (
          <Badge color="green">
            <Check size={11} /> {t("תוקנה", "Fixed")}
          </Badge>
        ) : m.due <= now ? (
          <Badge color="amber">{t("מחכה לתרגול היום", "Due today")}</Badge>
        ) : (
          <Badge color="blue">{t(`חוזרת ב-${fmtDate(m.due)}`, `Comes back ${fmtDate(m.due)}`)}</Badge>
        )}
        {m.status === "open" && m.streak > 0 && <Badge color="green">{t(`${m.streak}/2 נכונות`, `${m.streak}/2 correct`)}</Badge>}
      </div>

      <Markdown text={m.question} />

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl bg-red-50/70 px-3 py-2">
          <div className="text-[11.5px] font-medium text-red-700">{t("התשובה שלכם", "Your answer")}</div>
          <Markdown text={m.student_answer || t("(ריק)", "(empty)")} className="text-[14px]" />
        </div>
        <div className="rounded-xl bg-emerald-50/70 px-3 py-2">
          <div className="text-[11.5px] font-medium text-emerald-700">{t("תשובה נכונה", "Correct answer")}</div>
          <Markdown text={m.correct_answer} className="text-[14px]" />
        </div>
      </div>

      <div className="mt-3 rounded-xl border-s-4 border-amber-400 bg-amber-50/70 px-3 py-2 text-[13.5px]">
        <span className="font-semibold text-amber-900">{t("למה זה כנראה קרה: ", "Why this probably happened: ")}</span>
        {m.misconception ? (
          <span className="text-ink-2">{m.misconception}</span>
        ) : diagnosing || fresh ? (
          <Thinking label={t("מאבחן", "Diagnosing")} />
        ) : (
          <button className="inline-flex items-center gap-1 font-medium text-ink underline underline-offset-2" onClick={diagnose}>
            <Sparkles size={13} /> {t("לאבחן עכשיו", "Diagnose now")}
          </button>
        )}
      </div>

      {m.explanation && (
        <details className="mt-3 text-[13.5px]">
          <summary className="cursor-pointer font-medium text-ink-2">{t("הסבר מלא", "Full explanation")}</summary>
          <Markdown text={m.explanation} />
        </details>
      )}
      <CitationChips ids={m.citations} />

      <div className="mt-4 flex flex-wrap gap-2">
        {m.status === "open" && (
          <Button
            size="sm"
            onClick={() => {
              engine.store.updateMistake(m.id, { due: new Date(Date.now() - 1000).toISOString() });
              go(href.course(courseId, "session"));
            }}
          >
            <Play size={13} /> {t("תרגול עכשיו", "Practice now")}
          </Button>
        )}
        {m.status === "open" ? (
          <Button size="sm" variant="secondary" onClick={() => engine.store.updateMistake(m.id, { status: "resolved" })}>
            <Check size={13} /> {t("הבנתי, לסגור", "Got it, close")}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => engine.store.updateMistake(m.id, { status: "open", streak: 0, due: new Date().toISOString() })}>
            {t("לפתוח מחדש", "Reopen")}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ms-auto"
          aria-label={t("מחיקה", "Delete")}
          onClick={() => confirm(t("למחוק את הטעות מהמחברת?", "Delete this mistake from the notebook?")) && engine.store.deleteMistake(m.id)}
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </article>
  );
}
