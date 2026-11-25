import { useState } from "react";
import { verifyApiKey } from "@ruecai/core";
import { folderSupported, pickFolder, useBrowserStorage, type DataRoot } from "../platform/storage.ts";
import { secrets } from "../platform/secrets.ts";
import { Alert, Button, Card, Spinner, errorMessage, inputClass } from "../ui/components.tsx";

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

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-8 text-center">
        <img src="./icon.svg" alt="" className="mx-auto mb-3 h-16 w-16" />
        <h1 className="text-3xl font-bold text-brand-700">RuecAI Teacher</h1>
        <p className="mt-2 text-slate-600">עוזר לימודים מבוסס AI לסטודנטים של רייכמן. קוד פתוח, והחומרים נשארים אצלכם.</p>
      </div>
      <ol className="mb-6 flex justify-center gap-2 text-sm" aria-label="שלבים">
        {["ברוכים הבאים", "איפה לשמור", "מפתח AI"].map((t, i) => (
          <li key={t} className={`rounded-full px-3 py-1 ${step === i + 1 ? "bg-brand-600 text-white" : step > i + 1 ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-500"}`}>
            {i + 1}. {t}
          </li>
        ))}
      </ol>

      {error && (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      )}

      {step === 1 && (
        <Card className="space-y-4 p-6">
          <h2 className="text-xl font-bold">מה זה עושה?</h2>
          <ul className="space-y-2 text-slate-700">
            <li>📚 מעלים מצגות, סיכומים ומבחנים לדוגמה מכל קורס</li>
            <li>🧠 מקבלים מפת מושגים, סיכומים, טוטור שמצטט את החומר, חידונים וכרטיסיות</li>
            <li>📝 מבחנים חדשים בסגנון המבחנים לדוגמה, עם בדיקה לפי מחוון</li>
            <li>📈 מעקב שליטה לפי מושג ותוכנית לימוד עד המבחן</li>
          </ul>
          <Alert kind="info">
            🔒 <b>פרטיות:</b> אין לנו שרת. הקבצים נשמרים במחשב שלכם, והבקשות ל-AI נשלחות ישירות מהדפדפן ל-Anthropic עם המפתח שלכם.
          </Alert>
          <Button size="lg" className="w-full" onClick={() => setStep(2)}>
            בואו נתחיל
          </Button>
        </Card>
      )}

      {step === 2 && (
        <Card className="space-y-4 p-6">
          <h2 className="text-xl font-bold">איפה לשמור את הנתונים?</h2>
          {canFolder ? (
            <>
              <button
                onClick={() => choose("folder")}
                className="w-full rounded-xl border-2 border-brand-500 bg-brand-50 p-4 text-start hover:bg-brand-100"
              >
                <div className="font-bold">📁 בתיקייה במחשב (מומלץ)</div>
                <div className="text-sm text-slate-600">
                  בחרו או צרו תיקייה, למשל <code>מסמכים/RuecAI</code>. כל הנתונים יישמרו בה כקבצים רגילים (<code>ruecai.db</code>). אם התיקייה בתוך Google Drive או OneDrive, הנתונים גם מגובים וזמינים בכל מחשב.
                </div>
              </button>
              <button onClick={() => choose("browser")} className="w-full rounded-xl border border-slate-200 p-4 text-start hover:bg-slate-50">
                <div className="font-semibold">🌐 בתוך הדפדפן</div>
                <div className="text-sm text-slate-600">בלי בחירת תיקייה. פחות עמיד: ניקוי נתוני גלישה ימחק הכול, לכן צריך לגבות ידנית.</div>
              </button>
            </>
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
        </Card>
      )}

      {step === 3 && (
        <Card className="space-y-4 p-6">
          <h2 className="text-xl font-bold">מפתח API של Claude</h2>
          <p className="text-sm text-slate-600">
            המערכת משתמשת במודלים של Anthropic (Claude). צרו מפתח ב-
            <a className="text-brand-600 underline" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
              console.anthropic.com
            </a>{" "}
            והדביקו אותו כאן. המפתח נשמר רק בדפדפן הזה, לא בתיקיית הנתונים.
          </p>
          <input
            type="password"
            dir="ltr"
            autoComplete="off"
            placeholder="sk-ant-..."
            className={inputClass}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            aria-label="מפתח API"
          />
          <Button size="lg" className="w-full" disabled={!key.trim() || checking} onClick={() => finish(false)}>
            {checking ? <Spinner label="בודק את המפתח…" /> : "סיום והתחלה"}
          </Button>
          <div className="border-t border-slate-100 pt-4 text-center">
            <button className="text-sm text-slate-600 underline" onClick={() => finish(true)}>
              אין לי מפתח עדיין: נסו במצב הדגמה
            </button>
            <p className="mt-1 text-xs text-slate-500">במצב הדגמה התשובות מוקלטות מראש ולא מבוססות על החומר שלכם.</p>
          </div>
        </Card>
      )}
    </div>
  );
}
