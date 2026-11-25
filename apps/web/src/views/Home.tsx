import { useState } from "react";
import { useEngine } from "../engine.ts";
import { go, href } from "../router.ts";
import { Button, Card, Empty, Field, Modal, inputClass } from "../ui/components.tsx";

export function daysUntil(date: string | null): number | null {
  if (!date) return null;
  return Math.ceil((Date.parse(date + "T00:00:00") - Date.now()) / 86_400_000);
}

export function Home() {
  const engine = useEngine();
  const courses = engine.store.courses();
  const [open, setOpen] = useState(false);
  const now = new Date().toISOString();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">הקורסים שלי</h1>
        <Button onClick={() => setOpen(true)}>+ קורס חדש</Button>
      </div>

      {courses.length === 0 ? (
        <Card>
          <Empty icon="🎒" title="עוד אין קורסים">
            <p>צרו קורס והעלו אליו את חומרי הלימוד: מצגות, סיכומים ומבחנים לדוגמה.</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <Button onClick={() => setOpen(true)}>יצירת קורס</Button>
              <Button variant="secondary" onClick={() => go(href.course(engine.loadDemoCourse("probability")))}>
                קורס לדוגמה: הסתברות
              </Button>
              <Button variant="secondary" onClick={() => go(href.course(engine.loadDemoCourse("law")))}>
                קורס לדוגמה: דיני חוזים
              </Button>
            </div>
          </Empty>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => {
            const sources = engine.store.sources(c.id);
            const concepts = engine.store.concepts(c.id).length;
            const due = engine.store.dueCards(c.id, now).length;
            const d = daysUntil(c.exam_date);
            return (
              <a key={c.id} href={href.course(c.id)} className="block">
                <Card className="h-full p-5 transition hover:border-brand-500 hover:shadow">
                  <div className="text-lg font-bold">{c.name}</div>
                  <div className="mt-2 space-y-1 text-sm text-slate-600">
                    <div>📄 {sources.length} קבצים · 🧠 {concepts} מושגים</div>
                    {d !== null && <div>{d > 0 ? `⏳ ${d} ימים למבחן` : d === 0 ? "🔥 המבחן היום!" : "✅ המבחן עבר"}</div>}
                    {due > 0 && <div className="font-medium text-amber-700">🃏 {due} כרטיסיות לחזרה היום</div>}
                  </div>
                </Card>
              </a>
            );
          })}
        </div>
      )}
      {courses.length > 0 && (
        <p className="text-center text-sm text-slate-500">
          רוצים לראות דוגמה?{" "}
          <button className="underline" onClick={() => go(href.course(engine.loadDemoCourse("probability")))}>
            קורס הסתברות לדוגמה
          </button>{" "}
          ·{" "}
          <button className="underline" onClick={() => go(href.course(engine.loadDemoCourse("law")))}>
            קורס דיני חוזים לדוגמה
          </button>
        </p>
      )}
      <NewCourse open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function NewCourse({ open, onClose }: { open: boolean; onClose: () => void }) {
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
