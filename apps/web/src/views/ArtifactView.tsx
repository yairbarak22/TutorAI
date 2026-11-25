import { useState } from "react";
import { LongTask } from "../ui/LongTask.tsx";
import { expectedChars, expectedSeconds, recordRun } from "../platform/timing.ts";
import { FolderOpen, Printer, Trash2 } from "lucide-react";
import type { Diagram, ExamSimulation, Flashcards, InteractiveWidget, MarkdownDoc, Quiz, StudyPlan } from "@ruecai/sdk";
import type { Artifact } from "@ruecai/core";
import { useEngine } from "../engine.ts";
import { go, href } from "../router.ts";
import { Badge, Button, Card, Empty, errorMessage } from "../ui/components.tsx";
import { Markdown } from "../ui/Markdown.tsx";
import { CitationChips } from "../ui/Citations.tsx";
import { MermaidView, WidgetFrame } from "../ui/Visuals.tsx";
import { ToolTile } from "../ui/toolIcons.tsx";
import { QuizPlayer } from "./players/QuizPlayer.tsx";
import { ArrowBack, fmtDate, locale, t } from "../i18n.tsx";
import { ExamPlayer } from "./players/ExamPlayer.tsx";

const typeLabel = (type: string): string =>
  ({
    markdown_doc: t("מסמך", "Document"),
    quiz: t("חידון", "Quiz"),
    flashcards: t("כרטיסיות", "Flashcards"),
    diagram: t("תרשים", "Diagram"),
    exam_simulation: t("מבחן", "Exam"),
    study_plan: t("תוכנית לימוד", "Study plan"),
    interactive_widget: t("אינטראקטיבי", "Interactive"),
    concept_map: t("מפת מושגים", "Concept map"),
  })[type] ?? type;

export function ArtifactList({ courseId }: { courseId: number }) {
  const engine = useEngine();
  const items = engine.store.artifacts(courseId);
  if (!items.length)
    return (
      <Empty icon={<FolderOpen size={26} strokeWidth={1.6} />} title={t("עוד לא נוצרו תוצרים", "No outputs created yet")}>
        <a className="underline" href={href.course(courseId, "studio")}>
          {t("צרו סיכום, חידון או מבחן בלשונית הכלים", "Create a summary, quiz or exam in the Tools tab")}
        </a>
      </Empty>
    );
  return (
    <Card className="divide-y divide-slate-100">
      {items.map((a) => (
        <a key={a.id} href={href.course(courseId, "artifacts", a.id)} className="flex items-center gap-3 p-4 hover:bg-slate-50">
          <ToolTile id={a.tool_id} emoji={engine.tools.find((t) => t.manifest.id === a.tool_id)?.manifest.icon ?? "📄"} size="sm" />
          <span className="flex-1 font-medium" dir="auto">
            {a.title}
          </span>
          <Badge>{typeLabel(a.type)}</Badge>
          <span className="text-xs text-slate-400">{fmtDate(a.created_at + "Z")}</span>
        </a>
      ))}
    </Card>
  );
}

export function ArtifactView({ courseId, artifactId }: { courseId: number; artifactId: number }) {
  const engine = useEngine();
  const a = engine.store.artifact(artifactId);
  if (!a) return <Empty icon="?" title={t("התוצר לא נמצא", "Output not found")} />;
  return (
    <div className={`mx-auto space-y-4 ${a.type === "interactive_widget" ? "max-w-6xl" : "max-w-3xl"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <a href={href.course(courseId, "artifacts")} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowBack size={14} /> {t("כל התוצרים", "All outputs")}
        </a>
        <span className="ms-auto" />
        <Button size="sm" variant="ghost" onClick={() => window.print()}>
          <Printer size={14} /> {t("הדפסה", "Print")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            if (!confirm(t("למחוק את התוצר?", "Delete this output?"))) return;
            engine.store.deleteArtifact(a.id);
            go(href.course(courseId, "artifacts"));
          }}
        >
          <Trash2 size={14} /> {t("מחיקה", "Delete")}
        </Button>
      </div>
      <h1 className="text-2xl font-semibold" dir="auto">
        {a.title}
      </h1>
      <Body a={a} courseId={courseId} />
    </div>
  );
}

function Body({ a, courseId }: { a: Artifact; courseId: number }) {
  switch (a.type) {
    case "markdown_doc":
      return <DocView doc={a.data as MarkdownDoc} />;
    case "quiz":
      return <QuizPlayer quiz={a.data as Quiz} courseId={courseId} artifactId={a.id} />;
    case "flashcards":
      return <CardsView cards={a.data as Flashcards} courseId={courseId} />;
    case "diagram":
      return <DiagramView d={a.data as Diagram} />;
    case "exam_simulation":
      return <ExamPlayer exam={a.data as ExamSimulation} courseId={courseId} artifactId={a.id} />;
    case "study_plan":
      return <PlanView plan={a.data as StudyPlan} courseId={courseId} />;
    case "interactive_widget":
      return <WidgetView w={a.data as InteractiveWidget} artifactId={a.id} />;
    default:
      return <pre className="overflow-auto text-xs">{JSON.stringify(a.data, null, 2)}</pre>;
  }
}

function DocView({ doc }: { doc: MarkdownDoc }) {
  return (
    <div className="space-y-4">
      {doc.sections.map((s, i) => (
        <Card key={i} className="p-5">
          <h2 className="mb-2 text-lg font-semibold" dir="auto">
            {s.heading}
          </h2>
          <Markdown text={s.markdown} />
          <CitationChips ids={s.citations} />
        </Card>
      ))}
    </div>
  );
}

function CardsView({ cards, courseId }: { cards: Flashcards; courseId: number }) {
  const [flipped, setFlipped] = useState<Set<number>>(new Set());
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-slate-600">
          {t(
            `${cards.cards.length} כרטיסיות נוספו לחזרה המרווחת.`,
            cards.cards.length === 1 ? "1 card was added to spaced review." : `${cards.cards.length} cards were added to spaced review.`,
          )}
        </p>
        <Button size="sm" onClick={() => go(href.course(courseId, "review"))}>
          {t("לחזרה עכשיו", "Review now")}
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.cards.map((c, i) => (
          <Card key={i} className="cursor-pointer p-4" onClick={() => setFlipped(new Set(flipped.has(i) ? [...flipped].filter((x) => x !== i) : [...flipped, i]))}>
            <Markdown text={flipped.has(i) ? c.back : c.front} />
            <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
              <span>{flipped.has(i) ? t("תשובה", "Answer") : t("לחצו להפוך", "Click to flip")}</span>
              <span>{c.concept}</span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function DiagramView({ d }: { d: Diagram }) {
  return (
    <Card className="space-y-3 p-5">
      <MermaidView source={d.mermaid} />
      <Markdown text={d.explanation} />
      <CitationChips ids={d.citations} />
    </Card>
  );
}

function WidgetView({ w, artifactId }: { w: InteractiveWidget; artifactId: number }) {
  const engine = useEngine();
  const [repairing, setRepairing] = useState(false);
  const [repair, setRepair] = useState<{ startedAt: number; chars: number } | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <Card className="p-5">
        <Markdown text={w.explanation} />
        <CitationChips ids={w.citations} />
      </Card>
      <WidgetFrame
        html={w.html}
        repairing={repairing}
        onRepair={
          attempts < 2
            ? async (error) => {
                setRepairing(true);
                setErr(null);
                const startedAt = Date.now();
                let chars = 0;
                setRepair({ startedAt, chars: 0 });
                try {
                  await engine.repairArtifact(artifactId, error, (n) => {
                    chars = n;
                    setRepair((r) => (r ? { ...r, chars: n } : r));
                  });
                  recordRun("repair:explainer", (Date.now() - startedAt) / 1000, chars, engine.demo);
                  setAttempts(attempts + 1);
                } catch (e) {
                  setErr(errorMessage(e));
                } finally {
                  setRepairing(false);
                  setRepair(null);
                }
              }
            : undefined
        }
      />
      {repair && (
        <LongTask
          title={t("מתקן את ההסבר האינטראקטיבי", "Fixing the interactive explainer")}
          stages={[t("קורא את השגיאה", "Reading the error"), t("Claude כותב קוד מתוקן", "Claude is writing fixed code"), t("טוען מחדש", "Reloading")]}
          stage={repair.chars > 0 ? 1 : 0}
          startedAt={repair.startedAt}
          expectedSec={expectedSeconds("repair:explainer", engine.demo)}
          chars={repair.chars}
          expectedChars={expectedChars("repair:explainer")}
        />
      )}
      {err && <p className="text-sm text-red-700">{err}</p>}
    </div>
  );
}

const activityLabel = (a: "learn" | "practice" | "review") =>
  ({ learn: t("ללמוד", "Learn"), practice: t("לתרגל", "Practice"), review: t("לחזור", "Review") })[a];

function PlanView({ plan, courseId }: { plan: StudyPlan; courseId: number }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-3">
      <p className="text-slate-600">
        {t("מבחן ב-", "Exam on ")}
        {fmtDate(plan.exam_date)}.{" "}
        {t("התוכנית מתעדכנת לפי התרגול: צרו אותה מחדש מדי כמה ימים.", "The plan adapts to your practice: regenerate it every few days.")}
      </p>
      {plan.days.map((d) => (
        <Card key={d.date} className={`p-4 ${d.date === today ? "border-brand-500 ring-2 ring-brand-100" : ""}`}>
          <div className="mb-2 flex items-center gap-2 font-semibold">
            {new Date(d.date).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "numeric" })}
            {d.date === today && <Badge color="blue">{t("היום", "Today")}</Badge>}
            <span className="ms-auto text-xs font-normal text-slate-500">{d.items.reduce((n, i) => n + i.minutes, 0)} {t("דק'", "min")}</span>
          </div>
          <ul className="space-y-1 text-sm">
            {d.items.map((it, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="w-20 shrink-0">{activityLabel(it.activity)}</span>
                <a className="font-medium text-brand-700 hover:underline" href={href.course(courseId, "studio", `${it.activity === "learn" ? "explainer" : "quiz"}?concept=${encodeURIComponent(it.concept)}`)}>
                  {it.concept}
                </a>
                <span className="text-slate-400">· {it.minutes} {t("דק'", "min")} · {it.reason}</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
