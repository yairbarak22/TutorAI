import { useRef, useState } from "react";
import { useEngine } from "../engine.ts";
import { href } from "../router.ts";
import { Alert, Badge, Button, Card, Empty, ProgressBar, Spinner } from "../ui/components.tsx";
import type { Source } from "@ruecai/core";

const STATUS: Record<Source["status"], { label: string; color: "slate" | "green" | "amber" | "red" | "blue" }> = {
  pending: { label: "בתור", color: "slate" },
  parsing: { label: "קורא", color: "blue" },
  analyzing: { label: "מנתח", color: "blue" },
  ready: { label: "מוכן", color: "green" },
  error: { label: "שגיאה", color: "red" },
};

export function Materials({ courseId }: { courseId: number }) {
  const engine = useEngine();
  const sources = engine.store.sources(courseId);
  const [drag, setDrag] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<Source["kind"]>("material");

  const add = async (files: FileList | File[]) => {
    setBusy(true);
    setProblems(await engine.addFiles(courseId, [...files], kind));
    setBusy(false);
  };

  const ready = sources.filter((s) => s.status === "ready").length;

  return (
    <div className="space-y-5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer.files.length) void add(e.dataTransfer.files);
        }}
        className={`rounded-2xl border-2 border-dashed p-8 text-center transition ${drag ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-white"}`}
      >
        <div className="text-4xl">📥</div>
        <p className="mt-2 font-semibold">גררו לכאן קבצים</p>
        <p className="text-sm text-slate-500">PDF · PowerPoint (PPTX) · Word (DOCX) · TXT/MD. הקבצים נשמרים רק אצלכם.</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <label className="text-sm">
            סוג:{" "}
            <select className="rounded border border-slate-300 px-2 py-1" value={kind} onChange={(e) => setKind(e.target.value as Source["kind"])}>
              <option value="material">חומר לימוד</option>
              <option value="sample_exam">מבחן לדוגמה</option>
            </select>
          </label>
          <Button onClick={() => input.current?.click()} disabled={busy}>
            {busy ? <Spinner label="מעלה…" /> : "בחירת קבצים"}
          </Button>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            accept=".pdf,.pptx,.docx,.txt,.md"
            data-testid="file-input"
            onChange={(e) => e.target.files && add(e.target.files).then(() => (e.target.value = ""))}
          />
        </div>
      </div>

      {problems.length > 0 && (
        <Alert kind="warn">
          {problems.map((p) => (
            <div key={p}>{p}</div>
          ))}
        </Alert>
      )}

      {sources.length === 0 ? (
        <Empty icon="📚" title="אין עדיין חומרים">
          העלו מצגות או סיכומים. קבצים ששמם כולל "מבחן" יסומנו אוטומטית כמבחן לדוגמה.
        </Empty>
      ) : (
        <Card className="divide-y divide-slate-100">
          {sources.map((s) => (
            <SourceRow key={s.id} s={s} />
          ))}
        </Card>
      )}

      {ready > 0 && (
        <Alert kind="success">
          {ready} קבצים מוכנים. אפשר לעבור ל
          <a className="font-semibold underline" href={href.course(courseId, "concepts")}>
            מפת המושגים
          </a>
          , ל
          <a className="font-semibold underline" href={href.course(courseId, "studio")}>
            כלים
          </a>{" "}
          או ל
          <a className="font-semibold underline" href={href.course(courseId, "tutor")}>
            טוטור
          </a>
          .
        </Alert>
      )}
    </div>
  );
}

function SourceRow({ s }: { s: Source }) {
  const engine = useEngine();
  const live = engine.ingestStatus.get(s.id);
  const sections = s.status === "ready" ? engine.store.sectionsOfSource(s.id).length : 0;
  const st = STATUS[s.status];
  return (
    <div className="flex flex-wrap items-center gap-3 p-4" data-testid="source-row">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium" dir="auto">
            {s.name}
          </span>
          <Badge color={st.color}>{st.label}</Badge>
          {s.kind === "sample_exam" && <Badge color="amber">מבחן לדוגמה</Badge>}
        </div>
        {(s.status === "parsing" || s.status === "analyzing" || s.status === "pending") && (
          <div className="mt-2 space-y-1">
            <ProgressBar value={live?.pct ?? s.progress} />
            <div className="text-xs text-slate-500 animate-pulse-soft">{live?.message ?? "ממתין…"}</div>
          </div>
        )}
        {s.status === "ready" && <div className="text-xs text-slate-500">{sections} קטעים · {(s.size / 1024).toFixed(0)}KB</div>}
        {s.status === "error" && <div className="text-sm text-red-700">{s.error}</div>}
      </div>
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => engine.store.setSourceKind(s.id, s.kind === "material" ? "sample_exam" : "material")}
          title="החלפת סוג"
        >
          {s.kind === "material" ? "סמן כמבחן" : "סמן כחומר"}
        </Button>
        <Button size="sm" variant="ghost" onClick={async () => window.open(await engine.sourceUrl(s.id), "_blank", "noopener")}>
          פתיחה
        </Button>
        {s.status === "error" && (
          <Button size="sm" variant="secondary" onClick={() => engine.retry(s.id)}>
            נסו שוב
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => confirm(`למחוק את "${s.name}"? הקובץ יימחק גם מהתיקייה.`) && engine.deleteSource(s.id)}
          aria-label={`מחיקת ${s.name}`}
        >
          🗑️
        </Button>
      </div>
    </div>
  );
}
