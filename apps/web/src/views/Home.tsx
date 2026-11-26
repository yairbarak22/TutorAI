import { useState } from "react";
import { ArrowUp, BookOpen, Box, CalendarDays, ClipboardCheck, Ellipsis, FileText, Flame, Layers, ListChecks, Plus, ScanLine, Trash2, Zap } from "lucide-react";
import { localDay } from "@ruecai/core";
import { useEngine } from "../engine.ts";
import { go, href } from "../router.ts";
import { Badge, Button, Card, Empty, Field, Modal, inputClass } from "../ui/components.tsx";
import { ChevronForward, t } from "../i18n.tsx";

export function daysUntil(date: string | null): number | null {
  if (!date) return null;
  return Math.ceil((Date.parse(date + "T00:00:00") - Date.now()) / 86_400_000);
}

function greeting() {
  const h = new Date().getHours();
  return h < 5
    ? t("לילה טוב", "Good night")
    : h < 12
      ? t("בוקר טוב", "Good morning")
      : h < 17
        ? t("צהריים טובים", "Good afternoon")
        : h < 21
          ? t("ערב טוב", "Good evening")
          : t("לילה טוב", "Good night");
}

const quick = () => [
  { id: "summary", label: t("סיכום", "Summary"), icon: FileText },
  { id: "quiz", label: t("חידון", "Quiz"), icon: ListChecks },
  { id: "flashcards", label: t("כרטיסיות", "Flashcards"), icon: Layers },
  { id: "explainer", label: t("הסבר בתלת-ממד", "3D explainer"), icon: Box },
  { id: "check-solution", label: t("בדיקת פתרון", "Check work"), icon: ScanLine },
  { id: "exam-from-samples", label: t("מבחן", "Exam"), icon: ClipboardCheck },
  { id: "study-plan", label: t("תוכנית", "Plan"), icon: CalendarDays },
  { id: "", label: t("עוד", "More"), icon: Ellipsis },
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
        <h1 className="text-[28px] font-medium tracking-tight">{greeting()}, {t("מה לומדים היום?", "what are we learning today?")}</h1>
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
            placeholder={course ? t(`שאלו את המורה הפרטי על ${course.name}…`, `Ask the tutor about ${course.name}…`) : t("צרו קורס כדי לשאול את המורה הפרטי…", "Create a course to ask the tutor…")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={t("שאלה למורה הפרטי", "Question for the tutor")}
          />
          {course && <span className="hidden rounded-md bg-black/[0.05] px-1.5 text-[11px] font-medium leading-5 text-ink-2 sm:inline">{course.name.split(" ")[0]}</span>}
          <button type="submit" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink text-white disabled:bg-slate-300" disabled={!q.trim()} aria-label={t("שליחה", "Send")}>
            <ArrowUp size={16} />
          </button>
        </form>
        {course ? <TodayCard courseId={course.id} /> : totalDueLine(engine, courses, now)}
      </div>

      <div className="mx-auto grid max-w-[720px] grid-cols-4 gap-y-5 sm:grid-cols-8">
        {quick().map((x) => (
          <a
            key={x.label}
            href={course ? href.course(course.id, "studio", x.id || undefined) : "#/"}
            onClick={(e) => {
              if (!course) {
                e.preventDefault();
                onNewCourse();
              }
            }}
            className="group flex flex-col items-center gap-2 text-[12.5px] font-medium text-ink-2"
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl border border-black/10 bg-white text-ink shadow-sm transition group-hover:border-black/25 group-hover:shadow">
              <x.icon size={18} strokeWidth={1.8} />
            </span>
            {x.label}
          </a>
        ))}
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-1 text-[16px] font-semibold tracking-tight">
            {t("הקורסים שלי", "My courses")} <ChevronForward size={16} className="text-muted" />
          </h2>
          <Button size="sm" variant="secondary" onClick={onNewCourse}>
            <Plus size={14} /> {t("קורס חדש", "New course")}
          </Button>
        </div>
        {courses.length === 0 ? (
          <Card>
            <Empty icon={<BookOpen size={26} strokeWidth={1.6} />} title={t("עוד אין קורסים", "No courses yet")}>
              <p>{t("צרו קורס והעלו אליו את חומרי הלימוד, או נסו את אחד מקורסי הדוגמה.", "Create a course and upload your study materials, or try one of the sample courses.")}</p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <Button size="sm" onClick={() => go(href.course(engine.loadDemoCourse("probability")))}>
                  {t("קורס לדוגמה: הסתברות", "Sample course: Probability")}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => go(href.course(engine.loadDemoCourse("law")))}>
                  {t("קורס לדוגמה: דיני חוזים", "Sample course: Contract law")}
                </Button>
              </div>
            </Empty>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((c) => {
              const sources = engine.store.sources(c.id);
              const concepts = engine.store.concepts(c.id).length;
              const due = engine.store.dueCards(c.id, now).length;
              const d = daysUntil(c.exam_date);
              return (
                <div key={c.id} className="group relative rounded-2xl border border-black/[0.08] bg-white transition hover:border-black/20 hover:shadow-sm">
                <a href={href.course(c.id)} className="flex items-start gap-3 rounded-2xl p-3 pe-11">
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-black/[0.04]">
                    <span className={`tile-grad-${((c.id - 1) % 8) + 1} grid h-9 w-9 place-items-center rounded-full text-[14px] font-semibold text-ink/75 shadow-[inset_0_-6px_12px_rgba(0,0,0,0.08)]`}>
                      {c.name.trim().charAt(0)}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1 pt-0.5">
                    <span className="block truncate text-[14px] font-medium">{c.name}</span>
                    <span className="block text-[12.5px] text-muted">
                      {t(`${sources.length === 1 ? "קובץ אחד" : `${sources.length} קבצים`} · ${concepts === 1 ? "מושג אחד" : `${concepts} מושגים`}`, `${sources.length} ${sources.length === 1 ? "file" : "files"} · ${concepts} ${concepts === 1 ? "concept" : "concepts"}`)}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {d !== null && (
                        <Badge color={d > 0 && d <= 7 ? "amber" : "slate"}>
                          <CalendarDays size={11} />
                          {d > 0 ? t(d === 1 ? "המבחן מחר" : `${d} ימים למבחן`, `${d} ${d === 1 ? "day" : "days"} to exam`) : d === 0 ? t("המבחן היום", "Exam today") : t("המבחן עבר", "Exam passed")}
                        </Badge>
                      )}
                      {due > 0 && (
                        <Badge>
                          <Layers size={11} />
                          {t(`${due} לחזרה`, `${due} to review`)}
                        </Badge>
                      )}
                    </span>
                  </span>
                </a>
                <button
                  type="button"
                  onClick={() => void engine.deleteCourse(c.id)}
                  aria-label={t(`מחיקת הקורס ${c.name}`, `Delete course ${c.name}`)}
                  title={t("מחיקת הקורס", "Delete course")}
                  className="absolute top-2.5 end-2.5 grid h-8 w-8 cursor-pointer place-items-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600 focus-visible:text-red-600"
                >
                  <Trash2 size={15} />
                </button>
                </div>
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
  return n > 0 ? <p className="mt-3 text-[13px] text-muted">{t(n === 1 ? "יש לכם כרטיסייה אחת לחזרה היום." : `יש לכם ${n} כרטיסיות לחזרה היום.`, `You have ${n} ${n === 1 ? "flashcard" : "flashcards"} to review today.`)}</p> : null;
}

export function NewCourse({ open, onClose }: { open: boolean; onClose: () => void }) {
  const engine = useEngine();
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  return (
    <Modal open={open} onClose={onClose} title={t("קורס חדש", "New course")}>
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
        <Field label={t("שם הקורס", "Course name")}>
          <input autoFocus className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("למשל: הסתברות למדמ״ח", "e.g. Probability for CS")} />
        </Field>
        <Field label={t("תאריך המבחן (לא חובה)", "Exam date (optional)")} help={t("משמש לתוכנית הלימוד ולספירה לאחור", "Used for the study plan and the countdown")}>
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" disabled={!name.trim()}>
          {t("יצירה", "Create")}
        </Button>
      </form>
    </Modal>
  );
}

/** "Today's session" entry point: what is waiting, how long it takes, and the streak. */
function TodayCard({ courseId }: { courseId: number }) {
  const engine = useEngine();
  const p = engine.sessionPreview(courseId);
  const items = p.mistakes.length + p.cards.length + p.weak.length * 2 + p.mixed.length;
  const streak = engine.streak(courseId);
  const doneToday = engine.store.sessionDays(courseId)[0] === localDay();
  if (!items && !streak) return null;
  return (
    <a
      href={href.course(courseId, "session")}
      className="group mt-4 flex items-center gap-3 rounded-2xl border border-black/[0.08] bg-white p-3 text-start transition hover:border-black/15 hover:shadow"
      data-testid="today-card"
    >
      <span className="tile-grad-5 grid h-10 w-10 shrink-0 place-items-center rounded-xl text-ink/80">
        <Zap size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium">
          {doneToday ? t("הסשן של היום הושלם", "Today's session is done") : t("הסשן היומי שלכם", "Your daily session")}
        </span>
        <span className="block text-[12.5px] text-muted">
          {doneToday
            ? t("כל הכבוד! אפשר לתרגל עוד אם בא לכם.", "Nice work! You can practice more if you like.")
            : items
              ? t(`${items} פריטים · כ-${p.minutes} דק'`, `${items} items · ~${p.minutes} min`) +
                (p.mistakes.length ? t(` · ${p.mistakes.length} טעויות לתיקון`, ` · ${p.mistakes.length} mistakes to fix`) : "")
              : t("אין עוד מה לתרגל היום", "Nothing more to practice today")}
        </span>
      </span>
      {streak > 0 && (
        <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-amber-700">
          <Flame size={14} /> {streak}
        </span>
      )}
      {items > 0 && (
        <span
          className={`inline-flex h-8 items-center gap-1 rounded-[10px] px-3 text-[13px] font-medium ${doneToday ? "border border-black/10 text-ink-2" : "bg-ink text-white"}`}
        >
          {doneToday ? t("עוד סשן", "Another one") : t("התחלה", "Start")}
        </span>
      )}
    </a>
  );
}
