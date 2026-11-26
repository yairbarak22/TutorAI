import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { Engine, setEngine, useEngine } from "./engine.ts";
import { restoreStorage, type DataRoot } from "./platform/storage.ts";
import { Alert, Button, Spinner, errorMessage } from "./ui/components.tsx";
import { CitationProvider } from "./ui/Citations.tsx";
import { Onboarding } from "./views/Onboarding.tsx";
import { Home, NewCourse } from "./views/Home.tsx";
import { Crumbs, Shell, sectionLabel } from "./ui/Shell.tsx";
import { CourseView } from "./views/Course.tsx";
import { Settings } from "./views/Settings.tsx";
import { href, useRoute } from "./router.ts";
import { secrets } from "./platform/secrets.ts";
import { t, useLanguage } from "./i18n.tsx";

type Boot =
  | { stage: "loading" }
  | { stage: "onboarding" }
  | { stage: "permission"; folderName: string; grant: () => Promise<DataRoot | null> }
  | { stage: "ready" }
  | { stage: "error"; message: string };

export function App() {
  useLanguage(); // the whole tree re-renders in the new language when it changes
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
      if (r.status === "ready" && (secrets.getApiKey() || secrets.isDemo() || secrets.getLocal())) await startWith(r.root);
      else if (r.status === "needs-permission") setBoot({ stage: "permission", folderName: r.folderName, grant: r.grant });
      else setBoot({ stage: "onboarding" });
    })().catch((e) => setBoot({ stage: "error", message: errorMessage(e) }));
  }, []);

  if (boot.stage === "loading")
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner label={t("טוען…", "Loading…")} />
      </div>
    );
  if (boot.stage === "error")
    return (
      <div className="mx-auto max-w-lg p-8">
        <Alert kind="error">{t("שגיאה בטעינה:", "Failed to load:")} {boot.message}</Alert>
      </div>
    );
  if (boot.stage === "onboarding") return <Onboarding onDone={startWith} />;
  if (boot.stage === "permission")
    return (
      <div className="mx-auto mt-[15vh] max-w-md space-y-4 p-6 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl tile-grad-6 text-ink/80"><FolderOpen size={26} strokeWidth={1.7} /></div>
        <h1 className="text-2xl font-semibold">{t("ברוכים השבים!", "Welcome back!")}</h1>
        <p className="text-slate-600">
          {t("הנתונים שלכם שמורים בתיקייה", "Your data is saved in the folder")} <b>{boot.folderName}</b>. {t("הדפדפן מבקש אישור לגשת אליה שוב.", "The browser needs your permission to access it again.")}
        </p>
        <Button
          size="lg"
          onClick={async () => {
            const root = await boot.grant();
            if (root) await startWith(root);
          }}
        >
          {t("המשך עם התיקייה", "Continue with this folder")}
        </Button>
        <div>
          <button className="text-sm text-slate-500 underline" onClick={() => setBoot({ stage: "onboarding" })}>
            {t("לבחור תיקייה אחרת", "Choose a different folder")}
          </button>
        </div>
      </div>
    );
  return (
    <CitationProvider>
      <Layout />
    </CitationProvider>
  );
}

function Layout() {
  const engine = useEngine();
  const route = useRoute();
  const [newCourse, setNewCourse] = useState(false);
  const course = route.name === "course" ? engine.store.course(route.id) : null;
  const crumbs =
    route.name === "home"
      ? [{ label: t("בית", "Home") }]
      : route.name === "settings"
        ? [{ label: t("הגדרות", "Settings") }]
        : [
            { label: t("קורסים", "Courses"), href: href.home() },
            { label: course?.name ?? t("קורס", "Course"), href: course ? href.course(course.id) : undefined },
            { label: sectionLabel(route.tab) },
          ];
  return (
    <Shell crumbs={<Crumbs items={crumbs} />} onNewCourse={() => setNewCourse(true)}>
      {route.name === "home" && <Home onNewCourse={() => setNewCourse(true)} />}
      {route.name === "settings" && <Settings />}
      {route.name === "course" && <CourseView id={route.id} tab={route.tab} sub={route.sub} />}
      <NewCourse open={newCourse} onClose={() => setNewCourse(false)} />
    </Shell>
  );
}
