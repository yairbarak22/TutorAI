import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  ChartLine,
  Check,
  ChevronLeft,
  ChevronsUpDown,
  Cloud,
  CloudAlert,
  Code,
  FileText,
  FolderOpen,
  GraduationCap,
  House,
  Layers,
  Menu,
  MessageSquare,
  MessagesSquare,
  Network,
  PanelRight,
  Plus,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  X,
} from "lucide-react";
import { useEngine } from "../engine.ts";
import { href, useRoute } from "../router.ts";
import { Alert } from "./components.tsx";

export const COURSE_SECTIONS = [
  { id: "materials", label: "חומרים", icon: FileText },
  { id: "concepts", label: "מפת מושגים", icon: Network },
  { id: "studio", label: "כלים", icon: Sparkles },
  { id: "tutor", label: "טוטור", icon: MessagesSquare },
  { id: "review", label: "חזרה", icon: Layers },
  { id: "progress", label: "התקדמות", icon: ChartLine },
  { id: "artifacts", label: "תוצרים", icon: FolderOpen },
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

const LAST_COURSE = "ruecai.lastCourse";
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

const GROUPS: { label: string; ids: (typeof COURSE_SECTIONS)[number]["id"][] }[] = [
  { label: "לימוד", ids: ["materials", "concepts", "tutor", "review"] },
  { label: "יצירה", ids: ["studio", "artifacts"] },
  { label: "מעקב", ids: ["progress"] },
];

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
        aria-label="בחירת קורס"
      >
        {current ? <CourseMark id={current.id} name={current.name} /> : <span className="grid h-5 w-5 place-items-center rounded-md bg-black/[0.06] text-muted"><BookOpen size={12} /></span>}
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{current?.name ?? "בחרו קורס"}</span>
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
            <Plus size={15} className="text-muted" /> קורס חדש
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
  const due = courseId ? engine.store.dueCards(courseId, new Date().toISOString()).length : 0;
  const inCourse = route.name === "course" && route.id === courseId;
  return (
    <div className="flex h-full flex-col">
      <a href={href.home()} onClick={onNavigate} className="mx-3 mt-3 mb-3 flex h-9 items-center gap-2 px-1.5">
        <GraduationCap size={19} strokeWidth={2.1} />
        <span className="text-[15.5px] font-semibold tracking-tight">RuecAI Teacher</span>
      </a>
      <CourseSwitcher currentId={courseId} onNavigate={onNavigate} onNewCourse={onNewCourse} />

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="ניווט ראשי">
        <div className="space-y-0.5">
          <NavItem href={href.home()} icon={<House size={16} />} active={route.name === "home"} onClick={onNavigate}>
            בית
          </NavItem>
          <NavItem icon={<Plus size={16} />} onClick={onNewCourse}>
            קורס חדש
          </NavItem>
        </div>

        {courseId ? (
          <div className="space-y-5" role="navigation" aria-label="לשוניות הקורס">
            {GROUPS.map((g) => (
              <div key={g.label}>
                <div className="mb-1 px-2.5 text-[12px] font-medium text-muted">{g.label}</div>
                <div className="space-y-0.5">
                  {g.ids.map((id) => {
                    const sec = COURSE_SECTIONS.find((x) => x.id === id)!;
                    return (
                      <NavItem
                        key={id}
                        href={href.course(courseId, id)}
                        icon={<sec.icon size={16} />}
                        active={inCourse && route.name === "course" && route.tab === id}
                        onClick={onNavigate}
                        badge={
                          id === "review" && due > 0 ? (
                            <span className="rounded-md bg-black/[0.06] px-1.5 text-[11px] font-medium leading-[18px] text-ink-2">{due}</span>
                          ) : id === "studio" ? (
                            <span className="rounded-md bg-black/[0.06] px-1.5 text-[11px] font-medium leading-[18px] text-ink-2">AI</span>
                          ) : undefined
                        }
                      >
                        {sec.label}
                      </NavItem>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-2.5 text-[13px] leading-relaxed text-muted">צרו קורס או פתחו קורס לדוגמה כדי לראות כאן את הכלים.</div>
        )}
      </nav>

      <div className="space-y-1 px-3 pt-2 pb-3">
        {engine.demo && (
          <a
            href={href.settings()}
            onClick={onNavigate}
            className="mb-2 flex items-center gap-3 rounded-xl border border-black/[0.08] bg-white p-2.5 shadow-sm transition hover:border-black/15"
            title="התשובות מוקלטות מראש. הוסיפו מפתח API בהגדרות."
          >
            <span className="tile-grad-4 h-9 w-9 shrink-0 rounded-full" />
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold">מצב הדגמה</span>
              <span className="block truncate text-[12px] text-muted">הוסיפו מפתח API ←</span>
            </span>
          </a>
        )}
        <NavItem href={href.settings()} icon={<SettingsIcon size={16} />} active={route.name === "settings"} onClick={onNavigate}>
          הגדרות
        </NavItem>
        <div className="flex items-center gap-2 px-2.5 pt-1 text-[12px] text-muted" title={engine.root.files.label}>
          {p.lastError ? <CloudAlert size={14} className="text-red-500" /> : <Cloud size={14} />}
          <span className="truncate">
            {engine.root.mode === "folder" ? "תיקייה מקומית" : "בתוך הדפדפן"} ·{" "}
            {p.lastError ? <span className="text-red-600">שמירה נכשלה</span> : p.lastSaved ? "נשמר" : "מוכן"}
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
    ...engine.store.courses().map((c) => ({ label: c.name, hint: "קורס", to: href.course(c.id) })),
    ...(courseId ? COURSE_SECTIONS.map((sec) => ({ label: sec.label, hint: "מדור", to: href.course(courseId, sec.id) })) : []),
    ...(courseId
      ? engine.tools.filter((t) => t.manifest.output !== "chat").map((t) => ({ label: t.manifest.name, hint: "כלי", to: href.course(courseId, "studio", t.manifest.id) }))
      : []),
    { label: "הגדרות", hint: "עמוד", to: href.settings() },
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
        placeholder="חיפוש…"
        aria-label="חיפוש"
        className="h-8 w-full rounded-lg border border-black/10 bg-white ps-9 pe-14 text-[13px] outline-none placeholder:text-slate-400 focus:border-black/25"
      />
      <span className="pointer-events-none absolute left-2 top-1/2 flex -translate-y-1/2 gap-0.5" dir="ltr">
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
  const [collapsed, setCollapsed] = useState(() => kvGet("ruecai.sidebar") === "collapsed");
  const [bannerClosed, setBannerClosed] = useState(() => kvGet("ruecai.banner") === "closed");
  useEffect(() => setDrawer(false), [route]);
  const toggle = () => {
    kvSet("ruecai.sidebar", collapsed ? "open" : "collapsed");
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
              aria-label="סגירת התפריט"
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
              הנתונים שמורים בתוך הדפדפן. מומלץ לגבות מדי פעם, או לעבור ל-Chrome/Edge כדי לשמור בתיקייה.{" "}
              <a href={href.settings()} className="font-medium text-white underline underline-offset-2">
                לגיבוי
              </a>
            </span>
            <button
              className="absolute end-3 grid h-6 w-6 place-items-center rounded text-white/70 hover:text-white"
              onClick={() => (kvSet("ruecai.banner", "closed"), setBannerClosed(true))}
              aria-label="סגירת ההודעה"
            >
              <X size={15} />
            </button>
          </div>
        )}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-black/[0.06] bg-white/85 px-4 backdrop-blur-md md:px-8">
          <button className="grid h-9 w-9 place-items-center rounded-lg hover:bg-hover md:hidden" onClick={() => setDrawer(true)} aria-label="תפריט">
            <Menu size={18} />
          </button>
          <button className="hidden h-8 w-8 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink md:grid" onClick={toggle} aria-label={collapsed ? "הצגת התפריט" : "הסתרת התפריט"} title={collapsed ? "הצגת התפריט" : "הסתרת התפריט"}>
            <PanelRight size={17} />
          </button>
          <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted">{crumbs}</div>
          <div className="flex-1" />
          <GlobalSearch />
          {engine.demo && (
            <a href={href.settings()} className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[12px] font-medium text-amber-800 md:hidden">
              מצב הדגמה
            </a>
          )}
          <a
            href="https://github.com/yairbarak22/RuecAI_Tutor/issues/new/choose"
            target="_blank"
            rel="noreferrer"
            className={topBtn}
          >
            <MessageSquare size={13} /> משוב
          </a>
          <a href="https://github.com/yairbarak22/RuecAI_Tutor/blob/main/docs/plugins.md" target="_blank" rel="noreferrer" className={topBtn}>
            מדריך
          </a>
          <a href="https://github.com/yairbarak22/RuecAI_Tutor" target="_blank" rel="noreferrer" className={topBtn}>
            <Code size={13} /> GitHub
          </a>
        </header>

        {import.meta.env.VITE_PREVIEW && (
          <div className="bg-red-600 px-4 py-1.5 text-center text-sm text-white">
            ⚠️ זו תצוגה מקדימה של שינוי שעוד לא אושר. השתמשו במצב הדגמה בלבד, ואל תזינו כאן מפתח API אמיתי.
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
          {i > 0 && <ChevronLeft size={13} className="text-slate-400" />}
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
