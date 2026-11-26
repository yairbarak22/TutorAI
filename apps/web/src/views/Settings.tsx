import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { DEFAULT_MODELS } from "@tutorai/core";
import { useEngine } from "../engine.ts";
import { download, forgetStorage, importBackup } from "../platform/storage.ts";
import { isPlanProvider, secrets, type Provider } from "../platform/secrets.ts";
import { localServer } from "../platform/local-server.ts";
import { PLAN_MODEL_PREFIX } from "@tutorai/local-api";
import { ChatGptPlanCard, ClaudePlanCard } from "../ui/ConnectionCards.tsx";
import { LocalComputerRows } from "../ui/LocalComputer.tsx";
import { InstallLocal } from "../ui/InstallLocal.tsx";
import { LocalModelSetup } from "../ui/LocalModelSetup.tsx";
import { ApiKeyForm } from "../ui/ApiKey.tsx";
import { Alert, Badge, Button, Field, Row, Tabs, errorMessage, inputClass } from "../ui/components.tsx";
import { fmtTime, switchLanguage, t, useLanguage } from "../i18n.tsx";

/** Rough cost estimate (USD per 1M tokens: input/output) for the defaults. */
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

export function Settings() {
  const engine = useEngine();
  const lang = useLanguage();
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const models = secrets.getModels() ?? DEFAULT_MODELS;
  const [fast, setFast] = useState(models.fast);
  const [smart, setSmart] = useState(models.smart);
  const restoreInput = useRef<HTMLInputElement>(null);
  const usage = engine.store.usageTotals();
  const cost = usage.reduce((n, u) => {
    const p = PRICES[u.model];
    return p ? n + (u.input * p[0] + u.output * p[1]) / 1e6 : n;
  }, 0);
  const hasKey = !!secrets.getApiKey();
  const [provider, setProvider] = useState<Provider>(secrets.getProvider());
  const local = localServer();
  const planUsage = usage.filter((u) => u.model.startsWith(PLAN_MODEL_PREFIX));
  const usePlan = (p: "claude-code" | "chatgpt") => {
    secrets.setProvider(p);
    setProvider(p);
    secrets.setDemo(false);
    engine.configureLLM();
    setMsg({ kind: "success", text: p === "chatgpt" ? t("עובדים עם מנוי ChatGPT שלכם.", "Using your ChatGPT plan.") : t("עובדים עם מנוי Claude שלכם.", "Using your Claude plan.") });
  };

  const [tab, setTab] = useState<"ai" | "data" | "about">("ai");
  return (
    <div className="max-w-3xl">
      <h1 className="text-[24px] font-semibold tracking-tight">{t("הגדרות", "Settings")}</h1>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: "ai", label: t("מודל AI", "AI model") },
          { id: "data", label: t("נתונים וגיבוי", "Data & backup") },
          { id: "about", label: t("אודות", "About") },
        ]}
      />
      {msg && (
        <div className="mt-4">
          <Alert kind={msg.kind}>{msg.text}</Alert>
        </div>
      )}

      {tab === "ai" && (
        <div>
          <Row
            title={t("שפה", "Language")}
            desc={t("שפת הממשק והתוכן שה-AI יוצר.", "Interface language and the language AI-generated content is written in.")}
            action={
              <div className="flex gap-1.5" role="group" aria-label={t("שפה", "Language")}>
                {([
                  ["he", "עברית"],
                  ["en", "English"],
                ] as const).map(([code, label]) => (
                  <button
                    key={code}
                    type="button"
                    lang={code}
                    aria-pressed={lang === code}
                    onClick={() => switchLanguage(code)}
                    className={`h-8 rounded-full border px-3 text-[13px] transition-colors ${
                      lang === code ? "border-ink bg-ink text-white" : "border-black/10 bg-white text-ink-2 hover:bg-hover"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
          />
          <Row
            title={t("מצב", "Status")}
            desc={
              {
                demo: t("מצב הדגמה: התשובות מוקלטות מראש ולא מבוססות על החומר שלכם.", "Demo mode: answers are prerecorded and not based on your material."),
                claude: t("מחובר ל-Claude עם המפתח שלכם.", "Connected to Claude with your key."),
                local: t("עובד עם מודל מקומי במחשב שלכם, בלי עלות.", "Using a local model on your computer, at no cost."),
                hybrid: t("היברידי: מודל מקומי לעבודה המהירה, Claude להסברים ולמבחנים.", "Hybrid: a local model for fast work, Claude for explanations and exams."),
                "claude-code": t("מחובר למנוי Claude שלכם דרך Claude Code.", "Connected to your Claude plan through Claude Code."),
                chatgpt: t("מחובר למנוי ChatGPT שלכם.", "Connected to your ChatGPT plan."),
              }[engine.provider]
            }
            action={
              hasKey || secrets.getLocal() || (local && isPlanProvider(provider)) ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    secrets.setDemo(!engine.demo);
                    engine.configureLLM();
                  }}
                >
                  {engine.demo ? t("כיבוי מצב הדגמה", "Turn off demo mode") : t("מעבר למצב הדגמה", "Switch to demo mode")}
                </Button>
              ) : (
                <Badge color="amber">{t("הדגמה", "Demo")}</Badge>
              )
            }
          />
          {!local && (
            <Row title={t("להשתמש במנוי Claude או ChatGPT", "Use your Claude or ChatGPT plan")} wide>
              <div className="mt-3">
                <InstallLocal />
              </div>
            </Row>
          )}
          <Row
            title={t("מאיפה מגיע המודל", "Where the model runs")}
            desc={t("מודל מקומי רץ על המחשב שלכם וחוסך את כל העלות, אבל איטי יותר וחלש יותר בעברית.", "A local model runs on your computer and costs nothing, but it is slower and weaker in Hebrew.")}
            wide
          >
            <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={t("ספק המודל", "Model provider")}>
              {([
                ...(local
                  ? ([
                      ["chatgpt", t("מנוי ChatGPT", "ChatGPT plan")],
                      ["claude-code", t("מנוי Claude", "Claude plan")],
                    ] as const)
                  : []),
                ["claude", local ? t("מפתח API של Claude", "Claude API key") : t("Claude (בענן)", "Claude (cloud)")],
                ["local", t("מקומי בלבד (חינם)", "Local only (free)")],
                ["hybrid", t("היברידי (מקומי + Claude)", "Hybrid (local + Claude)")],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={provider === id}
                  onClick={() => {
                    setProvider(id);
                    // A plan becomes active only from its card ("Use my plan"), once it's connected.
                    if (isPlanProvider(id)) return;
                    secrets.setProvider(id);
                    if (id === "claude" || secrets.getLocal()) {
                      secrets.setDemo(false);
                      engine.configureLLM();
                    }
                  }}
                  className={`h-8 cursor-pointer rounded-full border px-3 text-[13px] transition-colors ${
                    provider === id ? "border-ink bg-ink text-white" : "border-black/10 bg-white text-ink-2 hover:bg-hover"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {provider === "hybrid" && (
              <p className="mt-2 text-xs text-muted">
                {t("ניתוח קבצים, מושגים וכרטיסיות רצים מקומית (רוב השימוש); הסברים, מבחנים ובדיקה לפי מחוון עוברים ל-Claude. צריך גם מפתח API.", "File analysis, concepts and flashcards run locally (most of the usage); explanations, exams and rubric grading go to Claude. Needs an API key too.")}
              </p>
            )}
            {provider === "chatgpt" && (
              <div className="mt-4">
                <ChatGptPlanCard active={engine.provider === "chatgpt"} onReady={() => usePlan("chatgpt")} />
              </div>
            )}
            {provider === "claude-code" && (
              <div className="mt-4">
                <ClaudePlanCard active={engine.provider === "claude-code"} onReady={() => usePlan("claude-code")} />
              </div>
            )}
            {(provider === "local" || provider === "hybrid") && (
              <div className="mt-4">
                <LocalModelSetup
                  onSaved={() => {
                    secrets.setDemo(false);
                    engine.configureLLM();
                    setMsg({ kind: "success", text: t("המודל המקומי נשמר.", "Local model saved.") });
                  }}
                />
              </div>
            )}
          </Row>
          {(provider === "claude" || provider === "hybrid") && (
            <>
          <Row
            title={hasKey ? t("החלפת מפתח API", "Replace API key") : t("מפתח API", "API key")}
            desc={
              !hasKey
                ? t("המפתח לא נשמר בתיקיית הנתונים ולא בשום שרת.", "The key is never stored in your data folder or on any server.")
                : secrets.keyIsSessionOnly()
                  ? t("המפתח שמור רק עד שתסגרו את הלשונית.", "The key is kept only until you close the tab.")
                  : t("המפתח שמור בדפדפן הזה בלבד.", "The key is saved in this browser only.")
            }
            wide
          >
            <div className="mt-3">
              <ApiKeyForm
                submitLabel={t("שמירת מפתח", "Save key")}
                defaultRemember={!secrets.keyIsSessionOnly()}
                onSaved={() => {
                  secrets.setDemo(false);
                  engine.configureLLM();
                  setMsg({ kind: "success", text: t("המפתח נשמר. מצב הדגמה כובה.", "Key saved. Demo mode turned off.") });
                }}
              />
              {hasKey && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    secrets.clearApiKey();
                    engine.configureLLM();
                    setMsg({ kind: "success", text: t("המפתח נמחק מהדפדפן.", "The key was deleted from this browser.") });
                  }}
                >
                  {t("מחיקת המפתח", "Delete key")}
                </Button>
              )}
            </div>
          </Row>
          <Row
            title={t("מודלים", "Models")}
            desc={t("מודל מהיר לניתוח החומר ולכרטיסיות, ומודל חכם להסברים ולמבחנים.", "A fast model for extraction and flashcards, and a smart model for explanations and exams.")}
            wide
          >
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label={t("מודל מהיר", "Fast model")}>
                <input dir="ltr" className={inputClass} value={fast} onChange={(e) => setFast(e.target.value)} />
              </Field>
              <Field label={t("מודל חכם", "Smart model")}>
                <input dir="ltr" className={inputClass} value={smart} onChange={(e) => setSmart(e.target.value)} />
              </Field>
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              onClick={() => {
                secrets.setModels({ fast: fast.trim() || DEFAULT_MODELS.fast, smart: smart.trim() || DEFAULT_MODELS.smart });
                engine.configureLLM();
                setMsg({ kind: "success", text: t("המודלים עודכנו.", "Models updated.") });
              }}
            >
              {t("שמירת מודלים", "Save models")}
            </Button>
          </Row>
            </>
          )}
          <Row
            title={t("שימוש ועלות", "Usage and cost")}
            desc={
              usage.length
                ? usage.map((u) => t(`${u.model.replace(PLAN_MODEL_PREFIX, "")}: ${Math.round((u.input + u.output) / 1000)}K טוקנים`, `${u.model.replace(PLAN_MODEL_PREFIX, "")}: ${Math.round((u.input + u.output) / 1000)}K tokens`)).join(" · ")
                : t("עוד לא היה שימוש במודל.", "The model hasn't been used yet.")
            }
            action={cost > 0 ? <span className="text-[13px] font-medium" dir="ltr">≈ ${cost.toFixed(2)}</span> : planUsage.length ? <Badge>{t("כלול במנוי", "Included in your plan")}</Badge> : undefined}
          />
        </div>
      )}

      {tab === "data" && (
        <div>
          {engine.persistence.lastError && (
            <div className="mt-4">
              <Alert kind="error">
                {t("שמירה נכשלה:", "Save failed:")} {engine.persistence.lastError}
              </Alert>
            </div>
          )}
          {local && <LocalComputerRows folderLabel={engine.root.files.label} />}
          {!local && <Row
            title={t("מיקום השמירה", "Storage location")}
            desc={
              engine.root.mode === "folder" ? (
                <>
                  {t("תיקייה", "Folder")} <b className="font-medium text-ink-2">{engine.root.files.label}</b>, {t("בקובץ", "in the file")} <code>tutorai.db</code>{" "}
                  {t("ובתיקיית", "and the folder")} <code>courses/</code>.
                </>
              ) : (
                t("בתוך הדפדפן הזה. גבו לקובץ מדי פעם.", "Inside this browser. Back up to a file from time to time.")
              )
            }
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  if (!confirm(t("להתנתק מהתיקייה הנוכחית ולבחור מקום אחר? הנתונים בתיקייה לא יימחקו.", "Disconnect from the current folder and choose another location? The data in the folder will not be deleted."))) return;
                  await engine.persistence.flush();
                  await forgetStorage();
                  location.hash = "";
                  location.reload();
                }}
              >
                {t("החלפת מיקום", "Change location")}
              </Button>
            }
          />}
          <Row
            title={t("שמירה אחרונה", "Last saved")}
            desc={engine.persistence.lastSaved ? fmtTime(engine.persistence.lastSaved) : t("עוד לא נשמר", "Not saved yet")}
          />
          <Row
            title={t("גיבוי", "Backup")}
            desc={t("קובץ ‎.tutorai‎ אחד עם כל הקורסים, הקבצים וההתקדמות.", "A single .tutorai file with all courses, files and progress.")}
            action={
              <Button variant="secondary" size="sm" onClick={async () => download(await engine.backup(), `tutorai-backup-${new Date().toISOString().slice(0, 10)}.tutorai`)}>
                <Download size={14} /> {t("הורדת גיבוי", "Download backup")}
              </Button>
            }
          />
          <Row
            title={t("שחזור", "Restore")}
            desc={t("מחליף את כל הנתונים הנוכחיים בנתונים מקובץ הגיבוי.", "Replaces all current data with the data from the backup file.")}
            action={
              <>
                <Button variant="secondary" size="sm" onClick={() => restoreInput.current?.click()}>
                  <Upload size={14} /> {t("שחזור מגיבוי", "Restore from backup")}
                </Button>
                <input
                  ref={restoreInput}
                  type="file"
                  accept=".tutorai,.ruecai,.zip"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (!confirm(t("השחזור יחליף את כל הנתונים הנוכחיים בנתונים מהגיבוי. להמשיך?", "Restoring will replace all current data with the data from the backup. Continue?"))) return;
                    try {
                      const db = await importBackup(engine.root, f);
                      await engine.root.files.write("tutorai.db", db);
                      location.reload();
                    } catch (err) {
                      setMsg({ kind: "error", text: errorMessage(err) });
                    }
                  }}
                />
              </>
            }
          />
        </div>
      )}

      {tab === "about" && (
        <div>
          <Row title="TutorAI" desc={t(
              "פרויקט קוד פתוח (Apache-2.0) שנבנה יחד עם סטודנטים. אין שרת ואין איסוף נתונים: הקבצים נשמרים אצלכם, והבקשות ל-AI נשלחות ישירות ל-Anthropic.",
              "An open-source project (Apache-2.0), built together with students. No server and no data collection: your files stay with you, and AI requests go directly to Anthropic.",
            )} />
          <Row
            title={t("יושרה אקדמית", "Academic integrity")}
            desc={t(
              "השימוש כפוף לכללי היושרה האקדמית של האוניברסיטה. הכלי נועד ללמידה, לא להגשת עבודות במקומכם.",
              "Use is subject to the university's academic integrity rules. The tool is for learning, not for submitting work on your behalf.",
            )}
          />
          <Row
            title={t("קוד המקור", "Source code")}
            desc={t("דיווח על באגים, רעיונות לכלים ותרומות קוד.", "Bug reports, tool ideas and code contributions.")}
            action={
              <a href="https://github.com/yairbarak22/TutorAI" target="_blank" rel="noreferrer">
                <Button variant="secondary" size="sm">
                  GitHub
                </Button>
              </a>
            }
          />
        </div>
      )}
    </div>
  );
}
