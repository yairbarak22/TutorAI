import { useState } from "react";
import { useEngine } from "../engine.ts";
import { go, href } from "../router.ts";
import { CalendarDays, Pencil } from "lucide-react";
import { Badge, Button, Empty, Field, Modal, inputClass } from "../ui/components.tsx";
import { COURSE_SECTIONS, CourseMark, sectionLabel } from "../ui/Shell.tsx";
import { daysUntil } from "./Home.tsx";
import { Materials } from "./Materials.tsx";
import { Concepts } from "./Concepts.tsx";
import { Studio } from "./Studio.tsx";
import { ArtifactView, ArtifactList } from "./ArtifactView.tsx";
import { Tutor } from "./Tutor.tsx";
import { Review } from "./Review.tsx";
import { ProgressView } from "./Progress.tsx";

export function CourseView({ id, tab, sub }: { id: number; tab: string; sub?: string }) {
  const engine = useEngine();
  const course = engine.store.course(id);
  const [edit, setEdit] = useState(false);
  if (!course)
    return (
      <Empty icon="?" title="הקורס לא נמצא">
        <a className="underline" href={href.home()}>
          חזרה לרשימת הקורסים
        </a>
      </Empty>
    );
  const d = daysUntil(course.exam_date);
  const due = engine.store.dueCards(id, new Date().toISOString()).length;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <CourseMark id={id} name={course.name} size="md" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[24px] font-semibold leading-tight tracking-tight">{course.name}</h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <span>{sectionLabel(tab)}</span>
            {d !== null && d >= 0 && (
              <Badge color={d <= 7 ? "amber" : "slate"}>
                <CalendarDays size={12} />
                {d === 0 ? "המבחן היום" : `${d} ימים למבחן`}
              </Badge>
            )}
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setEdit(true)}>
          <Pencil size={13} /> עריכת קורס
        </Button>
      </div>
      {/* On small screens the course sections live here instead of the sidebar. */}
      <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 md:hidden" aria-label="לשוניות הקורס">
        {COURSE_SECTIONS.map((t) => (
          <a
            key={t.id}
            href={href.course(id, t.id)}
            className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] font-medium ${
              tab === t.id ? "bg-ink text-white" : "bg-black/[0.04] text-ink-2"
            }`}
            aria-current={tab === t.id ? "page" : undefined}
          >
            <t.icon size={14} />
            {t.label}
            {t.id === "review" && due > 0 && <span className="rounded-full bg-white/20 px-1.5 text-[11px]">{due}</span>}
          </a>
        ))}
      </nav>
      {tab === "materials" && <Materials courseId={id} />}
      {tab === "concepts" && <Concepts courseId={id} />}
      {tab === "studio" && <Studio courseId={id} preselect={sub} />}
      {tab === "tutor" && <Tutor courseId={id} ask={sub ? safeDecode(sub) : undefined} />}
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

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
