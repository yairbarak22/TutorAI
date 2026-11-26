import { useState } from "react";
import { Check, Copy, PlugZap } from "lucide-react";
import { DEFAULT_LOCAL, listLocalModels, type LocalConfig, type LocalFlavor } from "@ruecai/core";
import { secrets } from "../platform/secrets.ts";
import { Alert, Button, Field, Spinner, errorMessage, inputClass } from "./components.tsx";
import { Select } from "./Select.tsx";
import { t } from "../i18n.tsx";

const PORTS: Record<LocalFlavor, string> = { ollama: "http://localhost:11434", openai: "http://localhost:1234" };

/**
 * Connects a model running on the student's computer (Ollama or LM Studio):
 * address → "test connection" lists installed models → pick fast/smart → save.
 */
export function LocalModelSetup({ onSaved, saveLabel }: { onSaved: (cfg: LocalConfig) => void; saveLabel?: string }) {
  const initial = secrets.getLocal() ?? DEFAULT_LOCAL;
  const [cfg, setCfg] = useState<LocalConfig>(initial);
  const [models, setModels] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<LocalConfig>) => setCfg((c) => ({ ...c, ...p }));

  const test = async () => {
    setBusy(true);
    setError(null);
    try {
      const list = await listLocalModels(cfg.baseUrl, cfg.flavor);
      setModels(list);
      if (!list.length) setError(t("השרת פועל אבל אין בו מודלים. התקינו מודל (שלב 2 בהוראות).", "The server is running but has no models. Install one (step 2 below)."));
      const pick = (m: string) => (list.includes(m) ? m : (list[0] ?? ""));
      set({ fast: pick(cfg.fast), smart: pick(cfg.smart || cfg.fast) });
    } catch (e) {
      setModels(null);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const opts = (models ?? []).map((m) => ({ value: m, label: m }));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Field label={t("תוכנה", "Server")}>
          <Select
            value={cfg.flavor}
            onChange={(v) => {
              const flavor = v as LocalFlavor;
              set({ flavor, baseUrl: cfg.baseUrl === PORTS[cfg.flavor] ? PORTS[flavor] : cfg.baseUrl });
              setModels(null);
            }}
            options={[
              { value: "ollama", label: "Ollama" },
              { value: "openai", label: t("LM Studio / תואם OpenAI", "LM Studio / OpenAI-compatible") },
            ]}
          />
        </Field>
        <Field label={t("כתובת", "Address")}>
          <div className="flex gap-2">
            <input dir="ltr" className={inputClass} value={cfg.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} aria-label={t("כתובת השרת", "Server address")} />
            <Button variant="secondary" onClick={test} disabled={busy || !cfg.baseUrl.trim()}>
              {busy ? <Spinner /> : <PlugZap size={15} />} {t("בדיקת חיבור", "Test connection")}
            </Button>
          </div>
        </Field>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {models && models.length > 0 && (
        <>
          <Alert kind="success">{t(`מחובר. נמצאו ${models.length} מודלים.`, `Connected. Found ${models.length} models.`)}</Alert>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("מודל מהיר (ניתוח חומר, כרטיסיות)", "Fast model (reading material, flashcards)")}>
              <Select value={cfg.fast} onChange={(v) => set({ fast: v })} options={opts} />
            </Field>
            <Field label={t("מודל חכם (הסברים, מבחנים, מורה פרטי)", "Smart model (explanations, exams, tutor)")}>
              <Select value={cfg.smart} onChange={(v) => set({ smart: v })} options={opts} />
            </Field>
            <Field label={t("חלון הקשר", "Context window")} help={t("גדול יותר = יותר חומר בכל בקשה, אבל איטי יותר וצורך יותר זיכרון.", "Larger = more material per request, but slower and uses more memory.")}>
              <Select
                value={String(cfg.contextTokens)}
                onChange={(v) => set({ contextTokens: Number(v) })}
                options={[
                  { value: "8192", label: t("8K (מחשב חלש)", "8K (low-end computer)") },
                  { value: "16384", label: t("16K (מומלץ)", "16K (recommended)") },
                  { value: "32768", label: "32K" },
                  { value: "65536", label: t("64K (דורש זיכרון רב)", "64K (needs a lot of memory)") },
                ]}
              />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-[13px] text-ink-2">
              <input type="checkbox" checked={cfg.vision} onChange={(e) => set({ vision: e.target.checked })} />
              {t("המודל המהיר מבין תמונות (לפענוח עמודים סרוקים)", "The fast model reads images (for scanned pages)")}
            </label>
          </div>
          <Button
            onClick={() => {
              secrets.setLocal(cfg);
              onSaved(cfg);
            }}
            disabled={!cfg.fast || !cfg.smart}
          >
            {saveLabel ?? t("שמירה", "Save")}
          </Button>
        </>
      )}

      <SetupGuide flavor={cfg.flavor} />
    </div>
  );
}

function SetupGuide({ flavor }: { flavor: LocalFlavor }) {
  const origin = typeof location !== "undefined" ? location.origin : "";
  return (
    <details className="rounded-xl border border-black/[0.08] bg-black/[0.015] px-4 py-3 text-[13px] leading-6 text-ink-2">
      <summary className="cursor-pointer font-medium text-ink">{t("איך מתקינים? (פעם אחת, כ-10 דקות)", "How to set it up (once, ~10 minutes)")}</summary>
      {flavor === "ollama" ? (
        <ol className="mt-3 list-decimal space-y-3 ps-5">
          <li>
            {t("התקינו את Ollama מ-", "Install Ollama from ")}
            <a className="underline" href="https://ollama.com/download" target="_blank" rel="noreferrer">
              ollama.com/download
            </a>
            .
          </li>
          <li>
            {t("התקינו מודל לפי הזיכרון במחשב (בטרמינל):", "Install a model that fits your computer's memory (in a terminal):")}
            <ul className="mt-1 space-y-1.5">
              <li className="flex flex-wrap items-center gap-1.5">
                <span>{t("מחשב עם 8GB זיכרון", "8GB of memory")}</span> <Cmd>ollama pull qwen3:4b</Cmd>
              </li>
              <li className="flex flex-wrap items-center gap-1.5">
                <span>{t("מחשב עם 16GB (מומלץ)", "16GB (recommended)")}</span> <Cmd>ollama pull qwen3:8b</Cmd> {t("או", "or")} <Cmd>ollama pull gemma3:12b</Cmd>
              </li>
              <li className="flex flex-wrap items-center gap-1.5">
                <span>{t("מחשב עם 32GB ומעלה", "32GB or more")}</span> <Cmd>ollama pull qwen3:14b</Cmd> {t("או", "or")} <Cmd>ollama pull gemma3:27b</Cmd>
              </li>
            </ul>
            <p className="mt-1 text-xs text-muted">{t("Gemma 3 מבין גם תמונות. העברית של מודלים מקומיים טובה פחות מזו של Claude.", "Gemma 3 also reads images. Local models are weaker in Hebrew than Claude.")}</p>
          </li>
          <li>
            {t("אשרו לאתר הזה לדבר עם Ollama, ואז סגרו ופתחו מחדש את Ollama:", "Allow this site to talk to Ollama, then quit and reopen Ollama:")}
            <ul className="mt-1 space-y-1">
              <li className="flex flex-wrap items-center gap-1.5">
                <span>Mac</span> <Cmd>{`launchctl setenv OLLAMA_ORIGINS "${origin}"`}</Cmd>
              </li>
              <li className="flex flex-wrap items-center gap-1.5">
                <span>Windows</span> <Cmd>{`setx OLLAMA_ORIGINS "${origin}"`}</Cmd>
              </li>
              <li className="flex flex-wrap items-center gap-1.5">
                <span>Linux</span> <Cmd>{`OLLAMA_ORIGINS="${origin}" ollama serve`}</Cmd>
              </li>
            </ul>
          </li>
          <li>{t("לחצו על \"בדיקת חיבור\" למעלה.", "Click \"Test connection\" above.")}</li>
        </ol>
      ) : (
        <ol className="mt-3 list-decimal space-y-2 ps-5">
          <li>
            {t("התקינו את LM Studio מ-", "Install LM Studio from ")}
            <a className="underline" href="https://lmstudio.ai" target="_blank" rel="noreferrer">
              lmstudio.ai
            </a>{" "}
            {t("והורידו מודל (למשל Qwen3 8B או Gemma 3 12B).", "and download a model (e.g. Qwen3 8B or Gemma 3 12B).")}
          </li>
          <li>{t("בלשונית Developer: הפעילו את השרת (Start server) ואת האפשרות Enable CORS.", "In the Developer tab: start the server and turn on Enable CORS.")}</li>
          <li>{t("לחצו על \"בדיקת חיבור\" למעלה.", "Click \"Test connection\" above.")}</li>
        </ol>
      )}
    </details>
  );
}

function Cmd({ children }: { children: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-white px-1.5 py-0.5 align-middle ring-1 ring-black/[0.08]" dir="ltr">
      <code className="truncate font-mono text-[12px]">{children}</code>
      <button
        type="button"
        aria-label={t("העתקה", "Copy")}
        className="cursor-pointer text-muted hover:text-ink"
        onClick={() => {
          void navigator.clipboard?.writeText(children);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        }}
      >
        {done ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </span>
  );
}
