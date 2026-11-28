import { LocalStatus } from "./LocalComputer.tsx";
import { MoodleHomeButton } from "./Moodle.tsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  CalendarDays,
  ChartLine,
  Check,
  ChevronLeft,
  ChevronsUpDown,
  Cloud,
  CloudAlert,
  FileText,
  FolderOpen,
  GraduationCap,
  House,
  Layers,
  Menu,
  MessageSquare,
  MessagesSquare,
  Network,
  NotebookPen,
  PanelLeft,
  PanelRight,
  Plus,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Star,
  X,
  Zap,
} from "lucide-react";
import { useEngine } from "../engine.ts";
import { ChevronForward, isRTL, t, toolText } from "../i18n.tsx";
import { href, useRoute } from "../router.ts";
import { Alert } from "./components.tsx";

export const COURSE_SECTIONS = [
  { id: "session", he: "סשן יומי", en: "Daily session", icon: Zap, get label() { return t(this.he, this.en); } },
  { id: "materials", he: "חומרים", en: "Materials", icon: FileText, get label() { return t(this.he, this.en); } },
  { id: "concepts", he: "מפת מושגים", en: "Concept map", icon: Network, get label() { return t(this.he, this.en); } },
  { id: "studio", he: "כלים", en: "Tools", icon: Sparkles, get label() { return t(this.he, this.en); } },
  { id: "tutor", he: "מורה פרטי", en: "Tutor", icon: MessagesSquare, get label() { return t(this.he, this.en); } },
  { id: "review", he: "חזרה", en: "Review", icon: Layers, get label() { return t(this.he, this.en); } },
  { id: "progress", he: "התקדמות", en: "Progress", icon: ChartLine, get label() { return t(this.he, this.en); } },
  { id: "artifacts", he: "תוצרים", en: "Outputs", icon: FolderOpen, get label() { return t(this.he, this.en); } },
  { id: "mistakes", he: "מחברת טעויות", en: "Mistakes", icon: NotebookPen, get label() { return t(this.he, this.en); } },
] as const;

export const sectionLabel = (id: string) => COURSE_SECTIONS.find((s) => s.id === id)?.label ?? "";

/** Gradient monogram for a course (stable per id). */
export function CourseMark({ id, name, size = "sm" }: { id: number; name: string; size?: "sm" | "md" }) {
  const s = size === "sm" ? "h-5 w-5 rounded-md text-[10px]" : "h-9 w-9 rounded-xl text-sm";
  return (
    <span className={`tile-grad-${((id - 1) % 8) + 1} grid shrink-0 place-items-center font-semibold text-ink/75 ${s}`}>
      {name.trim().charAt(0)}
    </span>
  );
}

function NavItem({
  href: to,
  icon,
  active,
  children,
  badge,
  indent,
  onClick,
}: {
  href?: string;
  icon: ReactNode;
  active?: boolean;
  children: ReactNode;
  badge?: ReactNode;
  indent?: boolean;
  onClick?: () => void;
}) {
  const cls = `group flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors ${
    indent ? "ps-4" : ""
  } ${active ? "bg-black/[0.06] font-medium text-ink" : "text-ink-2 hover:bg-black/[0.04] hover:text-ink"}`;
  const inner = (
    <>
      <span className={`grid w-4 shrink-0 place-items-center ${active ? "text-ink" : "text-muted group-hover:text-ink"}`}>{icon}</span>
      <span className="min-w-0 flex-1 truncate text-start">{children}</span>
      {badge}
    </>
  );
  return to ? (
    <a href={to} className={cls} aria-current={active ? "page" : undefined} onClick={onClick}>
      {inner}
    </a>
  ) : (
    <button type="button" className={cls} onClick={onClick}>
      {inner}
    </button>
  );
}

const LAST_COURSE = "tutorai.lastCourse";
const kvGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const kvSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};

/** Sidebar "Learn" group. The other course pages are reached from Home, the daily session and the tools. */
const LEARN_IDS = ["materials", "concepts", "tutor"] as const;
const STUDY_PLAN_TOOL = "study-plan";

/** Tools the student pinned under "Tools" in the sidebar (tool ids, in the order they were added). */
const PINNED_TOOLS = "tutorai.pinnedTools";
function usePinnedTools() {
  const [ids, setIds] = useState<string[]>(() => {
    try {
      const v = JSON.parse(kvGet(PINNED_TOOLS) ?? "[]");
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  });
  const save = (next: string[]) => {
    setIds(next);
    kvSet(PINNED_TOOLS, JSON.stringify(next));
  };
  return { ids, pin: (id: string) => !ids.includes(id) && save([...ids, id]), unpin: (id: string) => save(ids.filter((x) => x !== id)) };
}

const chip = "rounded-md bg-black/[0.06] px-1.5 text-[11px] font-medium leading-[18px] text-ink-2";

/** Course switcher at the top of the sidebar (like a workspace switcher). */
function CourseSwitcher({ currentId, onNavigate, onNewCourse }: { currentId: number | null; onNavigate: () => void; onNewCourse: () => void }) {
  const engine = useEngine();
  const [open, setOpen] = useState(false);
  const courses = engine.store.courses();
  const current = currentId ? engine.store.course(currentId) : null;
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);
  return (
    <div className="relative mx-3 mb-4" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-10 w-full items-center gap-2.5 rounded-[10px] border border-black/10 bg-white px-2.5 text-start shadow-sm transition hover:border-black/20"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("בחירת קורס", "Choose course")}
      >
        {current ? <CourseMark id={current.id} name={current.name} /> : <span className="grid h-5 w-5 place-items-center rounded-md bg-black/[0.06] text-muted"><BookOpen size={12} /></span>}
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{current?.name ?? t("בחרו קורס", "Choose a course")}</span>
        <ChevronsUpDown size={14} className="text-muted" />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-11 z-50 rounded-xl border border-black/10 bg-white p-1 shadow-xl" role="listbox">
          {courses.map((c) => (
            <a
              key={c.id}
              href={href.course(c.id)}
              role="option"
              aria-selected={c.id === currentId}
              onClick={() => (setOpen(false), onNavigate())}
              className="flex h-9 items-center gap-2.5 rounded-lg px-2 text-[13.5px] hover:bg-black/[0.04]"
            >
              <CourseMark id={c.id} name={c.name} />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {c.id === currentId && <Check size={14} />}
            </a>
          ))}
          {courses.length > 0 && <div className="my-1 h-px bg-black/[0.06]" />}
          <button type="button" onClick={() => (setOpen(false), onNewCourse())} className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-[13.5px] text-ink-2 hover:bg-black/[0.04]">
            <Plus size={15} className="text-muted" /> {t("קורס חדש", "New course")}
          </button>
        </div>
      )}
    </div>
  );
}

function Sidebar({ onNavigate, onNewCourse }: { onNavigate: () => void; onNewCourse: () => void }) {
  const engine = useEngine();
  const route = useRoute();
  const p = engine.persistence;
  const courses = engine.store.courses();
  if (route.name === "course" && engine.store.course(route.id)) kvSet(LAST_COURSE, String(route.id));
  const remembered = Number(kvGet(LAST_COURSE));
  const courseId =
    route.name === "course" && engine.store.course(route.id)
      ? route.id
      : remembered && engine.store.course(remembered)
        ? remembered
        : (courses[0]?.id ?? null);
  const inCourse = route.name === "course" && route.id === courseId;
  const tab = inCourse && route.name === "course" ? route.tab : null;
  const sub = inCourse && route.name === "course" ? route.sub : undefined;
  const pinned = usePinnedTools();
  const [adding, setAdding] = useState(false);
  const tools = engine.tools.filter((x) => x.manifest.output !== "chat");
  const pinnedTools = pinned.ids.map((id) => tools.find((x) => x.manifest.id === id)).filter((x) => !!x);
  const toolIcon = (emoji?: string) => <span className="text-[13px] leading-none">{emoji ?? "✦"}</span>;
  return (
    <div className="flex h-full flex-col">
      <a href={href.home()} onClick={onNavigate} className="mx-3 mt-3 mb-3 flex h-9 items-center gap-2 px-1.5">
        <GraduationCap size={19} strokeWidth={2.1} />
        <span className="text-[15.5px] font-semibold tracking-tight">TutorAI</span>
      </a>
      <CourseSwitcher currentId={courseId} onNavigate={onNavigate} onNewCourse={onNewCourse} />

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label={t("ניווט ראשי", "Main navigation")}>
        <div className="space-y-0.5">
          <NavItem href={href.home()} icon={<House size={16} />} active={route.name === "home"} onClick={onNavigate}>
            {t("בית", "Home")}
          </NavItem>
          <NavItem icon={<Plus size={16} />} onClick={onNewCourse}>
            {t("קורס חדש", "New course")}
          </NavItem>
          <MoodleHomeButton
            trigger={(open) => (
              <NavItem icon={<GraduationCap size={16} />} onClick={open}>
                {t("ייבוא קורס מ-Moodle", "Import a course from Moodle")}
              </NavItem>
            )}
          />
        </div>

        {courseId ? (
          <div className="space-y-5" role="navigation" aria-label={t("לשוניות הקורס", "Course sections")}>
            <div>
              <div className="mb-1 px-2.5 text-[12px] font-medium text-muted">{t("לימוד", "Learn")}</div>
              <div className="space-y-0.5">
                {LEARN_IDS.map((id) => {
                  const sec = COURSE_SECTIONS.find((x) => x.id === id)!;
                  return (
                    <NavItem key={id} href={href.course(courseId, id)} icon={<sec.icon size={16} />} active={tab === id} onClick={onNavigate}>
                      {sec.label}
                    </NavItem>
                  );
                })}
                <NavItem
                  href={href.course(courseId, "studio", STUDY_PLAN_TOOL)}
                  icon={<CalendarDays size={16} />}
                  active={tab === "studio" && sub === STUDY_PLAN_TOOL}
                  onClick={onNavigate}
                >
                  {t("תכנית לימוד", "Study plan")}
                </NavItem>
              </div>
            </div>

            <div>
              <NavItem
                href={href.course(courseId, "studio")}
                icon={<Sparkles size={16} />}
                active={tab === "studio" && !sub}
                onClick={onNavigate}
                badge={<span className={chip}>AI</span>}
              >
                {t("כלים", "Tools")}
              </NavItem>
              <div className="mt-0.5 space-y-0.5" data-testid="pinned-tools">
                {pinnedTools.map((x) => (
                  <div key={x.manifest.id} className="group/pin relative">
                    <NavItem
                      href={href.course(courseId, "studio", x.manifest.id)}
                      icon={toolIcon(x.manifest.icon)}
                      active={tab === "studio" && sub === x.manifest.id}
                      onClick={onNavigate}
                      indent
                    >
                      {toolText(x.manifest).name}
                    </NavItem>
                    <button
                      type="button"
                      onClick={() => pinned.unpin(x.manifest.id)}
                      aria-label={t(`הסרת ${toolText(x.manifest).name} מהתפריט`, `Remove ${toolText(x.manifest).name} from the menu`)}
                      className="absolute end-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 cursor-pointer place-items-center rounded-md text-muted opacity-0 transition hover:bg-black/[0.06] hover:text-ink focus:opacity-100 group-hover/pin:opacity-100"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <NavItem icon={<Plus size={15} />} onClick={() => setAdding(!adding)} indent>
                  <span className="text-muted">{t("הוספת כלי", "Add a tool")}</span>
                </NavItem>
                {adding && (
                  <div className="ms-4 rounded-lg border border-black/[0.08] bg-white p-1 shadow-sm" role="group" aria-label={t("כלים להוספה", "Tools to add")}>
                    {tools.filter((x) => !pinned.ids.includes(x.manifest.id)).length === 0 ? (
                      <div className="px-2.5 py-2 text-[12.5px] text-muted">{t("כל הכלים כבר בתפריט.", "Every tool is already in the menu.")}</div>
                    ) : (
                      tools
                        .filter((x) => !pinned.ids.includes(x.manifest.id))
                        .map((x) => (
                          <NavItem
                            key={x.manifest.id}
                            icon={toolIcon(x.manifest.icon)}
                            onClick={() => {
                              pinned.pin(x.manifest.id);
                              setAdding(false);
                            }}
                          >
                            {toolText(x.manifest).name}
                          </NavItem>
                        ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="px-2.5 text-[13px] leading-relaxed text-muted">{t("צרו קורס או פתחו קורס לדוגמה כדי לראות כאן את הכלים.", "Create a course or open a sample course to see its tools here.")}</div>
        )}
      </nav>

      <div className="space-y-1 px-3 pt-2 pb-3">
        {engine.demo && (
          <a
            href={href.settings()}
            onClick={onNavigate}
            className="mb-2 flex items-center gap-3 rounded-xl border border-black/[0.08] bg-white p-2.5 shadow-sm transition hover:border-black/15"
            title={t("התשובות מוקלטות מראש. הוסיפו מפתח API בהגדרות.", "Answers are pre-recorded. Add an API key in Settings.")}
          >
            <span className="tile-grad-4 h-9 w-9 shrink-0 rounded-full" />
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold">{t("מצב הדגמה", "Demo mode")}</span>
              <span className="block truncate text-[12px] text-muted">{t("הוסיפו מפתח API", "Add an API key")}</span>
            </span>
          </a>
        )}
        <NavItem href={href.settings()} icon={<SettingsIcon size={16} />} active={route.name === "settings"} onClick={onNavigate}>
          {t("הגדרות", "Settings")}
        </NavItem>
        <LocalStatus />
        <div className="flex items-center gap-2 px-2.5 pt-1 text-[12px] text-muted" title={engine.root.files.label}>
          {p.lastError ? <CloudAlert size={14} className="text-red-500" /> : <Cloud size={14} />}
          <span className="truncate">
            {engine.root.mode === "folder" ? t("תיקייה מקומית", "Local folder") : t("בתוך הדפדפן", "In the browser")} ·{" "}
            {p.lastError ? <span className="text-red-600">{t("שמירה נכשלה", "Save failed")}</span> : p.lastSaved ? t("נשמר", "Saved") : t("מוכן", "Ready")}
          </span>
        </div>
      </div>
    </div>
  );
}

/** "Search everything" box in the top bar: courses, course sections and tools. ⌘K / Ctrl+K focuses it. */
function GlobalSearch() {
  const engine = useEngine();
  const route = useRoute();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const courseId = route.name === "course" ? route.id : Number(kvGet(LAST_COURSE)) || engine.store.courses()[0]?.id;
  const items: { label: string; hint: string; to: string }[] = [
    ...engine.store.courses().map((c) => ({ label: c.name, hint: t("קורס", "Course"), to: href.course(c.id) })),
    ...(courseId ? COURSE_SECTIONS.map((sec) => ({ label: sec.label, hint: t("אזור בקורס", "Section"), to: href.course(courseId, sec.id) })) : []),
    ...(courseId
      ? engine.tools.filter((x) => x.manifest.output !== "chat").map((x) => ({ label: toolText(x.manifest).name, hint: t("כלי", "Tool"), to: href.course(courseId, "studio", x.manifest.id) }))
      : []),
    { label: t("הגדרות", "Settings"), hint: t("עמוד", "Page"), to: href.settings() },
  ];
  const term = q.trim();
  const results = term ? items.filter((i) => i.label.includes(term)).slice(0, 8) : [];
  return (
    <div className="relative hidden w-[260px] shrink-0 lg:block">
      <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
      <input
        ref={ref}
        value={q}
        onChange={(e) => (setQ(e.target.value), setOpen(true))}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) {
            location.hash = results[0].to;
            setQ("");
            ref.current?.blur();
          }
          if (e.key === "Escape") ref.current?.blur();
        }}
        placeholder={t("חיפוש…", "Search…")}
        aria-label={t("חיפוש", "Search")}
        className="h-8 w-full rounded-lg border border-black/10 bg-white ps-9 pe-14 text-[13px] outline-none placeholder:text-slate-400 focus:border-black/25"
      />
      <span className="pointer-events-none absolute end-2 top-1/2 flex -translate-y-1/2 gap-0.5">
        <kbd className="rounded border border-black/10 px-1 font-sans text-[10px] text-muted" style={{ fontFamily: "system-ui, -apple-system" }}>⌘</kbd>
        <kbd className="rounded border border-black/10 px-1 text-[10px] text-muted">K</kbd>
      </span>
      {open && results.length > 0 && (
        <div className="absolute inset-x-0 top-10 z-50 rounded-xl border border-black/10 bg-white p-1 shadow-xl">
          {results.map((r) => (
            <a key={r.to + r.label} href={r.to} onClick={() => setQ("")} className="flex h-9 items-center justify-between rounded-lg px-2.5 text-[13px] hover:bg-black/[0.04]">
              <span className="truncate">{r.label}</span>
              <span className="text-[11px] text-muted">{r.hint}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function Shell({ children, crumbs, onNewCourse }: { children: ReactNode; crumbs: ReactNode; onNewCourse: () => void }) {
  const engine = useEngine();
  const route = useRoute();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(() => kvGet("tutorai.sidebar") === "collapsed");
  const [bannerClosed, setBannerClosed] = useState(() => kvGet("tutorai.banner") === "closed");
  useEffect(() => setDrawer(false), [route]);
  const toggle = () => {
    kvSet("tutorai.sidebar", collapsed ? "open" : "collapsed");
    setCollapsed(!collapsed);
  };
  const topBtn = "hidden h-7 items-center gap-1.5 rounded-lg border border-black/10 bg-white px-2.5 text-[12.5px] font-medium text-ink-2 hover:bg-hover sm:inline-flex";
  return (
    <div className="min-h-screen bg-canvas">
      {/* Sidebar: fixed on desktop, drawer on mobile. */}
      <aside className={`fixed inset-y-0 start-0 z-40 hidden w-[252px] border-e border-black/[0.06] bg-sidebar ${collapsed ? "" : "md:block"}`}>
        <Sidebar onNavigate={() => {}} onNewCourse={onNewCourse} />
      </aside>
      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setDrawer(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <aside className="absolute inset-y-0 start-0 w-[280px] bg-sidebar shadow-xl" onClick={(e) => e.stopPropagation()}>
            <button
              className="absolute top-4 end-3 grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-hover"
              onClick={() => setDrawer(false)}
              aria-label={t("סגירת התפריט", "Close menu")}
            >
              <X size={18} />
            </button>
            <Sidebar onNavigate={() => setDrawer(false)} onNewCourse={() => (setDrawer(false), onNewCourse())} />
          </aside>
        </div>
      )}

      <div className={collapsed ? "" : "md:ps-[252px]"}>
        {engine.root.mode === "browser" && !bannerClosed && (
          <div className="relative flex min-h-9 items-center justify-center bg-[linear-gradient(90deg,#3a2f2a,#24282f_45%,#2c3a35)] px-10 py-1.5 text-center text-[12.5px] text-white/90">
            <span>
              {t("הנתונים שמורים בתוך הדפדפן. מומלץ לגבות מדי פעם, או לעבור ל-Chrome/Edge כדי לשמור בתיקייה.", "Your data is stored in this browser. Back it up now and then, or switch to Chrome/Edge to save to a folder.")}{" "}
              <a href={href.settings()} className="font-medium text-white underline underline-offset-2">
                {t("לגיבוי", "Back up")}
              </a>
            </span>
            <button
              className="absolute end-3 grid h-6 w-6 place-items-center rounded text-white/70 hover:text-white"
              onClick={() => (kvSet("tutorai.banner", "closed"), setBannerClosed(true))}
              aria-label={t("סגירת ההודעה", "Dismiss")}
            >
              <X size={15} />
            </button>
          </div>
        )}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-black/[0.06] bg-white/85 px-4 backdrop-blur-md md:px-8">
          <button className="grid h-9 w-9 place-items-center rounded-lg hover:bg-hover md:hidden" onClick={() => setDrawer(true)} aria-label={t("תפריט", "Menu")}>
            <Menu size={18} />
          </button>
          <button className="hidden h-8 w-8 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink md:grid" onClick={toggle} aria-label={collapsed ? t("הצגת התפריט", "Show sidebar") : t("הסתרת התפריט", "Hide sidebar")} title={collapsed ? t("הצגת התפריט", "Show sidebar") : t("הסתרת התפריט", "Hide sidebar")}>
            {isRTL() ? <PanelRight size={17} /> : <PanelLeft size={17} />}
          </button>
          <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted">{crumbs}</div>
          <div className="flex-1" />
          <GlobalSearch />
          {engine.demo && (
            <a href={href.settings()} className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[12px] font-medium text-amber-800 md:hidden">
              {t("מצב הדגמה", "Demo mode")}
            </a>
          )}
          <a
            href="https://github.com/yairbarak22/TutorAI/issues/new/choose"
            target="_blank"
            rel="noreferrer"
            className={topBtn}
          >
            <MessageSquare size={13} /> {t("משוב", "Feedback")}
          </a>
          <a href="https://github.com/yairbarak22/TutorAI/blob/main/docs/plugins.md" target="_blank" rel="noreferrer" className={topBtn}>
            {t("מדריך", "Guide")}
          </a>
          <a
            href="https://github.com/yairbarak22/TutorAI"
            target="_blank"
            rel="noreferrer"
            className={topBtn}
            title={t("אהבתם? תנו לנו כוכב ב-GitHub, זה עוזר לסטודנטים אחרים למצוא את הפרויקט", "Like it? Star us on GitHub. It helps other students find the project")}
          >
            <Star size={13} className="fill-amber-400 text-amber-500" /> {t("כוכב ב-GitHub", "Star on GitHub")}
          </a>
        </header>

        {import.meta.env.VITE_PREVIEW && (
          <div className="bg-red-600 px-4 py-1.5 text-center text-sm text-white">
            {t("⚠️ זו תצוגה מקדימה של שינוי שעוד לא אושר. השתמשו במצב הדגמה בלבד, ואל תזינו כאן מפתח API אמיתי.", "⚠️ This is a preview of an unapproved change. Use demo mode only and do not enter a real API key here.")}
          </div>
        )}
        <main className="mx-auto max-w-[1120px] px-4 py-8 md:px-10">
          {engine.lockWarning && (
            <div className="mb-5">
              <Alert kind="warn">{engine.lockWarning}</Alert>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}

/** Breadcrumb pieces for the top bar. */
export function Crumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <>
      {items.map((it, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1.5">
          {i > 0 && <ChevronForward size={13} className="text-slate-400" />}
          {it.href && i < items.length - 1 ? (
            <a href={it.href} className="truncate hover:text-ink">
              {it.label}
            </a>
          ) : (
            <span className={`truncate ${i === items.length - 1 ? "font-medium text-ink" : ""}`}>{it.label}</span>
          )}
        </span>
      ))}
    </>
  );
}
