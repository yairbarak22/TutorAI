import { useState, type ReactNode } from "react";
import { ArrowLeft, BookOpen, CalendarDays, KeyRound, Layers, Plus, Scale, Sigma } from "lucide-react";
import { useEngine } from "../engine.ts";
import { go, href } from "../router.ts";
import { Badge, Button, Card, Empty, Field, IconTile, Modal, SectionLabel, inputClass } from "../ui/components.tsx";
import { CourseMark } from "../ui/Shell.tsx";

export function daysUntil(date: string | null): number | null {
  if (!date) return null;
  return Math.ceil((Date.parse(date + "T00:00:00") - Date.now()) / 86_400_000);
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "לילה טוב" : h < 12 ? "בוקר טוב" : h < 17 ? "צהריים טובים" : h < 21 ? "ערב טוב" : "לילה טוב";
}

function ActionTile({ grad, icon, title, desc, onClick, href: to }: { grad: number; icon: ReactNode; title: string; desc: string; onClick?: () => void; href?: string }) {
  const inner = (
    <>
      <IconTile grad={grad}>{icon}</IconTile>
      <span className="min-w-0">
        <span className="block text-[14px] font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{desc}</span>
      </span>
    </>
  );
  const cls = "flex w-full items-start gap-3 rounded-2xl border border-black/[0.08] bg-white p-4 text-start transition hover:border-black/15 hover:bg-black/[0.015]";
  return to ? (
    <a href={to} className={cls}>
      {inner}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

export function Home({ onNewCourse }: { onNewCourse: () => void }) {
  const engine = useEngine();
  const courses = engine.store.courses();
  const now = new Date().toISOString();
  const totalDue = courses.reduce((n, c) => n + engine.store.dueCards(c.id, now).length, 0);

  return (
    <div className="space-y-10">
      <div>
        <p className="text-[13px] text-muted">סביבת הלמידה שלכם</p>
        <h1 className="mt-1 text-[30px] font-semibold leading-tight tracking-tight">{greeting()}</h1>
        {totalDue > 0 && <p className="mt-1 text-sm text-muted">יש לכם {totalDue} כרטיסיות לחזרה היום.</p>}
      </div>

      <section>
        <SectionLabel>התחלה מהירה</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ActionTile grad={1} icon={<Plus size={20} />} title="קורס חדש" desc="יוצרים קורס וגוררים אליו מצגות, סיכומים ומבחנים" onClick={onNewCourse} />
          <ActionTile grad={3} icon={<Sigma size={20} />} title="קורס לדוגמה: הסתברות" desc="הרצאות לדוגמה, מושגים וכלים מוכנים לנסות" onClick={() => go(href.course(engine.loadDemoCourse("probability")))} />
          <ActionTile grad={4} icon={<Scale size={20} />} title="קורס לדוגמה: דיני חוזים" desc="מבחנים לדוגמה ומבחן חדש באותו סגנון" onClick={() => go(href.course(engine.loadDemoCourse("law")))} />
          <ActionTile grad={6} icon={<KeyRound size={20} />} title="מפתח API ומודלים" desc={engine.demo ? "עוברים ממצב הדגמה לעבודה אמיתית" : "מודל, עלויות, גיבוי ושחזור"} href={href.settings()} />
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[17px] font-semibold tracking-tight">הקורסים שלי</h2>
          <Button size="sm" variant="secondary" onClick={onNewCourse}>
            <Plus size={14} /> קורס חדש
          </Button>
        </div>
        {courses.length === 0 ? (
          <Card>
            <Empty icon={<BookOpen size={26} strokeWidth={1.6} />} title="עוד אין קורסים">
              <p>צרו קורס והעלו אליו את חומרי הלימוד, או נסו את אחד מקורסי הדוגמה למעלה.</p>
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
                <a key={c.id} href={href.course(c.id)} className="group block rounded-2xl border border-black/[0.08] bg-white p-4 transition hover:border-black/15 hover:shadow">
                  <div className="flex items-start gap-3">
                    <CourseMark id={c.id} name={c.name} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-medium">{c.name}</div>
                      <div className="mt-0.5 text-[12.5px] text-muted">
                        {sources.length} קבצים · {concepts} מושגים
                      </div>
                    </div>
                    <ArrowLeft size={16} className="mt-1 text-slate-300 transition group-hover:-translate-x-0.5 group-hover:text-ink" />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {d !== null && (
                      <Badge color={d > 0 && d <= 7 ? "amber" : "slate"}>
                        <CalendarDays size={12} />
                        {d > 0 ? `${d} ימים למבחן` : d === 0 ? "המבחן היום" : "המבחן עבר"}
                      </Badge>
                    )}
                    {due > 0 && (
                      <Badge color="blue">
                        <Layers size={12} />
                        {due} לחזרה היום
                      </Badge>
                    )}
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
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
