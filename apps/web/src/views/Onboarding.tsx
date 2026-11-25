import { useState } from "react";
import { ChartLine, ClipboardCheck, FolderOpen, Globe, GraduationCap, Lock, Network, Sparkles, Upload } from "lucide-react";
import { verifyApiKey } from "@ruecai/core";
import { folderSupported, pickFolder, useBrowserStorage, type DataRoot } from "../platform/storage.ts";
import { secrets } from "../platform/secrets.ts";
import { Alert, Badge, Button, Field, IconTile, Spinner, errorMessage, inputClass } from "../ui/components.tsx";
import { switchLanguage, t, useLanguage } from "../i18n.tsx";

/** Three steps, under 3 minutes: storage → API key → start. */
export function Onboarding({ onDone }: { onDone: (root: DataRoot) => void }) {
  const lang = useLanguage();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [root, setRoot] = useState<DataRoot | null>(null);
  const [key, setKey] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canFolder = folderSupported();

  const choose = async (kind: "folder" | "browser") => {
    setError(null);
    try {
      const r = kind === "folder" ? await pickFolder() : await useBrowserStorage();
      setRoot(r);
      setStep(3);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(errorMessage(e));
    }
  };

  const finish = async (demo: boolean) => {
    if (!root) return;
    setError(null);
    if (!demo) {
      setChecking(true);
      const ok = await verifyApiKey(key.trim());
      setChecking(false);
      if (ok !== true) return setError(ok);
      secrets.setApiKey(key.trim());
    }
    secrets.setDemo(demo);
    onDone(root);
  };

  const optionCls =
    "flex w-full items-start gap-3 rounded-xl border border-black/10 bg-white p-4 text-start transition hover:border-black/25 hover:bg-black/[0.015]";
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto flex max-w-[440px] flex-col px-5 pt-[8vh] pb-12">
        <div className="mb-4 flex justify-end gap-3 text-[12.5px]" role="group" aria-label={t("שפה", "Language")}>
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
              className={lang === code ? "font-semibold text-ink underline underline-offset-4" : "text-muted hover:text-ink"}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mb-8 flex items-center justify-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-ink text-white">
            <GraduationCap size={18} strokeWidth={2.2} />
          </span>
          <h1 className="text-[18px] font-semibold tracking-tight">RuecAI Teacher</h1>
        </div>

        <div className="mb-6 flex items-center justify-center gap-1.5" aria-label={t("שלבים", "Steps")}>
          {[1, 2, 3].map((i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${step === i ? "w-6 bg-ink" : step > i ? "w-1.5 bg-ink/40" : "w-1.5 bg-black/10"}`} />
          ))}
        </div>

        {error && (
          <div className="mb-4">
            <Alert kind="error">{error}</Alert>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-[26px] font-semibold leading-tight tracking-tight">{t("ללמוד חכם יותר, מהחומר שלכם", "Study smarter, from your own material")}</h2>
              <p className="mt-2 text-[14px] text-muted">
                {t("עוזר לימודים מבוסס AI לסטודנטים של רייכמן. קוד פתוח, והחומרים נשארים אצלכם.", "An AI study companion for Reichman students. Open source, and your material stays with you.")}
              </p>
            </div>
            <ul className="space-y-2">
              {[
                { icon: <Upload size={18} />, g: 6, text: t("מעלים מצגות, סיכומים ומבחנים לדוגמה מכל קורס", "Upload slides, summaries and sample exams from any course") },
                { icon: <Network size={18} />, g: 3, text: t("מפת מושגים, סיכומים, טוטור שמצטט את החומר, חידונים וכרטיסיות", "Concept maps, summaries, a tutor that cites your material, quizzes and flashcards") },
                { icon: <ClipboardCheck size={18} />, g: 5, text: t("מבחנים חדשים בסגנון המבחנים לדוגמה, עם בדיקה לפי מחוון", "New exams in the style of the sample exams, graded against a rubric") },
                { icon: <ChartLine size={18} />, g: 1, text: t("מעקב שליטה לפי מושג ותוכנית לימוד עד המבחן", "Mastery tracking per concept and a study plan up to the exam") },
              ].map((f) => (
                <li key={f.text} className="flex items-center gap-3 rounded-xl border border-black/[0.06] p-3 text-[13.5px] text-ink-2">
                  <IconTile grad={f.g} size="sm">
                    {f.icon}
                  </IconTile>
                  {f.text}
                </li>
              ))}
            </ul>
            <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted">
              <Lock size={14} className="mt-0.5 shrink-0" />
              <span>
                <b className="font-medium text-ink-2">{t("פרטיות:", "Privacy:")}</b>{" "}
                {t(
                  "אין לנו שרת. הקבצים נשמרים במחשב שלכם, והבקשות ל-AI נשלחות ישירות מהדפדפן ל-Anthropic עם המפתח שלכם.",
                  "We have no server. Your files are saved on your computer, and AI requests go directly from the browser to Anthropic with your key.",
                )}
              </span>
            </p>
            <Button size="lg" className="w-full" onClick={() => setStep(2)}>
              {t("בואו נתחיל", "Let's get started")}
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div className="text-center">
              <h2 className="text-[26px] font-semibold leading-tight tracking-tight">{t("איפה לשמור את הנתונים?", "Where should your data be saved?")}</h2>
              <p className="mt-2 text-[14px] text-muted">{t("הכול נשמר אצלכם. אפשר לשנות את זה אחר כך בהגדרות.", "Everything stays with you. You can change this later in Settings.")}</p>
            </div>
            {canFolder ? (
              <div className="space-y-2.5">
                <button onClick={() => choose("folder")} className={`${optionCls} ring-1 ring-ink/80`}>
                  <IconTile grad={6} size="sm">
                    <FolderOpen size={16} />
                  </IconTile>
                  <span>
                    <span className="flex items-center gap-2 text-[14px] font-medium text-ink">
                      {t("בתיקייה במחשב", "In a folder on your computer")} <Badge>{t("מומלץ", "Recommended")}</Badge>
                    </span>
                    <span className="mt-1 block text-[12.5px] leading-relaxed text-muted">
                      {t("בחרו או צרו תיקייה, למשל", "Choose or create a folder, for example")} <code>{t("מסמכים/RuecAI", "Documents/RuecAI")}</code>.{" "}
                      {t("הנתונים יישמרו בה כקבצים רגילים", "Your data will be saved in it as regular files")} (<code>ruecai.db</code>).{" "}
                      {t("תיקייה בתוך Google Drive או OneDrive גם מגובה וזמינה בכל מחשב.", "A folder inside Google Drive or OneDrive is also backed up and available on any computer.")}
                    </span>
                  </span>
                </button>
                <button onClick={() => choose("browser")} className={optionCls}>
                  <IconTile grad={2} size="sm">
                    <Globe size={16} />
                  </IconTile>
                  <span>
                    <span className="block text-[14px] font-medium text-ink">{t("בתוך הדפדפן", "Inside the browser")}</span>
                    <span className="mt-1 block text-[12.5px] leading-relaxed text-muted">
                      {t("בלי בחירת תיקייה. פחות עמיד: ניקוי נתוני גלישה ימחק הכול, לכן צריך לגבות ידנית.", "No folder needed. Less durable: clearing browsing data deletes everything, so back up manually.")}
                    </span>
                  </span>
                </button>
              </div>
            ) : (
              <>
                <Alert kind="warn">
                  {t(
                    "הדפדפן הזה (Safari/Firefox) לא מאפשר שמירה בתיקייה. הנתונים יישמרו בתוך הדפדפן, ותוכלו לגבות אותם לקובץ.",
                    "This browser (Safari/Firefox) can't save to a folder. Your data will be saved inside the browser, and you can back it up to a file.",
                  )}{" "}
                  <b>{t("מומלץ להשתמש ב-Chrome או Edge.", "We recommend Chrome or Edge.")}</b>
                </Alert>
                <Button size="lg" className="w-full" onClick={() => choose("browser")}>
                  {t("המשך עם שמירה בדפדפן", "Continue with browser storage")}
                </Button>
              </>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div className="text-center">
              <h2 className="text-[26px] font-semibold leading-tight tracking-tight">{t("מפתח API של Claude", "Claude API key")}</h2>
              <p className="mt-2 text-[14px] text-muted">
                {t("צרו מפתח ב-", "Create a key at ")}
                <a className="font-medium text-ink underline underline-offset-2" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                  console.anthropic.com
                </a>{" "}
                {t("והדביקו אותו כאן. המפתח נשמר רק בדפדפן הזה.", "and paste it here. The key is stored only in this browser.")}
              </p>
            </div>
            <Field label={t("מפתח API", "API key")}>
              <input
                type="password"
                dir="ltr"
                autoComplete="off"
                placeholder="sk-ant-..."
                className={`${inputClass} h-11`}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                aria-label={t("מפתח API", "API key")}
              />
            </Field>
            <Button size="lg" className="w-full" disabled={!key.trim() || checking} onClick={() => finish(false)}>
              {checking ? <Spinner label={t("בודק את המפתח…", "Checking the key…")} /> : t("סיום והתחלה", "Finish and start")}
            </Button>
            <div className="flex items-center gap-3 text-[12px] text-slate-400">
              <span className="h-px flex-1 bg-black/[0.08]" /> {t("או", "or")} <span className="h-px flex-1 bg-black/[0.08]" />
            </div>
            <Button variant="secondary" size="lg" className="w-full" onClick={() => finish(true)}>
              <Sparkles size={16} /> {t("אין לי מפתח עדיין: נסו במצב הדגמה", "No key yet? Try demo mode")}
            </Button>
            <p className="text-center text-[12px] text-muted">
              {t("במצב הדגמה התשובות מוקלטות מראש ולא מבוססות על החומר שלכם.", "In demo mode, answers are prerecorded and not based on your material.")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
