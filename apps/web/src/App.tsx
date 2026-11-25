import { useEffect, useState } from "react";
import { Engine, setEngine, useEngine } from "./engine.ts";
import { restoreStorage, type DataRoot } from "./platform/storage.ts";
import { Alert, Button, Spinner, errorMessage } from "./ui/components.tsx";
import { CitationProvider } from "./ui/Citations.tsx";
import { Onboarding } from "./views/Onboarding.tsx";
import { Home } from "./views/Home.tsx";
import { CourseView } from "./views/Course.tsx";
import { Settings } from "./views/Settings.tsx";
import { href, useRoute } from "./router.ts";
import { secrets } from "./platform/secrets.ts";

type Boot =
  | { stage: "loading" }
  | { stage: "onboarding" }
  | { stage: "permission"; folderName: string; grant: () => Promise<DataRoot | null> }
  | { stage: "ready" }
  | { stage: "error"; message: string };

export function App() {
  const [boot, setBoot] = useState<Boot>({ stage: "loading" });

  const startWith = async (root: DataRoot, db?: Uint8Array) => {
    try {
      setEngine(await Engine.start(root, db));
      setBoot({ stage: "ready" });
    } catch (e) {
      setBoot({ stage: "error", message: errorMessage(e) });
    }
  };

  useEffect(() => {
    (async () => {
      const r = await restoreStorage();
      if (r.status === "ready" && (secrets.getApiKey() || secrets.isDemo())) await startWith(r.root);
      else if (r.status === "needs-permission") setBoot({ stage: "permission", folderName: r.folderName, grant: r.grant });
      else setBoot({ stage: "onboarding" });
    })().catch((e) => setBoot({ stage: "error", message: errorMessage(e) }));
  }, []);

  if (boot.stage === "loading")
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner label="טוען…" />
      </div>
    );
  if (boot.stage === "error")
    return (
      <div className="mx-auto max-w-lg p-8">
        <Alert kind="error">שגיאה בטעינה: {boot.message}</Alert>
      </div>
    );
  if (boot.stage === "onboarding") return <Onboarding onDone={startWith} />;
  if (boot.stage === "permission")
    return (
      <div className="mx-auto mt-[15vh] max-w-md space-y-4 p-6 text-center">
        <div className="text-5xl">📁</div>
        <h1 className="text-2xl font-bold">ברוכים השבים!</h1>
        <p className="text-slate-600">
          הנתונים שלכם שמורים בתיקייה <b>{boot.folderName}</b>. הדפדפן מבקש אישור לגשת אליה שוב.
        </p>
        <Button
          size="lg"
          onClick={async () => {
            const root = await boot.grant();
            if (root) await startWith(root);
          }}
        >
          המשך עם התיקייה
        </Button>
        <div>
          <button className="text-sm text-slate-500 underline" onClick={() => setBoot({ stage: "onboarding" })}>
            לבחור תיקייה אחרת
          </button>
        </div>
      </div>
    );
  return (
    <CitationProvider>
      <Shell />
    </CitationProvider>
  );
}

function Shell() {
  const engine = useEngine();
  const route = useRoute();
  const p = engine.persistence;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2.5">
          <a href={href.home()} className="flex shrink-0 items-center gap-2 whitespace-nowrap font-bold text-brand-700">
            <img src="./icon.svg" alt="" className="h-7 w-7" />
            RuecAI Teacher
          </a>
          {engine.demo && (
            <a href={href.settings()} className="rounded-full bg-amber-100 px-3 py-0.5 text-xs font-semibold text-amber-900" title="התשובות מוקלטות מראש. הוסיפו מפתח API בהגדרות.">
              מצב הדגמה
            </a>
          )}
          <div className="ms-auto flex items-center gap-3 text-xs text-slate-500">
            <span title={engine.root.files.label} className="hidden sm:inline">
              {engine.root.mode === "folder" ? "📁" : "🌐"} {p.lastError ? <span className="text-red-600">שמירה נכשלה</span> : p.lastSaved ? "נשמר" : ""}
            </span>
            <a href={href.settings()} className="rounded-lg px-2 py-1 text-sm text-slate-700 hover:bg-slate-100">
              ⚙️ הגדרות
            </a>
          </div>
        </div>
      </header>
      {import.meta.env.VITE_PREVIEW && (
        <div className="bg-red-600 px-4 py-1.5 text-center text-sm text-white">
          ⚠️ זו תצוגה מקדימה של שינוי שעוד לא אושר. השתמשו במצב הדגמה בלבד, ואל תזינו כאן מפתח API אמיתי.
        </div>
      )}
      {engine.lockWarning && (
        <div className="mx-auto mt-3 max-w-6xl px-4">
          <Alert kind="warn">{engine.lockWarning}</Alert>
        </div>
      )}
      {engine.root.mode === "browser" && (
        <div className="mx-auto mt-3 max-w-6xl px-4">
          <Alert kind="info">
            הנתונים שמורים בתוך הדפדפן. מומלץ לגבות מדי פעם (הגדרות ← גיבוי), או לעבור ל-Chrome/Edge כדי לשמור בתיקייה רגילה.
          </Alert>
        </div>
      )}
      <main className="mx-auto max-w-6xl px-4 py-6">
        {route.name === "home" && <Home />}
        {route.name === "settings" && <Settings />}
        {route.name === "course" && <CourseView id={route.id} tab={route.tab} sub={route.sub} />}
      </main>
      <footer className="pb-8 text-center text-xs text-slate-400">
        קוד פתוח (Apache-2.0) · נבנה ע"י סטודנטים של אוניברסיטת רייכמן ·{" "}
        <a className="underline" href="https://github.com/yairbarak22/RuecAI_Tutor" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </footer>
    </div>
  );
}
