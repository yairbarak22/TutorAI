import { useEffect, useState } from "react";
import type { InputSpec, LoadedTool } from "@ruecai/sdk";
import { useEngine } from "../engine.ts";
import { go, href } from "../router.ts";
import { ArrowRight, Sparkles } from "lucide-react";
import { Alert, Badge, Button, Card, Field, ProgressBar, SectionLabel, errorMessage, inputClass } from "../ui/components.tsx";
import { ToolTile } from "../ui/toolIcons.tsx";

const PACK_LABEL: Record<string, string> = { core: "כלי ליבה (לכל הקורסים)", law: "חבילת משפטים", math: "חבילת מתמטיקה וכמותי" };

export function Studio({ courseId, preselect }: { courseId: number; preselect?: string }) {
  const engine = useEngine();
  const [toolId, query] = (preselect ?? "").split("?");
  const preset = Object.fromEntries(new URLSearchParams(query ?? ""));
  const [selected, setSelected] = useState<string | null>(toolId || null);
  useEffect(() => {
    setSelected(toolId || null);
  }, [toolId]);

  const tools = engine.tools.filter((t) => t.manifest.output !== "chat");
  const packs = [...new Set(tools.map((t) => t.manifest.pack))];
  const tool = tools.find((t) => t.manifest.id === selected);
  const hasMaterial = engine.store.sources(courseId).some((s) => s.status === "ready");

  if (tool) return <ToolRunner key={tool.manifest.id + JSON.stringify(preset)} courseId={courseId} tool={tool} preset={preset} onBack={() => go(href.course(courseId, "studio"))} />;

  return (
    <div className="space-y-6">
      {!hasMaterial && (
        <Alert kind="info">
          כדי שהכלים יעבדו על החומר שלכם, <a className="underline" href={href.course(courseId, "materials")}>העלו קבצים</a> קודם.
        </Alert>
      )}
      {packs.map((pack) => (
        <section key={pack}>
          <SectionLabel>{PACK_LABEL[pack] ?? `חבילת ${pack}`}</SectionLabel>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tools
              .filter((t) => t.manifest.pack === pack)
              .map((t) => (
                <a
                  key={t.manifest.id}
                  href={href.course(courseId, "studio", t.manifest.id)}
                  data-testid={`tool-${t.manifest.id}`}
                  className="group flex items-start gap-3 rounded-2xl border border-black/[0.08] bg-white p-4 transition hover:border-black/15 hover:shadow"
                >
                  <ToolTile id={t.manifest.id} emoji={t.manifest.icon} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[14px] font-medium text-ink">{t.manifest.name}</span>
                      {t.manifest.kind === "declarative" && <Badge>ללא קוד</Badge>}
                    </span>
                    <span className="mt-1 block text-[12.5px] leading-relaxed text-muted">{t.manifest.description}</span>
                  </span>
                </a>
              ))}
          </div>
        </section>
      ))}
      <p className="text-center text-[13px] text-muted">
        רוצים להוסיף כלי? כל כלי הוא תיקייה עם קובץ הגדרות ופרומפט.{" "}
        <a className="underline" href="https://github.com/yairbarak22/RuecAI_Tutor/blob/main/docs/plugins.md" target="_blank" rel="noreferrer">
          המדריך לכתיבת כלי
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
  const [running, setRunning] = useState<{ pct: number; msg: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const missing = tool.manifest.inputs.filter((i) => i.required && !String(params[i.name] ?? "").trim());

  const run = async () => {
    setError(null);
    setRunning({ pct: 0.02, msg: "מתחיל…" });
    try {
      const res = await engine.run(tool.manifest.id, courseId, params, (pct, msg) => setRunning({ pct, msg }));
      if (res.kind === "artifact") go(href.course(courseId, "artifacts", res.artifactId));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
        <ArrowRight size={14} /> כל הכלים
      </button>
      <Card className="space-y-5 p-6">
        <div className="flex items-start gap-4">
          <ToolTile id={tool.manifest.id} emoji={tool.manifest.icon} size="lg" />
          <div>
            <h2 className="text-[20px] font-semibold tracking-tight">{tool.manifest.name}</h2>
            <p className="mt-1 text-[13.5px] text-muted">{tool.manifest.description}</p>
          </div>
        </div>
        {tool.manifest.inputs.map((input) => (
          <InputControl key={input.name} input={input} courseId={courseId} value={params[input.name] ?? ""} onChange={(v) => setParams({ ...params, [input.name]: v })} />
        ))}
        {error && <Alert kind="error">{error}</Alert>}
        {running ? (
          <div className="space-y-2" role="status">
            <ProgressBar value={running.pct} />
            <div className="text-sm text-ink-2 animate-pulse-soft">{running.msg}</div>
            <div className="text-xs text-slate-400">זה יכול לקחת עד דקה. אפשר להמשיך לעבוד בלשוניות אחרות.</div>
          </div>
        ) : (
          <Button size="lg" className="w-full" onClick={run} disabled={missing.length > 0}>
            <Sparkles size={16} /> יצירה
          </Button>
        )}
      </Card>
    </div>
  );
}

function InputControl({ input, value, onChange, courseId }: { input: InputSpec; value: string | number; onChange: (v: string | number) => void; courseId: number }) {
  const engine = useEngine();
  let control;
  if (input.type === "select")
    control = (
      <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {input.options?.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    );
  else if (input.type === "source")
    control = (
      <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="all">כל החומרים</option>
        {engine.store
          .sources(courseId)
          .filter((s) => s.status === "ready" && s.kind === "material")
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
      </select>
    );
  else if (input.type === "concept")
    control = (
      <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">כל המושגים</option>
        {engine.store.concepts(courseId).map((c) => (
          <option key={c.id}>{c.name}</option>
        ))}
      </select>
    );
  else if (input.type === "number")
    control = <input type="number" min={0} className={inputClass} value={value} onChange={(e) => onChange(Number(e.target.value))} />;
  else if (input.type === "textarea")
    control = <textarea rows={6} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} />;
  else control = <input className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} />;
  return (
    <Field label={input.label + (input.required ? " *" : "")} help={input.help}>
      {control}
    </Field>
  );
}
