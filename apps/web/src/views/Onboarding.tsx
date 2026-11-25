import { useState } from "react";
import { ChartLine, ClipboardCheck, FolderOpen, Globe, GraduationCap, Lock, Network, Sparkles, Upload } from "lucide-react";
import { verifyApiKey } from "@ruecai/core";
import { folderSupported, pickFolder, useBrowserStorage, type DataRoot } from "../platform/storage.ts";
import { secrets } from "../platform/secrets.ts";
import { Alert, Badge, Button, Field, IconTile, Spinner, errorMessage, inputClass } from "../ui/components.tsx";

/** Three steps, under 3 minutes: storage → API key → start. */
export function Onboarding({ onDone }: { onDone: (root: DataRoot) => void }) {
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
        <div className="mb-8 flex items-center justify-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-ink text-white">
            <GraduationCap size={18} strokeWidth={2.2} />
          </span>
          <h1 className="text-[18px] font-semibold tracking-tight">RuecAI Teacher</h1>
        </div>

        <div className="mb-6 flex items-center justify-center gap-1.5" aria-label="שלבים">
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
              <h2 className="text-[26px] font-semibold leading-tight tracking-tight">ללמוד חכם יותר, מהחומר שלכם</h2>
              <p className="mt-2 text-[14px] text-muted">עוזר לימודים מבוסס AI לסטודנטים של רייכמן. קוד פתוח, והחומרים נשארים אצלכם.</p>
            </div>
            <ul className="space-y-2">
              {[
                { icon: <Upload size={18} />, g: 6, t: "מעלים מצגות, סיכומים ומבחנים לדוגמה מכל קורס" },
                { icon: <Network size={18} />, g: 3, t: "מפת מושגים, סיכומים, טוטור שמצטט את החומר, חידונים וכרטיסיות" },
                { icon: <ClipboardCheck size={18} />, g: 5, t: "מבחנים חדשים בסגנון המבחנים לדוגמה, עם בדיקה לפי מחוון" },
                { icon: <ChartLine size={18} />, g: 1, t: "מעקב שליטה לפי מושג ותוכנית לימוד עד המבחן" },
              ].map((f) => (
                <li key={f.t} className="flex items-center gap-3 rounded-xl border border-black/[0.06] p-3 text-[13.5px] text-ink-2">
                  <IconTile grad={f.g} size="sm">
                    {f.icon}
                  </IconTile>
                  {f.t}
                </li>
              ))}
            </ul>
            <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted">
              <Lock size={14} className="mt-0.5 shrink-0" />
              <span>
                <b className="font-medium text-ink-2">פרטיות:</b> אין לנו שרת. הקבצים נשמרים במחשב שלכם, והבקשות ל-AI נשלחות ישירות מהדפדפן ל-Anthropic עם המפתח שלכם.
              </span>
            </p>
            <Button size="lg" className="w-full" onClick={() => setStep(2)}>
              בואו נתחיל
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div className="text-center">
              <h2 className="text-[26px] font-semibold leading-tight tracking-tight">איפה לשמור את הנתונים?</h2>
              <p className="mt-2 text-[14px] text-muted">הכול נשמר אצלכם. אפשר לשנות את זה אחר כך בהגדרות.</p>
            </div>
            {canFolder ? (
              <div className="space-y-2.5">
                <button onClick={() => choose("folder")} className={`${optionCls} ring-1 ring-ink/80`}>
                  <IconTile grad={6} size="sm">
                    <FolderOpen size={16} />
                  </IconTile>
                  <span>
                    <span className="flex items-center gap-2 text-[14px] font-medium text-ink">
                      בתיקייה במחשב <Badge>מומלץ</Badge>
                    </span>
                    <span className="mt-1 block text-[12.5px] leading-relaxed text-muted">
                      בחרו או צרו תיקייה, למשל <code>מסמכים/RuecAI</code>. הנתונים יישמרו בה כקבצים רגילים (<code>ruecai.db</code>). תיקייה בתוך Google Drive או OneDrive גם מגובה וזמינה בכל מחשב.
                    </span>
                  </span>
                </button>
                <button onClick={() => choose("browser")} className={optionCls}>
                  <IconTile grad={2} size="sm">
                    <Globe size={16} />
                  </IconTile>
                  <span>
                    <span className="block text-[14px] font-medium text-ink">בתוך הדפדפן</span>
                    <span className="mt-1 block text-[12.5px] leading-relaxed text-muted">בלי בחירת תיקייה. פחות עמיד: ניקוי נתוני גלישה ימחק הכול, לכן צריך לגבות ידנית.</span>
                  </span>
                </button>
              </div>
            ) : (
              <>
                <Alert kind="warn">
                  הדפדפן הזה (Safari/Firefox) לא מאפשר שמירה בתיקייה. הנתונים יישמרו בתוך הדפדפן, ותוכלו לגבות אותם לקובץ. <b>מומלץ להשתמש ב-Chrome או Edge.</b>
                </Alert>
                <Button size="lg" className="w-full" onClick={() => choose("browser")}>
                  המשך עם שמירה בדפדפן
                </Button>
              </>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div className="text-center">
              <h2 className="text-[26px] font-semibold leading-tight tracking-tight">מפתח API של Claude</h2>
              <p className="mt-2 text-[14px] text-muted">
                צרו מפתח ב-
                <a className="font-medium text-ink underline underline-offset-2" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                  console.anthropic.com
                </a>{" "}
                והדביקו אותו כאן. המפתח נשמר רק בדפדפן הזה.
              </p>
            </div>
            <Field label="מפתח API">
              <input
                type="password"
                dir="ltr"
                autoComplete="off"
                placeholder="sk-ant-..."
                className={`${inputClass} h-11`}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                aria-label="מפתח API"
              />
            </Field>
            <Button size="lg" className="w-full" disabled={!key.trim() || checking} onClick={() => finish(false)}>
              {checking ? <Spinner label="בודק את המפתח…" /> : "סיום והתחלה"}
            </Button>
            <div className="flex items-center gap-3 text-[12px] text-slate-400">
              <span className="h-px flex-1 bg-black/[0.08]" /> או <span className="h-px flex-1 bg-black/[0.08]" />
            </div>
            <Button variant="secondary" size="lg" className="w-full" onClick={() => finish(true)}>
              <Sparkles size={16} /> אין לי מפתח עדיין: נסו במצב הדגמה
            </Button>
            <p className="text-center text-[12px] text-muted">במצב הדגמה התשובות מוקלטות מראש ולא מבוססות על החומר שלכם.</p>
          </div>
        )}
      </div>
    </div>
  );
}
