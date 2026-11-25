import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { DEFAULT_MODELS, verifyApiKey } from "@ruecai/core";
import { useEngine } from "../engine.ts";
import { download, forgetStorage, importBackup } from "../platform/storage.ts";
import { secrets } from "../platform/secrets.ts";
import { Alert, Badge, Button, Field, Row, Spinner, Tabs, errorMessage, inputClass } from "../ui/components.tsx";

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

  const [tab, setTab] = useState<"ai" | "data" | "about">("ai");
  return (
    <div className="max-w-3xl">
      <h1 className="text-[24px] font-semibold tracking-tight">הגדרות</h1>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: "ai", label: "מודל AI" },
          { id: "data", label: "נתונים וגיבוי" },
          { id: "about", label: "אודות" },
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
            title="מצב"
            desc={engine.demo ? "מצב הדגמה: התשובות מוקלטות מראש ולא מבוססות על החומר שלכם." : "מחובר ל-Claude עם המפתח שלכם."}
            action={
              hasKey ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    secrets.setDemo(!engine.demo);
                    engine.configureLLM();
                  }}
                >
                  {engine.demo ? "כיבוי מצב הדגמה" : "מעבר למצב הדגמה"}
                </Button>
              ) : (
                <Badge color="amber">הדגמה</Badge>
              )
            }
          />
          <Row title={hasKey ? "החלפת מפתח API" : "מפתח API"} desc="המפתח נשמר רק בדפדפן הזה, לא בתיקיית הנתונים." wide>
            <div className="mt-3 flex flex-wrap gap-2">
              <input type="password" dir="ltr" className={`${inputClass} max-w-sm flex-1`} placeholder="sk-ant-..." value={key} onChange={(e) => setKey(e.target.value)} aria-label="מפתח API" />
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
                  variant="ghost"
                  onClick={() => {
                    secrets.clearApiKey();
                    engine.configureLLM();
                  }}
                >
                  מחיקת המפתח
                </Button>
              )}
            </div>
          </Row>
          <Row title="מודלים" desc="מודל מהיר לחילוץ וכרטיסיות, ומודל חכם להסברים ולמבחנים." wide>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="מודל מהיר">
                <input dir="ltr" className={inputClass} value={fast} onChange={(e) => setFast(e.target.value)} />
              </Field>
              <Field label="מודל חכם">
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
                setMsg({ kind: "success", text: "המודלים עודכנו." });
              }}
            >
              שמירת מודלים
            </Button>
          </Row>
          <Row
            title="שימוש ועלות"
            desc={
              usage.length
                ? usage.map((u) => `${u.model}: ${Math.round((u.input + u.output) / 1000)}K טוקנים`).join(" · ")
                : "עוד לא היה שימוש במודל."
            }
            action={cost > 0 ? <span className="text-[13px] font-medium" dir="ltr">≈ ${cost.toFixed(2)}</span> : undefined}
          />
        </div>
      )}

      {tab === "data" && (
        <div>
          {engine.persistence.lastError && (
            <div className="mt-4">
              <Alert kind="error">שמירה נכשלה: {engine.persistence.lastError}</Alert>
            </div>
          )}
          <Row
            title="מיקום השמירה"
            desc={
              engine.root.mode === "folder" ? (
                <>
                  תיקייה <b className="font-medium text-ink-2">{engine.root.files.label}</b>, בקובץ <code>ruecai.db</code> ובתיקיית <code>courses/</code>.
                </>
              ) : (
                "בתוך הדפדפן הזה. גבו לקובץ מדי פעם."
              )
            }
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  if (!confirm("להתנתק מהתיקייה הנוכחית ולבחור מקום אחר? הנתונים בתיקייה לא יימחקו.")) return;
                  await engine.persistence.flush();
                  await forgetStorage();
                  location.hash = "";
                  location.reload();
                }}
              >
                החלפת מיקום
              </Button>
            }
          />
          <Row
            title="שמירה אחרונה"
            desc={engine.persistence.lastSaved ? engine.persistence.lastSaved.toLocaleTimeString("he-IL") : "עוד לא נשמר"}
          />
          <Row
            title="גיבוי"
            desc="קובץ ‎.ruecai‎ אחד עם כל הקורסים, הקבצים וההתקדמות."
            action={
              <Button variant="secondary" size="sm" onClick={async () => download(await engine.backup(), `ruecai-backup-${new Date().toISOString().slice(0, 10)}.ruecai`)}>
                <Download size={14} /> הורדת גיבוי
              </Button>
            }
          />
          <Row
            title="שחזור"
            desc="מחליף את כל הנתונים הנוכחיים בנתונים מקובץ הגיבוי."
            action={
              <>
                <Button variant="secondary" size="sm" onClick={() => restoreInput.current?.click()}>
                  <Upload size={14} /> שחזור מגיבוי
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
              </>
            }
          />
        </div>
      )}

      {tab === "about" && (
        <div>
          <Row title="RuecAI Teacher" desc="פרויקט קוד פתוח (Apache-2.0) של סטודנטים באוניברסיטת רייכמן. אין שרת ואין איסוף נתונים: הקבצים נשמרים אצלכם, והבקשות ל-AI נשלחות ישירות ל-Anthropic." />
          <Row title="יושרה אקדמית" desc="השימוש כפוף לכללי היושרה האקדמית של האוניברסיטה. הכלי נועד ללמידה, לא להגשת עבודות במקומכם." />
          <Row
            title="קוד המקור"
            desc="דיווח על באגים, רעיונות לכלים ותרומות קוד."
            action={
              <a href="https://github.com/yairbarak22/RuecAI_Tutor" target="_blank" rel="noreferrer">
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
