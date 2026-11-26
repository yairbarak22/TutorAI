import { useEffect, useRef, useState } from "react";
import type { InputSpec, LoadedTool, ToolManifest } from "@tutorai/sdk";
import { useEngine } from "../engine.ts";
import { go, href } from "../router.ts";
import { Camera, ScanLine, Search, Sparkles, X } from "lucide-react";
import { ArrowBack, ChevronForward, t, toolText } from "../i18n.tsx";
import { Alert, Badge, Button, Card, Field, errorMessage, inputClass } from "../ui/components.tsx";
import { ToolOrb, ToolTile } from "../ui/toolIcons.tsx";
import { LongTask } from "../ui/LongTask.tsx";
import { Select } from "../ui/Select.tsx";
import { expectedChars, expectedSeconds, recordRun } from "../platform/timing.ts";

const packLabel = (p: string): string =>
  ({
    core: t("כלי ליבה", "Core tools"),
    law: t("חבילת משפטים", "Law pack"),
    math: t("חבילת מתמטיקה ומקצועות כמותיים", "Math & quantitative pack"),
  })[p] ?? t(`חבילת ${p}`, `${p} pack`);
const packChip = (p: string): string => ({ core: t("ליבה", "Core"), law: t("משפטים", "Law"), math: t("מתמטיקה", "Math") })[p] ?? p;

export function Studio({ courseId, preselect }: { courseId: number; preselect?: string }) {
  const engine = useEngine();
  const [toolId, query] = (preselect ?? "").split("?");
  const preset = Object.fromEntries(new URLSearchParams(query ?? ""));
  const [selected, setSelected] = useState<string | null>(toolId || null);
  useEffect(() => {
    setSelected(toolId || null);
  }, [toolId]);

  const tools = engine.tools.filter((x) => x.manifest.output !== "chat");
  const packs = [...new Set(tools.map((x) => x.manifest.pack))];
  const tool = tools.find((x) => x.manifest.id === selected);
  const [q, setQ] = useState("");
  const [pack, setPack] = useState("all");
  const hasMaterial = engine.store.sources(courseId).some((s) => s.status === "ready");

  if (tool) return <ToolRunner key={tool.manifest.id + JSON.stringify(preset)} courseId={courseId} tool={tool} preset={preset} onBack={() => go(href.course(courseId, "studio"))} />;

  const shown = tools.filter(
    (x) => (pack === "all" || x.manifest.pack === pack) && (!q.trim() || `${toolText(x.manifest).name} ${toolText(x.manifest).description}`.includes(q.trim())),
  );
  return (
    <div className="space-y-6">
      {!hasMaterial && (
        <Alert kind="info">
          {t("כדי שהכלים יעבדו על החומר שלכם,", "For the tools to work on your material,")}{" "}
          <a className="underline" href={href.course(courseId, "materials")}>
            {t("העלו קבצים", "upload files")}
          </a>{" "}
          {t("קודם.", "first.")}
        </Alert>
      )}
      <div className="space-y-3">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input className={`${inputClass} h-10 ps-10`} placeholder={t("חיפוש כלים…", "Search tools…")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("חיפוש כלים", "Search tools")} />
        </div>
        <div className="flex flex-wrap gap-2">
          {["all", ...packs].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPack(p)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition ${
                pack === p ? "border-ink bg-ink text-white" : "border-black/10 bg-white text-ink-2 hover:bg-hover"
              }`}
            >
              {p === "all" ? t("כל הכלים", "All tools") : packChip(p)}
            </button>
          ))}
        </div>
      </div>
      {packs
        .filter((p) => shown.some((x) => x.manifest.pack === p))
        .map((p) => (
          <section key={p}>
            <h2 className="mb-2 flex items-center gap-1 text-[16px] font-semibold tracking-tight">
              {packLabel(p)} <ChevronForward size={16} className="text-muted" />
            </h2>
            <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
              {shown
                .filter((x) => x.manifest.pack === p)
                .map((x) => (
                  <a
                    key={x.manifest.id}
                    href={href.course(courseId, "studio", x.manifest.id)}
                    data-testid={`tool-${x.manifest.id}`}
                    className="-mx-2 flex items-start gap-3 rounded-xl p-2 transition hover:bg-black/[0.03]"
                  >
                    <ToolOrb id={x.manifest.id} emoji={x.manifest.icon} />
                    <span className="min-w-0 flex-1 pt-0.5">
                      <span className="flex items-center gap-2 text-[14px] font-medium text-ink">
                        {toolText(x.manifest).name}
                        {x.manifest.kind === "declarative" && <Badge>{t("ללא קוד", "No code")}</Badge>}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-muted">{toolText(x.manifest).description}</span>
                    </span>
                  </a>
                ))}
            </div>
          </section>
        ))}
      {shown.length === 0 && <p className="py-8 text-center text-[13px] text-muted">{t("לא נמצאו כלים.", "No tools found.")}</p>}
      <p className="text-center text-[13px] text-muted">
        {t("רוצים להוסיף כלי? כל כלי הוא תיקייה עם קובץ הגדרות ופרומפט.", "Want to add a tool? Each tool is a folder with a settings file and a prompt.")}{" "}
        <a className="underline" href="https://github.com/yairbarak22/TutorAI/blob/main/docs/plugins.md" target="_blank" rel="noreferrer">
          {t("המדריך לכתיבת כלי", "Guide to writing a tool")}
        </a>
      </p>
    </div>
  );
}

function ToolRunner({ courseId, tool, preset, onBack }: { courseId: number; tool: LoadedTool; preset: Record<string, string>; onBack: () => void }) {
  const engine = useEngine();
  const course = engine.store.course(courseId)!;
  const init: Record<string, string | number> = {};
  for (const i of tool.manifest.inputs) init[i.name] = preset[i.name] ?? (i.name === "exam_date" ? course.exam_date ?? "" : i.name === "minutes_per_day" ? course.minutes_per_day : (i.default ?? ""));
  const [params, setParams] = useState(init);
  const [running, setRunning] = useState<{ pct: number; msg: string; chars: number; startedAt: number } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const key = `tool:${tool.manifest.id}`;
  const isCheck = tool.manifest.output === "solution_check";
  const [error, setError] = useState<string | null>(null);
  const missing = tool.manifest.inputs.filter((i) => i.required && !String(params[i.name] ?? "").trim());

  const run = async () => {
    setError(null);
    const startedAt = Date.now();
    let chars = 0;
    setRunning({ pct: 0.02, msg: t("מתחיל…", "Starting…"), chars: 0, startedAt });
    try {
      const res = await engine.run(
        tool.manifest.id,
        courseId,
        params,
        (pct, msg) => alive.current && setRunning((r) => (r ? { ...r, pct, msg } : r)),
        (n) => {
          chars = n;
          if (alive.current) setRunning((r) => (r ? { ...r, chars: n } : r));
        },
      );
      recordRun(key, (Date.now() - startedAt) / 1000, chars, engine.demo);
      // Only jump to the result if the student is still on this screen.
      if (alive.current && res.kind === "artifact") go(href.course(courseId, "artifacts", res.artifactId));
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      if (alive.current) setRunning(null);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
        <ArrowBack size={14} /> {t("כל הכלים", "All tools")}
      </button>
      <Card className="space-y-5 p-6">
        <div className="flex items-start gap-4">
          <ToolTile id={tool.manifest.id} emoji={tool.manifest.icon} size="lg" />
          <div>
            <h2 className="text-[20px] font-semibold tracking-tight">{toolText(tool.manifest).name}</h2>
            <p className="mt-1 text-[13.5px] text-muted">{toolText(tool.manifest).description}</p>
          </div>
        </div>
        {tool.manifest.inputs.map((input) => (
          <InputControl key={input.name} input={input} manifest={tool.manifest} courseId={courseId} value={params[input.name] ?? ""} onChange={(v) => setParams({ ...params, [input.name]: v })} />
        ))}
        {error && <Alert kind="error">{error}</Alert>}
        {running ? (
          <LongTask
            title={
              isCheck ? t("בודק את הפתרון שלכם", "Checking your solution") : t(`יוצר ${toolText(tool.manifest).name}`, `Creating ${toolText(tool.manifest).name}`)
            }
            stages={
              isCheck
                ? [t("Claude קורא את הפתרון", "Claude reads your solution"), t("אימות החישובים ב-SymPy", "Verifying the math with SymPy"), t("כתיבת רמזים", "Writing hints")]
                : [t("אוסף חומר מהקורס", "Gathering course material"), t(`${engine.writer} כותב`, `${engine.writer} is writing`), t("בודק ציטוטים ושומר", "Checking citations and saving")]
            }
            stage={
              isCheck
                ? running.pct >= 1 ? 3 : running.pct >= 0.75 ? 2 : running.pct >= 0.55 ? 1 : 0
                : running.pct >= 1 ? 3 : running.chars > 0 || running.pct >= 0.2 ? 1 : 0
            }
            detail={running.chars > 0 && ["יוצר…", "Generating…"].includes(running.msg) ? t(`${engine.writer} כותב…`, `${engine.writer} is writing…`) : running.msg}
            startedAt={running.startedAt}
            expectedSec={expectedSeconds(key, engine.demo)}
            chars={running.chars}
            expectedChars={expectedChars(key)}
            hint={
              <>
                {t("אפשר להמשיך לעבוד בלשוניות אחרות בזמן הזה. כשזה יסתיים, התוצר יישמר בעמוד", "You can keep working in other tabs meanwhile. When it's done, the result will be saved on the")}{" "}
                <a className="font-medium underline" href={href.course(courseId, "artifacts")}>
                  {t("תוצרים", "Outputs")}
                </a>
                {t(".", " page.")}
              </>
            }
          />
        ) : (
          <Button size="lg" className="w-full" onClick={run} disabled={missing.length > 0}>
            {tool.manifest.output === "solution_check" ? (
              <>
                <ScanLine size={16} /> {t("בדיקת הפתרון", "Check my solution")}
              </>
            ) : (
              <>
                <Sparkles size={16} /> {t("יצירה", "Create")}
              </>
            )}
          </Button>
        )}
      </Card>
    </div>
  );
}

function InputControl({
  input,
  manifest,
  value,
  onChange,
  courseId,
}: {
  input: InputSpec;
  manifest: ToolManifest;
  value: string | number;
  onChange: (v: string | number) => void;
  courseId: number;
}) {
  const engine = useEngine();
  const tx = toolText(manifest);
  let control;
  if (input.type === "select")
    control = (
      <Select
        value={String(value)}
        onChange={onChange}
        options={(input.options ?? []).map((o) => ({ value: o, label: tx.option(input.name, o) }))}
      />
    );
  else if (input.type === "source")
    control = (
      <Select
        value={String(value)}
        onChange={onChange}
        options={[
          { value: "all", label: t("כל החומרים", "All materials") },
          ...engine.store
            .sources(courseId)
            .filter((s) => s.status === "ready" && s.kind === "material")
            .map((s) => ({ value: String(s.id), label: s.name })),
        ]}
      />
    );
  else if (input.type === "concept")
    control = (
      <Select
        value={String(value)}
        onChange={onChange}
        options={[
          { value: "", label: t("כל המושגים", "All concepts") },
          ...engine.store.concepts(courseId).map((c) => ({ value: c.name, label: c.name, hint: c.name_en || undefined })),
        ]}
      />
    );
  else if (input.type === "image") control = <ImageInput value={String(value || "")} onChange={onChange} />;
  else if (input.type === "number")
    control = <input type="number" min={0} className={inputClass} value={value} onChange={(e) => onChange(Number(e.target.value))} />;
  else if (input.type === "textarea")
    control = <textarea rows={6} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} />;
  else control = <input className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} />;
  return (
    <Field label={tx.label(input.name) + (input.required ? " *" : "")} help={tx.help(input.name)}>
      {control}
    </Field>
  );
}

/** Downscale a photo to ≤1600px JPEG so it is fast to send and small to store. */
async function toJpegDataUrl(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

function ImageInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (f?: File) => {
    if (!f || !f.type.startsWith("image/")) return;
    setBusy(true);
    try {
      onChange(await toJpegDataUrl(f));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="rounded-xl border border-dashed border-black/15 bg-sidebar p-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void pick(e.dataTransfer.files[0]);
      }}
    >
      <input ref={ref} type="file" accept="image/*" capture="environment" hidden data-testid="image-input" onChange={(e) => void pick(e.target.files?.[0])} />
      {value ? (
        <div className="flex items-center gap-3">
          <img src={value} alt="" className="h-20 w-20 rounded-lg border border-black/10 object-cover" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => ref.current?.click()}>
              <Camera size={14} /> {t("החלפת תמונה", "Replace photo")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onChange("")}>
              <X size={14} /> {t("הסרה", "Remove")}
            </Button>
          </div>
        </div>
      ) : (
        <button type="button" className="flex w-full items-center gap-3 text-start" onClick={() => ref.current?.click()} disabled={busy}>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-ink shadow-sm ring-1 ring-black/[0.08]">
            <Camera size={18} />
          </span>
          <span>
            <span className="block text-[13.5px] font-medium">{busy ? t("מכין את התמונה…", "Preparing the photo…") : t("צילום או העלאת תמונה", "Take or upload a photo")}</span>
            <span className="block text-[12px] text-muted">{t("כתב יד ברור, באור טוב. אפשר גם לגרור לכאן.", "Clear handwriting, good light. You can also drop it here.")}</span>
          </span>
        </button>
      )}
    </div>
  );
}
