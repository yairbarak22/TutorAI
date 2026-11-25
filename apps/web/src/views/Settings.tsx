import { useRef, useState } from "react";
import { DEFAULT_MODELS, verifyApiKey } from "@ruecai/core";
import { useEngine } from "../engine.ts";
import { download, forgetStorage, importBackup } from "../platform/storage.ts";
import { secrets } from "../platform/secrets.ts";
import { Alert, Button, Card, Field, Spinner, errorMessage, inputClass } from "../ui/components.tsx";

/** Rough cost estimate (USD per 1M tokens: input/output) for the defaults. */
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

export function Settings() {
  const engine = useEngine();
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [checking, setChecking] = useState(false);
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

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-2xl font-bold">הגדרות</h1>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <Card className="space-y-4 p-5">
        <h2 className="font-bold">🤖 מודל ה-AI</h2>
        <p className="text-sm text-slate-600">
          {engine.demo ? "כרגע במצב הדגמה (תשובות מוקלטות)." : "מחובר ל-Claude עם המפתח שלכם."} המפתח נשמר רק בדפדפן הזה.
        </p>
        <Field label={hasKey ? "החלפת מפתח API" : "מפתח API"}>
          <input type="password" dir="ltr" className={inputClass} placeholder="sk-ant-..." value={key} onChange={(e) => setKey(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!key.trim() || checking}
            onClick={async () => {
              setChecking(true);
              const ok = await verifyApiKey(key.trim());
              setChecking(false);
              if (ok !== true) return setMsg({ kind: "error", text: ok });
              secrets.setApiKey(key.trim());
              secrets.setDemo(false);
              setKey("");
              engine.configureLLM();
              setMsg({ kind: "success", text: "המפתח נשמר. מצב הדגמה כובה." });
            }}
          >
            {checking ? <Spinner label="בודק…" /> : "שמירת מפתח"}
          </Button>
          {hasKey && (
            <Button
              variant="secondary"
              onClick={() => {
                secrets.setDemo(!engine.demo);
                engine.configureLLM();
              }}
            >
              {engine.demo ? "כיבוי מצב הדגמה" : "מעבר למצב הדגמה"}
            </Button>
          )}
          {hasKey && (
            <Button
              variant="ghost"
              onClick={() => {
                secrets.clearApiKey();
                engine.configureLLM();
              }}
            >
              מחיקת המפתח מהדפדפן
            </Button>
          )}
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">מתקדם: בחירת מודלים</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="מודל מהיר (חילוץ, כרטיסיות)">
              <input dir="ltr" className={inputClass} value={fast} onChange={(e) => setFast(e.target.value)} />
            </Field>
            <Field label="מודל חכם (הסברים, מבחנים)">
              <input dir="ltr" className={inputClass} value={smart} onChange={(e) => setSmart(e.target.value)} />
            </Field>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() => {
              secrets.setModels({ fast: fast.trim() || DEFAULT_MODELS.fast, smart: smart.trim() || DEFAULT_MODELS.smart });
              engine.configureLLM();
              setMsg({ kind: "success", text: "המודלים עודכנו." });
            }}
          >
            שמירת מודלים
          </Button>
        </details>
        {usage.length > 0 && (
          <p className="text-xs text-slate-500">
            שימוש מצטבר: {usage.map((u) => `${u.model}: ${Math.round((u.input + u.output) / 1000)}K טוקנים`).join(" · ")}
            {cost > 0 && ` · עלות משוערת ≈ $${cost.toFixed(2)}`}
          </p>
        )}
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="font-bold">💾 הנתונים שלכם</h2>
        <p className="text-sm text-slate-600">
          {engine.root.mode === "folder" ? (
            <>
              נשמרים בתיקייה <b>{engine.root.files.label}</b> בקובץ <code>ruecai.db</code> ובתיקיית <code>courses/</code>. גיבוי = העתקת התיקייה.
            </>
          ) : (
            "נשמרים בתוך הדפדפן הזה. גבו לקובץ מדי פעם."
          )}
          {engine.persistence.lastSaved && ` נשמר לאחרונה: ${engine.persistence.lastSaved.toLocaleTimeString("he-IL")}.`}
        </p>
        {engine.persistence.lastError && <Alert kind="error">שמירה נכשלה: {engine.persistence.lastError}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={async () => download(await engine.backup(), `ruecai-backup-${new Date().toISOString().slice(0, 10)}.ruecai`)}
          >
            ⬇️ הורדת גיבוי (.ruecai)
          </Button>
          <Button variant="secondary" onClick={() => restoreInput.current?.click()}>
            ⬆️ שחזור מגיבוי
          </Button>
          <input
            ref={restoreInput}
            type="file"
            accept=".ruecai,.zip"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (!confirm("השחזור יחליף את כל הנתונים הנוכחיים בנתונים מהגיבוי. להמשיך?")) return;
              try {
                const db = await importBackup(engine.root, f);
                await engine.root.files.write("ruecai.db", db);
                location.reload();
              } catch (err) {
                setMsg({ kind: "error", text: errorMessage(err) });
              }
            }}
          />
          <Button
            variant="ghost"
            onClick={async () => {
              if (!confirm("להתנתק מהתיקייה הנוכחית ולבחור מקום אחר? הנתונים בתיקייה לא יימחקו.")) return;
              await engine.persistence.flush();
              await forgetStorage();
              location.hash = "";
              location.reload();
            }}
          >
            החלפת מיקום שמירה
          </Button>
        </div>
      </Card>

      <Card className="space-y-2 p-5 text-sm text-slate-600">
        <h2 className="font-bold text-slate-900">ℹ️ אודות</h2>
        <p>
          RuecAI Teacher הוא פרויקט קוד פתוח (Apache-2.0) של סטודנטים באוניברסיטת רייכמן. אין שרת ואין איסוף נתונים: הקבצים נשמרים אצלכם, והבקשות ל-AI נשלחות ישירות
          ל-Anthropic.
        </p>
        <p>
          השימוש בכלי כפוף לכללי היושרה האקדמית של האוניברסיטה. הכלי נועד ללמידה, לא להגשת עבודות במקומכם.{" "}
          <a className="underline" href="https://github.com/yairbarak22/RuecAI_Tutor" target="_blank" rel="noreferrer">
            קוד המקור ודיווח על באגים
          </a>
        </p>
      </Card>
    </div>
  );
}
