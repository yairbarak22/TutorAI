import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { Alert, Button, Spinner } from "./components.tsx";

let mermaidReady: Promise<typeof import("mermaid").default> | null = null;
const loadMermaid = () =>
  (mermaidReady ??= import("mermaid").then((m) => {
    // Plain SVG <text> labels (no HTML in foreignObject) → survives strict sanitization.
    m.default.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "neutral",
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      fontFamily: "Segoe UI, Arial Hebrew, sans-serif",
    });
    return m.default;
  }));

let counter = 0;
export function MermaidView({ source }: { source: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSvg(null);
    setError(null);
    loadMermaid()
      .then((m) => m.render(`mmd-${++counter}`, source))
      .then(
        (r) =>
          alive &&
          setSvg(DOMPurify.sanitize(r.svg, { USE_PROFILES: { svg: true, svgFilters: true, html: true }, ADD_TAGS: ["foreignObject"] })),
      )
      .catch((e) => alive && setError(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
  }, [source]);
  if (error)
    return (
      <Alert kind="warn">
        לא הצלחתי לצייר את התרשים. <details><summary>פרטים</summary><pre dir="ltr" className="whitespace-pre-wrap text-xs">{source}</pre></details>
      </Alert>
    );
  if (!svg) return <Spinner label="מצייר…" />;
  return <div className="mermaid-host overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/**
 * Runs model-generated HTML in a locked-down iframe:
 *  - sandbox="allow-scripts" without allow-same-origin → opaque origin, no access to our data or API key
 *  - CSP blocks every network request
 *  - runtime errors are reported back so the tool can self-repair
 */
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";
const REPORTER = `<script>(function(){var sent=false;function r(m){if(sent)return;sent=true;parent.postMessage({ruecaiWidgetError:String(m).slice(0,800)},'*')}
window.addEventListener('error',function(e){r((e.message||'error')+(e.lineno?' (line '+e.lineno+')':''))});
window.addEventListener('unhandledrejection',function(e){r(e.reason&&e.reason.message||e.reason)});
window.addEventListener('load',function(){setTimeout(function(){parent.postMessage({ruecaiWidgetOk:true,height:document.documentElement.scrollHeight},'*')},50)});})();</script>`;

/**
 * Our CSP <meta> is always the very first element of the document, before any model output,
 * so no generated markup can precede or displace it (extra policies can only tighten CSP).
 * The model's own <!doctype>/<html>/<head> that follow are merged/ignored by the HTML parser.
 */
export function buildWidgetDoc(html: string) {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
  return `<!doctype html><html dir="rtl" lang="he"><head>${meta}<meta charset="utf-8">${REPORTER}\n${html}`;
}

export function WidgetFrame({ html, onError, onRepair, repairing }: { html: string; onError?: (e: string) => void; onRepair?: (e: string) => void; repairing?: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(520);
  const [error, setError] = useState<string | null>(null);
  const doc = useMemo(() => buildWidgetDoc(html), [html]);
  useEffect(() => {
    setError(null);
    const onMsg = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) return;
      if (e.data?.ruecaiWidgetError) {
        setError(e.data.ruecaiWidgetError);
        onError?.(e.data.ruecaiWidgetError);
      }
      if (e.data?.ruecaiWidgetOk && e.data.height) setHeight(Math.min(900, Math.max(320, e.data.height + 8)));
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [doc, onError]);
  return (
    <div className="space-y-2">
      <iframe
        ref={ref}
        title="הסבר אינטראקטיבי"
        sandbox="allow-scripts"
        srcDoc={doc}
        className="w-full rounded-lg border border-slate-200 bg-white"
        style={{ height }}
      />
      {error && (
        <Alert kind="warn">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>בווידג'ט יש שגיאה: {error}</span>
            {onRepair && (
              <Button size="sm" variant="secondary" disabled={repairing} onClick={() => onRepair(error)}>
                {repairing ? <Spinner label="מתקן…" /> : "🔧 תקן אוטומטית"}
              </Button>
            )}
          </div>
        </Alert>
      )}
      <p className="text-xs text-slate-500">🔒 רץ בסביבה מבודדת: אין לו גישה לאינטרנט, לקבצים שלכם או למפתח ה-API.</p>
    </div>
  );
}
