import { useState } from "react";
import type { Diagram, ExamSimulation, Flashcards, InteractiveWidget, MarkdownDoc, Quiz, StudyPlan } from "@ruecai/sdk";
import type { Artifact } from "@ruecai/core";
import { useEngine } from "../engine.ts";
import { go, href } from "../router.ts";
import { Badge, Button, Card, Empty, errorMessage } from "../ui/components.tsx";
import { Markdown } from "../ui/Markdown.tsx";
import { CitationChips } from "../ui/Citations.tsx";
import { MermaidView, WidgetFrame } from "../ui/Visuals.tsx";
import { QuizPlayer } from "./players/QuizPlayer.tsx";
import { ExamPlayer } from "./players/ExamPlayer.tsx";

const TYPE_LABEL: Record<string, string> = {
  markdown_doc: "מסמך",
  quiz: "חידון",
  flashcards: "כרטיסיות",
  diagram: "תרשים",
  exam_simulation: "מבחן",
  study_plan: "תוכנית לימוד",
  interactive_widget: "אינטראקטיבי",
  concept_map: "מפת מושגים",
};

export function ArtifactList({ courseId }: { courseId: number }) {
  const engine = useEngine();
  const items = engine.store.artifacts(courseId);
  if (!items.length)
    return (
      <Empty icon="🗂️" title="עוד לא נוצרו תוצרים">
        <a className="underline" href={href.course(courseId, "studio")}>
          צרו סיכום, חידון או מבחן בלשונית הכלים
        </a>
      </Empty>
    );
  return (
    <Card className="divide-y divide-slate-100">
      {items.map((a) => (
        <a key={a.id} href={href.course(courseId, "artifacts", a.id)} className="flex items-center gap-3 p-4 hover:bg-slate-50">
          <span className="text-xl">{engine.tools.find((t) => t.manifest.id === a.tool_id)?.manifest.icon ?? "📄"}</span>
          <span className="flex-1 font-medium" dir="auto">
            {a.title}
          </span>
          <Badge>{TYPE_LABEL[a.type] ?? a.type}</Badge>
          <span className="text-xs text-slate-400">{new Date(a.created_at + "Z").toLocaleDateString("he-IL")}</span>
        </a>
      ))}
    </Card>
  );
}

export function ArtifactView({ courseId, artifactId }: { courseId: number; artifactId: number }) {
  const engine = useEngine();
  const a = engine.store.artifact(artifactId);
  if (!a) return <Empty icon="🤷" title="התוצר לא נמצא" />;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <a href={href.course(courseId, "artifacts")} className="text-sm text-slate-500 hover:text-slate-800">
          → כל התוצרים
        </a>
        <span className="ms-auto" />
        <Button size="sm" variant="ghost" onClick={() => window.print()}>
          🖨️ הדפסה
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            if (!confirm("למחוק את התוצר?")) return;
            engine.store.deleteArtifact(a.id);
            go(href.course(courseId, "artifacts"));
          }}
        >
          🗑️ מחיקה
        </Button>
      </div>
      <h1 className="text-2xl font-bold" dir="auto">
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
          <h2 className="mb-2 text-lg font-bold" dir="auto">
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
        <p className="text-slate-600">{cards.cards.length} כרטיסיות נוספו לחזרה המרווחת.</p>
        <Button size="sm" onClick={() => go(href.course(courseId, "review"))}>
          לחזרה עכשיו
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.cards.map((c, i) => (
          <Card key={i} className="cursor-pointer p-4" onClick={() => setFlipped(new Set(flipped.has(i) ? [...flipped].filter((x) => x !== i) : [...flipped, i]))}>
            <Markdown text={flipped.has(i) ? c.back : c.front} />
            <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
              <span>{flipped.has(i) ? "תשובה" : "לחצו להפוך"}</span>
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
                try {
                  await engine.repairArtifact(artifactId, error);
                  setAttempts(attempts + 1);
                } catch (e) {
                  setErr(errorMessage(e));
                } finally {
                  setRepairing(false);
                }
              }
            : undefined
        }
      />
      {err && <p className="text-sm text-red-700">{err}</p>}
    </div>
  );
}

const ACTIVITY = { learn: "📖 ללמוד", practice: "✍️ לתרגל", review: "🔁 לחזור" } as const;

function PlanView({ plan, courseId }: { plan: StudyPlan; courseId: number }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-3">
      <p className="text-slate-600">מבחן ב-{new Date(plan.exam_date).toLocaleDateString("he-IL")}. התוכנית מתעדכנת לפי התרגול: צרו אותה מחדש מדי כמה ימים.</p>
      {plan.days.map((d) => (
        <Card key={d.date} className={`p-4 ${d.date === today ? "border-brand-500 ring-2 ring-brand-100" : ""}`}>
          <div className="mb-2 flex items-center gap-2 font-bold">
            {new Date(d.date).toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "numeric" })}
            {d.date === today && <Badge color="blue">היום</Badge>}
            <span className="ms-auto text-xs font-normal text-slate-500">{d.items.reduce((n, i) => n + i.minutes, 0)} דק'</span>
          </div>
          <ul className="space-y-1 text-sm">
            {d.items.map((it, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="w-20 shrink-0">{ACTIVITY[it.activity]}</span>
                <a className="font-medium text-brand-700 hover:underline" href={href.course(courseId, "studio", `${it.activity === "learn" ? "explainer" : "quiz"}?concept=${encodeURIComponent(it.concept)}`)}>
                  {it.concept}
                </a>
                <span className="text-slate-400">· {it.minutes} דק' · {it.reason}</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
