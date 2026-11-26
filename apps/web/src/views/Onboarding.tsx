import { useRef, useState } from "react";
import { ChartLine, ClipboardCheck, FolderOpen, Globe, GraduationCap, Lock, Network, Upload } from "lucide-react";
import { folderSupported, importBackup, pickFolder, serverRoot, useBrowserStorage, type DataRoot } from "../platform/storage.ts";
import { secrets } from "../platform/secrets.ts";
import { localServer } from "../platform/local-server.ts";
import { ConnectionPicker } from "../ui/ConnectionPicker.tsx";
import { Alert, Badge, Button, IconTile, errorMessage } from "../ui/components.tsx";
import { switchLanguage, t, useLanguage } from "../i18n.tsx";

/** Three steps, under 3 minutes: welcome → storage (skipped in TutorAI Local) → connect the AI. */
export function Onboarding({ onDone }: { onDone: (root: DataRoot) => void }) {
  const lang = useLanguage();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [root, setRoot] = useState<DataRoot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canFolder = folderSupported();
  const local = localServer();
  const backupInput = useRef<HTMLInputElement>(null);

  /** TutorAI Local: the data folder is set up by the server, so skip the storage step. */
  const start = async () => {
    if (!local) return setStep(2);
    try {
      setRoot(await serverRoot());
      setStep(3);
    } catch (e) {
      setError(errorMessage(e));
    }
  };



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

  /** The key itself is verified and saved by ApiKeyForm. */
  const finish = (demo: boolean) => {
    if (!root) return;
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
          <h1 className="text-[18px] font-semibold tracking-tight">TutorAI</h1>
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
                {t("עוזר לימודים מבוסס AI לסטודנטים. קוד פתוח, והחומרים נשארים אצלכם.", "An AI study companion for students. Open source, and your material stays with you.")}
              </p>
            </div>
            <ul className="space-y-2">
              {[
                { icon: <Upload size={18} />, g: 6, text: t("מעלים מצגות, סיכומים ומבחנים לדוגמה מכל קורס", "Upload slides, summaries and sample exams from any course") },
                { icon: <Network size={18} />, g: 3, text: t("מפת מושגים, סיכומים, מורה פרטי שמצטט את החומר, חידונים וכרטיסיות", "Concept maps, summaries, a tutor that cites your material, quizzes and flashcards") },
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
            <Button size="lg" className="w-full" onClick={() => void start()}>
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
                      {t("בחרו או צרו תיקייה, למשל", "Choose or create a folder, for example")} <code>{t("מסמכים/TutorAI", "Documents/TutorAI")}</code>.{" "}
                      {t("הנתונים יישמרו בה כקבצים רגילים", "Your data will be saved in it as regular files")} (<code>tutorai.db</code>).{" "}
                      {t("תיקייה ב-Google Drive או ב-OneDrive גם מגובה וגם זמינה מכל מחשב.", "A folder inside Google Drive or OneDrive is also backed up and available on any computer.")}
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
                      {t("בלי בחירת תיקייה. פחות בטוח: ניקוי נתוני הגלישה ימחק הכול, ולכן צריך לגבות ידנית.", "No folder needed. Less durable: clearing browsing data deletes everything, so back up manually.")}
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
              <h2 className="text-[26px] font-semibold leading-tight tracking-tight">{t("איך לחבר את ה-AI?", "How do you want to connect the AI?")}</h2>
              <p className="mt-2 text-[14px] text-muted">
                {local ? (
                  <>
                    {t("הנתונים נשמרים בתיקייה", "Your data is saved in the folder")} <b dir="ltr">{root?.files.label}</b>
                  </>
                ) : (
                  t("בחרו מה יש לכם, וזה כל מה שיופיע.", "Choose what you have, and only that is shown.")
                )}
              </p>
            </div>
            <ConnectionPicker
              mode="onboarding"
              onChosen={(c) => {
                if (!root) return;
                if (c === "demo") return finish(true);
                secrets.setProvider(c);
                finish(false);
              }}
            />
            {local && root && (
              <div className="text-center text-[12.5px] text-muted">
                {t("עוברים מהגרסה בדפדפן?", "Moving from the browser version?")}{" "}
                <button type="button" className="cursor-pointer underline" onClick={() => backupInput.current?.click()}>
                  {t("שחזור מקובץ גיבוי", "Restore a backup file")}
                </button>
                <input
                  ref={backupInput}
                  type="file"
                  accept=".tutorai,.ruecai,.zip"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      const db = await importBackup(root, f);
                      await root.files.write("tutorai.db", db);
                      setError(null);
                      alert(t("הגיבוי שוחזר. עכשיו בחרו איך לחבר את ה-AI.", "Backup restored. Now choose how to connect the AI."));
                    } catch (err) {
                      setError(errorMessage(err));
                    }
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
