import { useState } from "react";
import { useEngine } from "../engine.ts";
import { go, href } from "../router.ts";
import { Button, Empty, Field, Modal, inputClass } from "../ui/components.tsx";
import { daysUntil } from "./Home.tsx";
import { Materials } from "./Materials.tsx";
import { Concepts } from "./Concepts.tsx";
import { Studio } from "./Studio.tsx";
import { ArtifactView, ArtifactList } from "./ArtifactView.tsx";
import { Tutor } from "./Tutor.tsx";
import { Review } from "./Review.tsx";
import { ProgressView } from "./Progress.tsx";

const TABS = [
  { id: "materials", label: "📄 חומרים" },
  { id: "concepts", label: "🗺️ מפת מושגים" },
  { id: "studio", label: "✨ כלים" },
  { id: "tutor", label: "🎓 טוטור" },
  { id: "review", label: "🃏 חזרה" },
  { id: "progress", label: "📈 התקדמות" },
  { id: "artifacts", label: "🗂️ תוצרים" },
];

export function CourseView({ id, tab, sub }: { id: number; tab: string; sub?: string }) {
  const engine = useEngine();
  const course = engine.store.course(id);
  const [edit, setEdit] = useState(false);
  if (!course)
    return (
      <Empty icon="🤷" title="הקורס לא נמצא">
        <a className="underline" href={href.home()}>
          חזרה לרשימת הקורסים
        </a>
      </Empty>
    );
  const d = daysUntil(course.exam_date);
  const due = engine.store.dueCards(id, new Date().toISOString()).length;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <a href={href.home()} className="text-slate-500 hover:text-slate-800" aria-label="חזרה">
          →
        </a>
        <h1 className="text-2xl font-bold">{course.name}</h1>
        {d !== null && d >= 0 && <span className="rounded-full bg-amber-50 px-3 py-0.5 text-sm text-amber-800">⏳ {d === 0 ? "המבחן היום" : `${d} ימים למבחן`}</span>}
        <Button variant="ghost" size="sm" onClick={() => setEdit(true)}>
          עריכה
        </Button>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="לשוניות הקורס">
        {TABS.map((t) => (
          <a
            key={t.id}
            href={href.course(id, t.id)}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t.id ? "border-brand-600 text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
            aria-current={tab === t.id ? "page" : undefined}
          >
            {t.label}
            {t.id === "review" && due > 0 && <span className="ms-1 rounded-full bg-amber-500 px-1.5 text-xs text-white">{due}</span>}
          </a>
        ))}
      </nav>
      {tab === "materials" && <Materials courseId={id} />}
      {tab === "concepts" && <Concepts courseId={id} />}
      {tab === "studio" && <Studio courseId={id} preselect={sub} />}
      {tab === "tutor" && <Tutor courseId={id} />}
      {tab === "review" && <Review courseId={id} />}
      {tab === "progress" && <ProgressView courseId={id} />}
      {tab === "artifacts" && (sub ? <ArtifactView courseId={id} artifactId={Number(sub)} /> : <ArtifactList courseId={id} />)}
      <EditCourse open={edit} onClose={() => setEdit(false)} id={id} />
    </div>
  );
}

function EditCourse({ open, onClose, id }: { open: boolean; onClose: () => void; id: number }) {
  const engine = useEngine();
  const c = engine.store.course(id)!;
  const [name, setName] = useState(c.name);
  const [date, setDate] = useState(c.exam_date ?? "");
  const [minutes, setMinutes] = useState(c.minutes_per_day);
  return (
    <Modal open={open} onClose={onClose} title="הגדרות הקורס">
      <div className="space-y-4">
        <Field label="שם">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="תאריך המבחן">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="זמן לימוד ביום (דקות)">
          <input type="number" min={15} max={600} className={inputClass} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
        </Field>
        <div className="flex justify-between gap-2">
          <Button
            onClick={() => {
              engine.store.updateCourse(id, { name: name.trim() || c.name, exam_date: date || null, minutes_per_day: minutes || 90 });
              onClose();
            }}
          >
            שמירה
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              if (!confirm(`למחוק את הקורס "${c.name}" וכל מה שבו? הקבצים יימחקו גם מהתיקייה. אי אפשר לבטל.`)) return;
              for (const s of engine.store.sources(id)) await engine.deleteSource(s.id);
              engine.store.deleteCourse(id);
              go(href.home());
            }}
          >
            מחיקת הקורס
          </Button>
        </div>
      </div>
    </Modal>
  );
}
