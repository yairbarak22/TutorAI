import { useEffect, useState, type ReactNode } from "react";
import {
  BookOpen,
  ChartLine,
  ChevronLeft,
  Cloud,
  CloudAlert,
  Code,
  FileText,
  FolderOpen,
  GraduationCap,
  House,
  Layers,
  Menu,
  MessagesSquare,
  Network,
  Plus,
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

function Sidebar({ onNavigate, onNewCourse }: { onNavigate: () => void; onNewCourse: () => void }) {
  const engine = useEngine();
  const route = useRoute();
  const courses = engine.store.courses();
  const p = engine.persistence;
  const now = new Date().toISOString();
  const activeCourse = route.name === "course" ? route.id : null;
  return (
    <div className="flex h-full flex-col">
      <a href={href.home()} onClick={onNavigate} className="mx-3 mt-3 mb-4 flex h-10 items-center gap-2.5 rounded-lg px-1.5">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-ink text-white">
          <GraduationCap size={16} strokeWidth={2.2} />
        </span>
        <span className="text-[15px] font-semibold tracking-tight">RuecAI Teacher</span>
      </a>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="ניווט ראשי">
        <div className="space-y-0.5">
          <NavItem href={href.home()} icon={<House size={16} />} active={route.name === "home"} onClick={onNavigate}>
            בית
          </NavItem>
          <NavItem icon={<Plus size={16} />} onClick={onNewCourse}>
            קורס חדש
          </NavItem>
        </div>

        <div>
          <div className="mb-1 px-2.5 text-[12px] font-medium text-muted">הקורסים שלי</div>
          {courses.length === 0 && <div className="px-2.5 py-1 text-[13px] text-slate-400">עוד אין קורסים</div>}
          <div className="space-y-0.5">
            {courses.map((c) => {
              const open = activeCourse === c.id;
              const due = engine.store.dueCards(c.id, now).length;
              return (
                <div key={c.id}>
                  <NavItem
                    href={href.course(c.id)}
                    icon={<CourseMark id={c.id} name={c.name} />}
                    active={false}
                    onClick={onNavigate}
                    badge={!open && <ChevronLeft size={14} className="text-slate-300 opacity-0 group-hover:opacity-100" />}
                  >
                    <span className={open ? "font-medium text-ink" : ""}>{c.name}</span>
                  </NavItem>
                  {open && (
                    <div className="relative mt-0.5 mb-1 space-y-0.5 ps-3" role="navigation" aria-label="לשוניות הקורס">
                      <span className="absolute inset-y-1 start-[18px] w-px bg-black/[0.08]" aria-hidden />
                      {COURSE_SECTIONS.map((s) => (
                        <NavItem
                          key={s.id}
                          href={href.course(c.id, s.id)}
                          icon={<s.icon size={15} />}
                          active={route.name === "course" && route.tab === s.id}
                          onClick={onNavigate}
                          indent
                          badge={
                            s.id === "review" && due > 0 ? (
                              <span className="rounded-full bg-ink px-1.5 text-[11px] font-medium leading-[18px] text-white">{due}</span>
                            ) : undefined
                          }
                        >
                          {s.label}
                        </NavItem>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </nav>

      <div className="space-y-2 border-t border-black/[0.06] px-3 py-3">
        {engine.demo && (
          <a
            href={href.settings()}
            onClick={onNavigate}
            className="block rounded-xl border border-black/[0.08] bg-white p-3 transition hover:bg-black/[0.02]"
            title="התשובות מוקלטות מראש. הוסיפו מפתח API בהגדרות."
          >
            <div className="flex items-center gap-2 text-[13px] font-semibold">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              מצב הדגמה
            </div>
            <div className="mt-0.5 text-[12px] text-muted">הוסיפו מפתח API כדי לעבוד עם החומרים שלכם</div>
          </a>
        )}
        <NavItem href={href.settings()} icon={<SettingsIcon size={16} />} active={route.name === "settings"} onClick={onNavigate}>
          הגדרות
        </NavItem>
        <NavItem href="https://github.com/yairbarak22/RuecAI_Tutor" icon={<Code size={16} />}>
          קוד פתוח ב-GitHub
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

export function Shell({ children, crumbs, onNewCourse }: { children: ReactNode; crumbs: ReactNode; onNewCourse: () => void }) {
  const engine = useEngine();
  const route = useRoute();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [route]);
  return (
    <div className="min-h-screen bg-canvas">
      {/* Sidebar: fixed on desktop, drawer on mobile. */}
      <aside className="fixed inset-y-0 start-0 z-40 hidden w-[252px] border-e border-black/[0.06] bg-sidebar md:block">
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

      <div className="md:ps-[252px]">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-black/[0.06] bg-white/85 px-4 backdrop-blur-md md:px-8">
          <button className="grid h-9 w-9 place-items-center rounded-full hover:bg-hover md:hidden" onClick={() => setDrawer(true)} aria-label="תפריט">
            <Menu size={18} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13.5px] text-muted">{crumbs}</div>
          {engine.demo && (
            <a href={href.settings()} className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[12px] font-medium text-amber-800 md:hidden">
              מצב הדגמה
            </a>
          )}
          <a
            href="https://github.com/yairbarak22/RuecAI_Tutor/issues/new/choose"
            target="_blank"
            rel="noreferrer"
            className="hidden h-8 items-center gap-1.5 rounded-full border border-black/10 px-3 text-[13px] font-medium text-ink-2 hover:bg-hover sm:inline-flex"
          >
            <BookOpen size={14} /> משוב
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
          {engine.root.mode === "browser" && (
            <div className="mb-5">
              <Alert kind="info">
                הנתונים שמורים בתוך הדפדפן. מומלץ לגבות מדי פעם (הגדרות ← גיבוי), או לעבור ל-Chrome/Edge כדי לשמור בתיקייה רגילה.
              </Alert>
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
          {i > 0 && <span className="text-slate-300">/</span>}
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
