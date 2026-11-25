import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Box, Layers, ListChecks, Network, Search, X } from "lucide-react";
import { ancestorsOf, buildConceptGraph, conceptInfos, masteryLevel, sectionIdFromKey, type MasteryLevel } from "@ruecai/core";
import { useEngine } from "../engine.ts";
import { go, href } from "../router.ts";
import { Button, Card, Empty } from "../ui/components.tsx";
import { CitationChips } from "../ui/Citations.tsx";
import { t } from "../i18n.tsx";
import { isRTL } from "@ruecai/sdk";

/** Display name of a mastery level, in the current language. */
export function masteryLabel(l: MasteryLevel): string {
  return {
    new: t("טרם תורגל", "Not practiced yet"),
    weak: t("דורש חיזוק", "Needs work"),
    progress: t("בתהליך", "In progress"),
    strong: t("שולט", "Mastered"),
  }[l];
}

const LEVEL_STYLE: Record<MasteryLevel, { chip: string; node: string; dot: string }> = {
  new: { chip: "bg-black/[0.05] text-ink-2", node: "bg-white border-black/10", dot: "bg-slate-300" },
  weak: { chip: "bg-red-50 text-red-700", node: "bg-red-50/70 border-red-200", dot: "bg-red-500" },
  progress: { chip: "bg-amber-50 text-amber-700", node: "bg-amber-50/70 border-amber-200", dot: "bg-amber-500" },
  strong: { chip: "bg-emerald-50 text-emerald-700", node: "bg-emerald-50/70 border-emerald-200", dot: "bg-emerald-500" },
};

/** Below this many visible concepts every link is drawn; above it only the focused concept's links. */
const ALL_EDGES_MAX = 24;

type Item = {
  id: number;
  name: string;
  name_en: string;
  definition: string;
  prerequisites: string[];
  section_ids: string[];
  level: MasteryLevel;
  sourceId: number | null;
};

export function Concepts({ courseId }: { courseId: number }) {
  const engine = useEngine();
  const raw = engine.store.concepts(courseId);
  const infos = conceptInfos(engine.store, courseId);
  const sourceName = new Map(engine.store.sources(courseId).map((s) => [s.id, s.name.replace(/\.[a-z0-9]+$/i, "")]));
  const items: Item[] = raw.map((c, i) => {
    const first = c.section_ids[0];
    const sourceId = first ? (engine.store.section(sectionIdFromKey(first))?.source_id ?? null) : null;
    return { ...c, level: masteryLevel(infos[i].mastery, infos[i].attempts), sourceId };
  });
  const key = JSON.stringify(items.map((c) => [c.name, c.prerequisites]));
  const graph = useMemo(() => buildConceptGraph(items), [key]);
  const byName = new Map(items.map((c) => [c.name, c]));

  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [lectures, setLectures] = useState<Set<number>>(new Set());
  const [weakOnly, setWeakOnly] = useState(false);

  // Visible set: lecture filter, then "needs work" (weak concepts plus what they rest on).
  const visible = useMemo(() => {
    let v = items.filter((c) => lectures.size === 0 || (c.sourceId !== null && lectures.has(c.sourceId))).map((c) => c.name);
    if (weakOnly) {
      const keep = new Set<string>();
      for (const n of v)
        if (byName.get(n)!.level === "weak") {
          keep.add(n);
          ancestorsOf(graph, n).forEach((a) => keep.add(a));
        }
      v = v.filter((n) => keep.has(n));
    }
    return new Set(v);
  }, [key, lectures, weakOnly, JSON.stringify(items.map((c) => c.level))]);

  const focus = hovered ?? selected;
  const related = useMemo(() => {
    if (!focus) return null;
    const s = ancestorsOf(graph, focus);
    s.add(focus);
    (graph.children.get(focus) ?? []).forEach((c) => s.add(c));
    return s;
  }, [focus, graph]);

  const q = query.trim().toLowerCase();
  const matches = (c: Item) => !q || c.name.toLowerCase().includes(q) || c.name_en.toLowerCase().includes(q);

  useEffect(() => {
    if (selected && !visible.has(selected)) setSelected(null);
  }, [visible, selected]);

  useEffect(() => {
    if (!q) return;
    const first = items.find((c) => visible.has(c.name) && matches(c));
    if (first) document.querySelector(`[data-concept="${CSS.escape(first.name)}"]`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [q]);

  if (items.length === 0)
    return (
      <Empty icon={<Network size={26} strokeWidth={1.6} />} title={t("עוד אין מושגים", "No concepts yet")}>
        {t("המושגים מחולצים אוטומטית מהחומרים שהעליתם.", "Concepts are extracted automatically from the materials you upload.")}{" "}
        <a className="underline" href={href.course(courseId, "materials")}>
          {t("העלו חומר", "Upload material")}
        </a>
        .
      </Empty>
    );

  const lectureIds = [...new Set(items.map((c) => c.sourceId).filter((x): x is number => x !== null))];
  const columns = graph.levels.map((col) => col.filter((n) => visible.has(n))).filter((col) => col.length > 0);
  const showAll = !focus && visible.size <= ALL_EDGES_MAX;
  const focusAnc = focus ? ancestorsOf(graph, focus) : null;
  const edges = graph.edges.filter(([u, v]) => {
    if (!visible.has(u) || !visible.has(v)) return false;
    if (focus) return u === focus || v === focus || focusAnc!.has(v);
    return showAll;
  });
  const sel = selected ? byName.get(selected) : undefined;
  const weakCount = items.filter((c) => c.level === "weak").length;

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("חיפוש מושג…", "Find a concept…")}
            aria-label={t("חיפוש מושג", "Find a concept")}
            className="h-9 w-full rounded-xl border border-black/10 bg-white ps-9 pe-3 text-sm placeholder:text-slate-400 focus:border-black/30 focus:outline-none focus:ring-4 focus:ring-black/[0.05]"
          />
        </div>
        <Toggle on={weakOnly} onClick={() => setWeakOnly(!weakOnly)} disabled={weakCount === 0}>
          {t(`מה לחזק (${weakCount})`, `Needs work (${weakCount})`)}
        </Toggle>
        <div className="ms-auto flex flex-wrap items-center gap-1.5 text-xs">
          {(Object.keys(LEVEL_STYLE) as MasteryLevel[]).map((l) => (
            <span key={l} className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 ${LEVEL_STYLE[l].chip}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${LEVEL_STYLE[l].dot}`} />
              {masteryLabel(l)}
            </span>
          ))}
        </div>
      </div>
      {lectureIds.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("סינון לפי קובץ", "Filter by file")}>
          <Toggle on={lectures.size === 0} onClick={() => setLectures(new Set())}>
            {t("כל החומרים", "All materials")}
          </Toggle>
          {lectureIds.map((id) => (
            <Toggle
              key={id}
              on={lectures.has(id)}
              onClick={() => {
                const next = new Set(lectures);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                setLectures(next);
              }}
            >
              <span className="max-w-[16rem] truncate">{sourceName.get(id)}</span>
            </Toggle>
          ))}
        </div>
      )}

      {sel && (
        <ConceptPanel
          c={sel}
          courseId={courseId}
          lecture={sel.sourceId !== null ? sourceName.get(sel.sourceId) : undefined}
          parents={graph.parents.get(sel.name) ?? []}
          children={graph.children.get(sel.name) ?? []}
          onPick={setSelected}
          onClose={() => setSelected(null)}
        />
      )}
      <Card className="overflow-hidden">
        {columns.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">{t("אין מושגים שמתאימים לסינון.", "No concepts match the filter.")}</p>
        ) : (
          <Board
            columns={columns}
            edges={edges}
            faint={showAll}
            render={(name) => {
              const c = byName.get(name)!;
              const dim = (related && !related.has(name)) || (q && !matches(c));
              return (
                <button
                  type="button"
                  data-concept={name}
                  data-testid="concept-card"
                  aria-pressed={selected === name}
                  onClick={() => setSelected(selected === name ? null : name)}
                  onMouseEnter={() => setHovered(name)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(name)}
                  onBlur={() => setHovered(null)}
                  className={`relative z-[1] w-full cursor-pointer rounded-xl border px-3 py-2 text-start transition ${LEVEL_STYLE[c.level].node} ${
                    selected === name ? "ring-2 ring-ink" : "hover:border-black/30"
                  } ${dim ? "opacity-25" : ""} ${q && matches(c) ? "ring-2 ring-amber-400" : ""}`}
                >
                  <span className="flex items-start gap-2">
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${LEVEL_STYLE[c.level].dot}`} />
                    <span className="line-clamp-2 text-[13px] font-medium leading-5 text-ink">{name}</span>
                  </span>
                </button>
              );
            }}
          />
        )}
        <p className="border-t border-black/[0.06] px-4 py-2 text-xs text-muted">
          {visible.size > ALL_EDGES_MAX
            ? t("כל שלב בנוי על השלבים שמעליו. העבירו את העכבר על מושג כדי לראות על מה הוא נשען, ולחצו לפרטים.", "Each stage builds on the ones above it. Hover a concept to see what it rests on; click for details.")
            : t("כל שלב בנוי על השלבים שמעליו. קו בין מושגים = כדאי להבין את הראשון לפני השני. לחצו על מושג לפרטים.", "Each stage builds on the ones above it. A line = understand the first before the second. Click a concept for details.")}
        </p>
      </Card>
    </div>
  );
}

function Toggle({ on, onClick, disabled, children }: { on: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 cursor-pointer items-center rounded-full border px-3 text-[13px] transition disabled:cursor-not-allowed disabled:opacity-40 ${
        on ? "border-ink bg-ink text-white" : "border-black/10 bg-white text-ink-2 hover:bg-hover"
      }`}
    >
      {children}
    </button>
  );
}

const stageName = (i: number) => (i === 0 ? t("יסודות", "Foundations") : t(`שלב ${i + 1}`, `Stage ${i + 1}`));

/** Rows of concepts (foundations on top), each row wrapping to the page width, with an SVG layer for the links. */
function Board({ columns, edges, faint, render }: { columns: string[][]; edges: [string, string][]; faint: boolean; render: (name: string) => React.ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<string[]>([]);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const draw = () => {
      const base = el.getBoundingClientRect();
      const box = (n: string) => el.querySelector(`[data-concept="${CSS.escape(n)}"]`)?.getBoundingClientRect();
      const out: string[] = [];
      for (const [u, v] of edges) {
        const a = box(u);
        const b = box(v);
        if (!a || !b) continue;
        // prerequisite rows are above: bottom-centre → top-centre, vertical S-curve
        const x1 = a.left + a.width / 2 - base.left;
        const y1 = a.bottom - base.top;
        const x2 = b.left + b.width / 2 - base.left;
        const y2 = b.top - base.top;
        const dy = Math.max(18, (y2 - y1) / 2);
        out.push(`M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`);
      }
      setPaths(out);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [edges, columns]);

  return (
    <div ref={wrap} className="relative space-y-6 p-4">
      <svg className="pointer-events-none absolute top-0 left-0 h-full w-full overflow-visible" aria-hidden>
        <defs>
          <marker id="cm-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill={faint ? "#c4c4c8" : "#0f0f10"} />
          </marker>
        </defs>
        {paths.map((d, i) => (
          <path key={i} d={d} fill="none" stroke={faint ? "#d4d4d8" : "#0f0f10"} strokeOpacity={faint ? 1 : 0.55} strokeWidth={faint ? 1 : 1.5} markerEnd="url(#cm-arrow)" />
        ))}
      </svg>
      {columns.map((row, i) => (
        <section key={i} aria-label={stageName(i)}>
          <header className="mb-2 flex items-center gap-2 text-xs">
            <span className="font-semibold text-ink-2">{stageName(i)}</span>
            <span className="text-muted">{row.length}</span>
            <span className="h-px flex-1 bg-black/[0.06]" />
          </header>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2 sm:gap-3">
            {row.map((n) => (
              <div key={n}>{render(n)}</div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ConceptPanel({
  c,
  courseId,
  lecture,
  parents,
  children,
  onPick,
  onClose,
}: {
  c: Item;
  courseId: number;
  lecture?: string;
  parents: string[];
  children: string[];
  onPick: (n: string) => void;
  onClose: () => void;
}) {
  const Back = isRTL() ? ArrowRight : ArrowLeft;
  const Fwd = isRTL() ? ArrowLeft : ArrowRight;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <Card
      className="fixed inset-x-3 bottom-3 z-40 max-h-[60vh] overflow-y-auto p-5 shadow-xl sm:inset-x-auto sm:end-5 sm:bottom-5 sm:w-[340px] sm:max-h-[75vh]"
      data-testid="concept-panel"
      role="dialog"
      aria-label={c.name}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-6">{c.name}</h3>
          {c.name_en && (
            <div className="text-xs text-muted" dir="ltr">
              {c.name_en}
            </div>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label={t("סגירה", "Close")} className="cursor-pointer rounded-lg p-1 text-muted hover:bg-hover">
          <X size={16} />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
        <span className={`rounded-full px-2 py-0.5 ${LEVEL_STYLE[c.level].chip}`}>{masteryLabel(c.level)}</span>
        {lecture && <span className="max-w-full truncate rounded-full bg-black/[0.04] px-2 py-0.5 text-ink-2">{lecture}</span>}
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-700">{c.definition}</p>
      {parents.length > 0 && (
        <Links icon={<Back size={13} />} label={t("כדאי ללמוד קודם", "Learn first")} names={parents} onPick={onPick} />
      )}
      {children.length > 0 && <Links icon={<Fwd size={13} />} label={t("פותח את הדרך אל", "Leads to")} names={children} onPick={onPick} />}
      <CitationChips ids={c.section_ids.slice(0, 4)} />
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => go(href.course(courseId, "studio", `quiz?concept=${encodeURIComponent(c.name)}`))}>
          <ListChecks size={13} /> {t("תרגול", "Practice")}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => go(href.course(courseId, "studio", `explainer?concept=${encodeURIComponent(c.name)}`))}>
          <Box size={13} /> {t("הסבר אינטראקטיבי", "Interactive explainer")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => go(href.course(courseId, "studio", `flashcards?concept=${encodeURIComponent(c.name)}`))}>
          <Layers size={13} /> {t("כרטיסיות", "Flashcards")}
        </Button>
      </div>
    </Card>
  );
}

function Links({ icon, label, names, onPick }: { icon: React.ReactNode; label: string; names: string[]; onPick: (n: string) => void }) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center gap-1 text-xs font-medium text-ink-2">
        {icon}
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {names.map((n) => (
          <button key={n} type="button" onClick={() => onPick(n)} className="cursor-pointer rounded-full border border-black/10 bg-white px-2.5 py-0.5 text-xs hover:bg-hover">
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
