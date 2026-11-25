import { useState } from "react";
import { ArrowUp, BookOpen, Box, CalendarDays, ChevronLeft, ClipboardCheck, Ellipsis, FileText, Layers, ListChecks, Plus, Workflow } from "lucide-react";
import { useEngine } from "../engine.ts";
import { go, href } from "../router.ts";
import { Badge, Button, Card, Empty, Field, Modal, inputClass } from "../ui/components.tsx";

export function daysUntil(date: string | null): number | null {
  if (!date) return null;
  return Math.ceil((Date.parse(date + "T00:00:00") - Date.now()) / 86_400_000);
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "לילה טוב" : h < 12 ? "בוקר טוב" : h < 17 ? "צהריים טובים" : h < 21 ? "ערב טוב" : "לילה טוב";
}

const QUICK = [
  { id: "summary", label: "סיכום", icon: FileText },
  { id: "quiz", label: "חידון", icon: ListChecks },
  { id: "flashcards", label: "כרטיסיות", icon: Layers },
  { id: "explainer", label: "הסבר 3D", icon: Box },
  { id: "diagram", label: "תרשים", icon: Workflow },
  { id: "exam-from-samples", label: "מבחן", icon: ClipboardCheck },
  { id: "study-plan", label: "תוכנית", icon: CalendarDays },
  { id: "", label: "עוד", icon: Ellipsis },
];

export function Home({ onNewCourse }: { onNewCourse: () => void }) {
  const engine = useEngine();
  const courses = engine.store.courses();
  const now = new Date().toISOString();
  const [q, setQ] = useState("");
  let remembered = 0;
  try {
    remembered = Number(localStorage.getItem("ruecai.lastCourse"));
  } catch {
    /* ignore */
  }
  const course = engine.store.course(remembered) ?? courses[0] ?? null;

  const ask = () => {
    if (!q.trim()) return;
    if (!course) return onNewCourse();
    try {
      sessionStorage.setItem(`ruecai.ask.${course.id}`, q.trim());
    } catch {
      /* ignore */
    }
    go(href.course(course.id, "tutor"));
  };

  return (
    <div className="space-y-12">
      <div className="mx-auto max-w-[640px] pt-[4vh] text-center">
        <h1 className="text-[28px] font-medium tracking-tight">{greeting()}, מה לומדים היום?</h1>
        <form
          className="mt-6 flex h-12 items-center gap-2 rounded-full border border-black/10 bg-white ps-2 pe-2 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.12)] focus-within:border-black/25"
          onSubmit={(e) => {
            e.preventDefault();
            ask();
          }}
        >
          <span className="tile-grad-5 h-8 w-8 shrink-0 rounded-full shadow-[inset_0_-6px_10px_rgba(0,0,0,0.12)]" />
          <input
            className="min-w-0 flex-1 bg-transparent px-1 text-[14px] outline-none placeholder:text-slate-400"
            placeholder={course ? `שאלו את הטוטור על ${course.name}…` : "צרו קורס כדי לשאול את הטוטור…"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="שאלה לטוטור"
          />
          {course && <span className="hidden rounded-md bg-black/[0.05] px-1.5 text-[11px] font-medium leading-5 text-ink-2 sm:inline">{course.name.split(" ")[0]}</span>}
          <button type="submit" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink text-white disabled:bg-slate-300" disabled={!q.trim()} aria-label="שליחה">
            <ArrowUp size={16} />
          </button>
        </form>
        {totalDueLine(engine, courses, now)}
      </div>

      <div className="mx-auto grid max-w-[720px] grid-cols-4 gap-y-5 sm:grid-cols-8">
        {QUICK.map((t) => (
          <a
            key={t.label}
            href={course ? href.course(course.id, "studio", t.id || undefined) : "#/"}
            onClick={(e) => {
              if (!course) {
                e.preventDefault();
                onNewCourse();
              }
            }}
            className="group flex flex-col items-center gap-2 text-[12.5px] font-medium text-ink-2"
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl border border-black/10 bg-white text-ink shadow-sm transition group-hover:border-black/25 group-hover:shadow">
              <t.icon size={18} strokeWidth={1.8} />
            </span>
            {t.label}
          </a>
        ))}
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-black/[0.08] bg-white">
        <div className="grid items-center gap-6 p-6 md:grid-cols-[1fr_1.4fr_1fr]">
          <ul className="hidden space-y-1.5 text-[13px] text-muted md:block">
            <li>מפת מושגים מכל החומר</li>
            <li>טוטור שמצטט עמוד ושקף</li>
            <li>חידונים וכרטיסיות חזרה</li>
            <li>מבחן בסגנון המבחנים לדוגמה</li>
            <li>הסברים אינטראקטיביים בתלת-ממד</li>
          </ul>
          <div className="text-center">
            <h2 className="text-[22px] font-medium tracking-tight">נסו קורס לדוגמה</h2>
            <p className="mt-1 text-[13px] text-muted">חומרים אמיתיים, מוכנים לכל הכלים. בלי להעלות כלום.</p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <Button size="sm" onClick={() => go(href.course(engine.loadDemoCourse("probability")))}>
                קורס לדוגמה: הסתברות
              </Button>
              <Button size="sm" variant="ghost" onClick={() => go(href.course(engine.loadDemoCourse("law")))}>
                קורס לדוגמה: דיני חוזים
              </Button>
            </div>
          </div>
          <div className="relative hidden h-[150px] md:block" aria-hidden>
            <span className="tile-grad-8 absolute top-2 start-6 h-28 w-28 rounded-full shadow-[inset_0_-14px_24px_rgba(0,0,0,0.12)]" />
            <span className="tile-grad-5 absolute -top-6 end-2 h-16 w-16 rounded-full opacity-90" />
            <span className="tile-grad-3 absolute bottom-[-18px] end-10 h-20 w-20 rounded-full opacity-90" />
            <span className="tile-grad-1 absolute bottom-2 start-0 h-10 w-10 rounded-full opacity-90" />
          </div>
        </div>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-1 text-[16px] font-semibold tracking-tight">
            הקורסים שלי <ChevronLeft size={16} className="text-muted" />
          </h2>
          <Button size="sm" variant="secondary" onClick={onNewCourse}>
            <Plus size={14} /> קורס חדש
          </Button>
        </div>
        {courses.length === 0 ? (
          <Card>
            <Empty icon={<BookOpen size={26} strokeWidth={1.6} />} title="עוד אין קורסים">
              <p>צרו קורס והעלו אליו את חומרי הלימוד, או נסו את אחד מקורסי הדוגמה.</p>
            </Empty>
          </Card>
        ) : (
          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((c) => {
              const sources = engine.store.sources(c.id);
              const concepts = engine.store.concepts(c.id).length;
              const due = engine.store.dueCards(c.id, now).length;
              const d = daysUntil(c.exam_date);
              return (
                <a key={c.id} href={href.course(c.id)} className="-mx-2 flex items-start gap-3 rounded-xl p-2 transition hover:bg-black/[0.03]">
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-black/[0.04]">
                    <span className={`tile-grad-${((c.id - 1) % 8) + 1} grid h-9 w-9 place-items-center rounded-full text-[14px] font-semibold text-ink/75 shadow-[inset_0_-6px_12px_rgba(0,0,0,0.08)]`}>
                      {c.name.trim().charAt(0)}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1 pt-0.5">
                    <span className="block truncate text-[14px] font-medium">{c.name}</span>
                    <span className="block text-[12.5px] text-muted">
                      {sources.length} קבצים · {concepts} מושגים
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {d !== null && (
                        <Badge color={d > 0 && d <= 7 ? "amber" : "slate"}>
                          <CalendarDays size={11} />
                          {d > 0 ? `${d} ימים למבחן` : d === 0 ? "המבחן היום" : "המבחן עבר"}
                        </Badge>
                      )}
                      {due > 0 && (
                        <Badge>
                          <Layers size={11} />
                          {due} לחזרה
                        </Badge>
                      )}
                    </span>
                  </span>
                </a>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function totalDueLine(engine: ReturnType<typeof useEngine>, courses: { id: number }[], now: string) {
  const n = courses.reduce((a, c) => a + engine.store.dueCards(c.id, now).length, 0);
  return n > 0 ? <p className="mt-3 text-[13px] text-muted">יש לכם {n} כרטיסיות לחזרה היום.</p> : null;
}

export function NewCourse({ open, onClose }: { open: boolean; onClose: () => void }) {
  const engine = useEngine();
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  return (
    <Modal open={open} onClose={onClose} title="קורס חדש">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const id = engine.store.createCourse(name.trim(), date || null);
          setName("");
          setDate("");
          onClose();
          go(href.course(id));
        }}
      >
        <Field label="שם הקורס">
          <input autoFocus className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: הסתברות למדמ״ח" />
        </Field>
        <Field label="תאריך המבחן (לא חובה)" help="משמש לתוכנית הלימוד ולספירה לאחור">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" disabled={!name.trim()}>
          יצירה
        </Button>
      </form>
    </Modal>
  );
}
