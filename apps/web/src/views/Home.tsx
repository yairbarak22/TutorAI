import { useState, type ReactNode } from "react";
import { ArrowLeft, BookOpen, CalendarDays, ChevronLeft, KeyRound, Layers, Plus, Scale, Sigma } from "lucide-react";
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

const TINTS = ["#ece8f3", "#e4ebe4", "#e7ecef", "#f1ebe4"];

/** Tinted feature card with a big title and a round black arrow button. */
function ActionTile({ tint, art, title, desc, onClick, href: to }: { tint: number; art: ReactNode; title: string; desc: string; onClick?: () => void; href?: string }) {
  const inner = (
    <>
      <span className="grid h-[92px] w-[76px] shrink-0 place-items-center rounded-xl bg-white/60 shadow-[0_8px_20px_-8px_rgba(0,0,0,0.25)]">{art}</span>
      <span className="flex min-w-0 flex-1 flex-col self-stretch">
        <span className="text-[16px] font-semibold leading-snug tracking-tight text-ink">{title}</span>
        <span className="mt-1 text-[12.5px] leading-snug text-ink-2/80">{desc}</span>
        <span className="mt-auto grid h-7 w-7 place-items-center self-end rounded-full bg-ink text-white transition group-hover:-translate-x-0.5">
          <ArrowLeft size={14} />
        </span>
      </span>
    </>
  );
  const cls = "group flex w-full items-start gap-4 rounded-2xl p-3 text-start transition hover:brightness-[0.98]";
  const style = { background: TINTS[tint % TINTS.length] };
  return to ? (
    <a href={to} className={cls} style={style}>
      {inner}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={cls} style={style}>
      {inner}
    </button>
  );
}

const Art = ({ grad, children }: { grad: number; children: ReactNode }) => (
  <span className={`tile-grad-${grad} grid h-12 w-12 place-items-center rounded-full text-ink/75 shadow-[inset_0_-8px_14px_rgba(0,0,0,0.1)]`}>{children}</span>
);

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
        <h2 className="mb-3 flex items-center gap-1 text-[16px] font-semibold tracking-tight">התחלה מהירה</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ActionTile tint={0} art={<Art grad={1}><Plus size={22} /></Art>} title="קורס חדש" desc="יוצרים קורס וגוררים אליו מצגות, סיכומים ומבחנים" onClick={onNewCourse} />
          <ActionTile tint={1} art={<Art grad={3}><Sigma size={22} /></Art>} title="קורס לדוגמה: הסתברות" desc="הרצאות, מושגים וכלים מוכנים לנסות" onClick={() => go(href.course(engine.loadDemoCourse("probability")))} />
          <ActionTile tint={3} art={<Art grad={4}><Scale size={22} /></Art>} title="קורס לדוגמה: דיני חוזים" desc="מבחנים לדוגמה ומבחן חדש באותו סגנון" onClick={() => go(href.course(engine.loadDemoCourse("law")))} />
          <ActionTile tint={2} art={<Art grad={6}><KeyRound size={22} /></Art>} title="מפתח API ומודלים" desc={engine.demo ? "עוברים ממצב הדגמה לעבודה אמיתית" : "מודל, עלויות, גיבוי ושחזור"} href={href.settings()} />
        </div>
      </section>

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
              <p>צרו קורס והעלו אליו את חומרי הלימוד, או נסו את אחד מקורסי הדוגמה למעלה.</p>
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
