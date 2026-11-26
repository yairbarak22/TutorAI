import { useState } from "react";
import { Check, Copy, PlugZap, Sparkles } from "lucide-react";
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

      {cfg.flavor === "ollama" && <ClaudeSetupPrompt />}
      <SetupGuide flavor={cfg.flavor} />
    </div>
  );
}

/** The setup instructions as a prompt for Claude (Claude Code / Claude with computer access) to carry out. */
export function setupPrompt(origin: string): string {
  return t(
    `עזור לי להריץ מודל AI מקומי עם Ollama במחשב הזה, כדי שאתר הלימודים ${origin} יוכל להשתמש בו. בצע את השלבים בעצמך ובדוק כל שלב:

1. בדוק איזו מערכת הפעלה יש וכמה זיכרון (RAM) יש במחשב.
2. אם Ollama לא מותקן, התקן אותו (https://ollama.com/download) וודא שהוא רץ.
3. התקן מודל לפי הזיכרון (אם כבר מותקן מודל מתאים, אל תוריד שוב):
   - מחשב עם עד 8GB זיכרון: qwen3:4b
   - מחשב עם 16GB זיכרון: qwen3:8b
   - מחשב עם 32GB זיכרון ומעלה: qwen3:14b
4. אפשר לאתר לפנות ל-Ollama: הגדר את משתנה הסביבה OLLAMA_ORIGINS כך שיכלול את ${origin}. אם כבר יש בו ערכים, הוסף עם פסיק ואל תמחק אותם. ההגדרה צריכה להישמר גם אחרי הפעלה מחדש של המחשב (ב-macOS: LaunchAgent שמריץ launchctl setenv בכניסה; ב-Windows: setx; ב-Linux: override ל-systemd של ollama).
5. הפעל מחדש את Ollama כדי שיקרא את ההגדרה (ב-macOS: לסגור את האפליקציה לגמרי ולפתוח שוב).
6. בדוק שזה עובד: curl -i -H "Origin: ${origin}" http://localhost:11434/api/tags צריך להחזיר 200 עם Access-Control-Allow-Origin: ${origin}.

בסוף כתוב לי בקצרה מה עשית ואיזה מודל לבחור באתר.`,
    `Help me run a local AI model with Ollama on this computer, so the study site ${origin} can use it. Do the steps yourself and check each one:

1. Check the operating system and how much memory (RAM) the computer has.
2. If Ollama isn't installed, install it (https://ollama.com/download) and make sure it's running.
3. Install a model that fits the memory (if a suitable one is already installed, don't download again):
   - up to 8GB: qwen3:4b
   - 16GB: qwen3:8b
   - 32GB or more: qwen3:14b
4. Allow the site to reach Ollama: set the OLLAMA_ORIGINS environment variable so it includes ${origin}. If it already has values, append with a comma and keep them. The setting must survive a restart (macOS: a LaunchAgent that runs launchctl setenv at login; Windows: setx; Linux: a systemd override for ollama).
5. Restart Ollama so it reads the setting (macOS: quit the app completely and reopen it).
6. Verify: curl -i -H "Origin: ${origin}" http://localhost:11434/api/tags should return 200 with Access-Control-Allow-Origin: ${origin}.

Finally, tell me briefly what you did and which model to pick on the site.`,
  );
}

function ClaudeSetupPrompt() {
  const [copied, setCopied] = useState(false);
  const text = setupPrompt(typeof location !== "undefined" ? location.origin : "");
  return (
    <div className="rounded-xl border border-black/[0.08] bg-white p-4" data-testid="claude-setup-prompt">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[14px] font-medium text-ink">
            <Sparkles size={15} /> {t("הכי פשוט: תנו ל-Claude להתקין", "Easiest: let Claude set it up")}
          </div>
          <p className="mt-1 text-[12.5px] leading-5 text-muted">
            {t(
              "העתיקו את ההנחיה והדביקו ב-Claude Code או באפליקציית Claude עם גישה למחשב. היא מתקינה את Ollama ומודל שמתאים למחשב, ומאשרת לאתר הזה לגשת אליו.",
              "Copy the prompt and paste it into Claude Code or the Claude app with computer access. It installs Ollama and a model that fits your computer, and allows this site to reach it.",
            )}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t("הועתק", "Copied") : t("העתקת ההנחיה", "Copy prompt")}
        </Button>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-[12.5px] text-muted hover:text-ink">{t("מה כתוב בהנחיה?", "What does the prompt say?")}</summary>
        <pre dir="auto" className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/[0.03] p-3 font-sans text-[12.5px] leading-5 text-ink-2">
          {text}
        </pre>
      </details>
    </div>
  );
}

function SetupGuide({ flavor }: { flavor: LocalFlavor }) {
  const origin = typeof location !== "undefined" ? location.origin : "";
  return (
    <details className="rounded-xl border border-black/[0.08] bg-black/[0.015] px-4 py-3 text-[13px] leading-6 text-ink-2">
      <summary className="cursor-pointer font-medium text-ink">{t("התקנה ידנית (פעם אחת, כ-10 דקות)", "Manual setup (once, ~10 minutes)")}</summary>
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
