import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { useEngine } from "../engine.ts";
import { download, forgetStorage, importBackup } from "../platform/storage.ts";
import { isPlanProvider, secrets, type Provider } from "../platform/secrets.ts";
import { localServer } from "../platform/local-server.ts";
import { PLAN_MODEL_PREFIX } from "@tutorai/local-api";
import { ConnectionPicker, type Choice } from "../ui/ConnectionPicker.tsx";
import { ModelPicker } from "../ui/ModelPicker.tsx";
import { priceOf } from "../platform/models.ts";
import { LocalComputerRows } from "../ui/LocalComputer.tsx";
import { ApiKeyForm } from "../ui/ApiKey.tsx";
import { Alert, Badge, Button, Row, Tabs, errorMessage } from "../ui/components.tsx";
import { fmtTime, switchLanguage, t, useLanguage } from "../i18n.tsx";

export function Settings() {
  const engine = useEngine();
  const lang = useLanguage();
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const usage = engine.store.usageTotals();
  const cost = usage.reduce((n, u) => {
    const p = priceOf(u.model);
    return p ? n + (u.input * p[0] + u.output * p[1]) / 1e6 : n;
  }, 0);
  const hasKey = !!secrets.getApiKey();
  const [provider, setProvider] = useState<Provider>(secrets.getProvider());
  const local = localServer();
  const planUsage = usage.filter((u) => u.model.startsWith(PLAN_MODEL_PREFIX));

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
          <Row
            title={t("חיבור ה-AI", "AI connection")}
            desc={t("בחרו איזה חשבון AI יש לכם. יופיעו רק ההגדרות שלו.", "Choose which AI account you have. Only its settings are shown.")}
            wide
          >
            <div className="mt-3">
              <ConnectionPicker
                mode="settings"
                active={engine.demo ? undefined : (engine.provider as Choice)}
                onChosen={(c) => {
                  if (c === "demo") return;
                  secrets.setProvider(c);
                  setProvider(c);
                  secrets.setDemo(false);
                  engine.configureLLM();
                  setMsg({
                    kind: "success",
                    text:
                      c === "chatgpt"
                        ? t("עובדים עם מנוי ChatGPT שלכם.", "Using your ChatGPT plan.")
                        : c === "claude-code"
                          ? t("עובדים עם מנוי Claude שלכם.", "Using your Claude plan.")
                          : c === "claude"
                            ? t("עובדים עם מפתח ה-API.", "Using your API key.")
                            : t("המודל המקומי נשמר.", "Local model saved."),
                  });
                }}
              />
            </div>
          </Row>
          {/* Key management and model choice only for an API key that's in use (the picker connects it). */}
          {!engine.demo && (engine.provider === "claude" || engine.provider === "hybrid") && (
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
            desc={t("איזה מודל עושה כל עבודה. אפשר להשאיר את המומלץ.", "Which model does each job. You can keep the recommended ones.")}
            wide
          >
            <div className="mt-3">
              <ModelPicker
                kind="claude"
                wide
                onSaved={() => {
                  engine.configureLLM();
                  setMsg({ kind: "success", text: t("המודלים עודכנו.", "Models updated.") });
                }}
              />
            </div>
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
