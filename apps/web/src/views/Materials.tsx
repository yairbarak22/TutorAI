import { useRef, useState } from "react";
import { ClipboardCheck, ExternalLink, FileText, Repeat, Trash2, Upload } from "lucide-react";
import { useEngine } from "../engine.ts";
import { href } from "../router.ts";
import { Alert, Badge, Button, Card, Empty, Spinner } from "../ui/components.tsx";
import { Select } from "../ui/Select.tsx";
import { LongTask } from "../ui/LongTask.tsx";
import { expectedSeconds } from "../platform/timing.ts";
import { t } from "../i18n.tsx";

const ingestStages = () => [t("קורא את הקובץ", "Reading the file"), t("מנתח נושאים ומושגים", "Analyzing topics and concepts"), t("מוכן", "Ready")];
/** Rough processing time for a file: a fixed part plus a per-MB part (scanned pages and slides take longer). */
const ingestSeconds = (bytes: number, demo: boolean) =>
  demo ? expectedSeconds("ingest:base", true) : expectedSeconds("ingest:base", false) + (bytes / 1048576) * expectedSeconds("ingest:per-mb", false);
import type { Source } from "@ruecai/core";

const status = (): Record<Source["status"], { label: string; color: "slate" | "green" | "amber" | "red" | "blue" }> => ({
  pending: { label: t("בתור", "Queued"), color: "slate" },
  parsing: { label: t("קורא", "Reading"), color: "blue" },
  analyzing: { label: t("מנתח", "Analyzing"), color: "blue" },
  ready: { label: t("מוכן", "Ready"), color: "green" },
  error: { label: t("שגיאה", "Error"), color: "red" },
});

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
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-ink shadow-sm ring-1 ring-black/[0.08]"><Upload size={22} strokeWidth={1.7} /></div>
        <p className="mt-2 font-semibold">{t("גררו לכאן קבצים", "Drop files here")}</p>
        <p className="text-sm text-slate-500">PDF · PowerPoint (PPTX) · Word (DOCX) · TXT/MD. {t("הקבצים נשמרים רק אצלכם.", "Your files stay on your device.")}</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span>{t("סוג:", "Type:")}</span>
            <div className="w-40">
              <Select
                size="sm"
                aria-label={t("סוג הקובץ", "File type")}
                value={kind}
                onChange={(v) => setKind(v as Source["kind"])}
                options={[
                  { value: "material", label: t("חומר לימוד", "Study material") },
                  { value: "sample_exam", label: t("מבחן לדוגמה", "Sample exam") },
                ]}
              />
            </div>
          </div>
          <Button onClick={() => input.current?.click()} disabled={busy}>
            {busy ? <Spinner label={t("מעלה…", "Uploading…")} /> : t("בחירת קבצים", "Choose files")}
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
        <Empty icon={<FileText size={26} strokeWidth={1.6} />} title={t("אין עדיין חומרים", "No materials yet")}>
          {t(
            'העלו מצגות או סיכומים. קבצים ששמם כולל "מבחן" יסומנו אוטומטית כמבחן לדוגמה.',
            'Upload slides or summaries. Files with "exam" in their name are marked as sample exams automatically.',
          )}
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
          {t(`${ready} קבצים מוכנים. אפשר לעבור ל`, `${ready} ${ready === 1 ? "file" : "files"} ready. You can go to the `)}
          <a className="font-semibold underline" href={href.course(courseId, "concepts")}>
            {t("מפת המושגים", "concept map")}
          </a>
          {t(", ל", ", the ")}
          <a className="font-semibold underline" href={href.course(courseId, "studio")}>
            {t("כלים", "tools")}
          </a>{" "}
          {t("או ל", "or the ")}
          <a className="font-semibold underline" href={href.course(courseId, "tutor")}>
            {t("טוטור", "tutor")}
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
  const queuePos = engine.queuePosition(s.id);
  const sections = s.status === "ready" ? engine.store.sectionsOfSource(s.id).length : 0;
  const st = status()[s.status];
  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-3" data-testid="source-row">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink/70 shadow-[inset_0_-6px_12px_rgba(0,0,0,0.08)] ${s.kind === "sample_exam" ? "tile-grad-5" : "tile-grad-6"}`}>
        {s.kind === "sample_exam" ? <ClipboardCheck size={17} /> : <FileText size={17} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[14px] font-medium" dir="auto">
            {s.name}
          </span>
          <Badge color={st.color}>{st.label}</Badge>
          {s.kind === "sample_exam" && <Badge color="amber">{t("מבחן לדוגמה", "Sample exam")}</Badge>}
        </div>
        {(s.status === "parsing" || s.status === "analyzing" || s.status === "pending") && (
          <div className="mt-2">
            {live ? (
              <LongTask
                compact
                title={t(`מעבד את ${s.name}`, `Processing ${s.name}`)}
                stages={ingestStages()}
                stage={live.pct < 0.35 ? 0 : live.pct < 1 ? 1 : 2}
                detail={live.message}
                startedAt={live.startedAt}
                expectedSec={ingestSeconds(s.size, engine.demo)}
                progress={live.pct}
              />
            ) : (
              <div className="flex items-center gap-2 text-[12.5px] text-muted">
                <span className="h-2 w-2 rounded-full bg-black/20" />
                {queuePos === 1
                  ? t("הבא בתור", "Next in line")
                  : queuePos > 1
                    ? t(`ממתין בתור (${queuePos} קבצים לפניו)`, `Waiting in queue (${queuePos} files ahead)`)
                    : t("ממתין לעיבוד…", "Waiting to be processed…")}
              </div>
            )}
          </div>
        )}
        {s.status === "ready" && <div className="text-xs text-slate-500">{t(`${sections} קטעים`, `${sections} ${sections === 1 ? "section" : "sections"}`)} · {(s.size / 1024).toFixed(0)}KB</div>}
        {s.status === "error" && <div className="text-sm text-red-700">{s.error}</div>}
      </div>
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          className="h-7 px-2.5 text-[12.5px]"
          onClick={() => engine.store.setSourceKind(s.id, s.kind === "material" ? "sample_exam" : "material")}
          title={t("החלפת סוג", "Change type")}
        >
          <Repeat size={13} /> {s.kind === "material" ? t("סמן כמבחן", "Mark as exam") : t("סמן כחומר", "Mark as material")}
        </Button>
        <Button size="sm" variant="secondary" className="h-7 px-2.5 text-[12.5px]" onClick={async () => window.open(await engine.sourceUrl(s.id), "_blank", "noopener")}>
          <ExternalLink size={13} /> {t("פתיחה", "Open")}
        </Button>
        {s.status === "error" && (
          <Button size="sm" variant="secondary" onClick={() => engine.retry(s.id)}>
            {t("נסו שוב", "Try again")}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-7! w-7! px-0!"
          onClick={() => confirm(t(`למחוק את "${s.name}"? הקובץ יימחק גם מהתיקייה.`, `Delete "${s.name}"? The file will also be deleted from the folder.`)) && engine.deleteSource(s.id)}
          aria-label={t(`מחיקת ${s.name}`, `Delete ${s.name}`)}
        >
          <Trash2 size={15} />
        </Button>
      </div>
    </div>
  );
}
