import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { t } from "../i18n.tsx";

export interface SelectOption {
  value: string;
  label: string;
  /** Optional secondary line (e.g. file type, count). Also searched. */
  hint?: string;
}

/** Lists longer than this get a search box automatically. */
const SEARCH_THRESHOLD = 6;

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[֑-ׇ̀-ͯ]/g, "") // Hebrew niqqud + Latin accents
    .replace(/["'׳״]/g, "");

/**
 * Styled dropdown with built-in search. Replaces native <select> so it matches the design system
 * and long lists (materials, concepts) can be filtered by typing.
 * The popup is portalled to <body> so it is never clipped by cards and never re-triggers a wrapping <label>.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder,
  searchable,
  size = "md",
  className = "",
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  searchable?: boolean;
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; right: number; width: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();

  const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  const withSearch = searchable ?? options.length > SEARCH_THRESHOLD;
  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return options;
    return options.filter((o) => norm(`${o.label} ${o.hint ?? ""}`).includes(q));
  }, [options, query]);

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const up = below < 280 && r.top > below;
    setPos({ top: up ? r.top - 6 : r.bottom + 6, left: r.left, right: window.innerWidth - r.right, width: r.width, up });
  };

  const openMenu = () => {
    place();
    setQuery("");
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };
  const choose = (o: SelectOption) => {
    onChange(o.value);
    close();
  };

  useLayoutEffect(() => {
    if (open) (withSearch ? search.current : list.current)?.focus();
  }, [open, withSearch]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!pop.current?.contains(n) && !btn.current?.contains(n)) close(false);
    };
    const onMove = () => place();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(filtered.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Home" && !withSearch) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && !withSearch) {
      e.preventDefault();
      setActive(filtered.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[active]) choose(filtered[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") close(false);
  };

  const sizes = { sm: "h-8 px-3 text-[13px]", md: "h-10 px-3.5 text-sm" };
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;

  return (
    <>
      <button
        ref={btn}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(e) => {
          if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
            e.preventDefault();
            openMenu();
          }
        }}
        className={`group flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border bg-white text-start transition ${
          open ? "border-black/30 ring-4 ring-black/[0.05]" : "border-black/10 hover:border-black/20"
        } focus:outline-none focus-visible:border-black/30 focus-visible:ring-4 focus-visible:ring-black/[0.05] ${sizes[size]} ${className}`}
      >
        <span className={`truncate ${selected ? "text-ink" : "text-slate-400"}`}>{selected?.label ?? placeholder ?? t("בחירה…", "Select…")}</span>
        <ChevronDown size={16} className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={pop}
            dir={rtl ? "rtl" : "ltr"}
            onKeyDown={onKey}
            style={{
              position: "fixed",
              ...(rtl ? { right: pos.right } : { left: pos.left }),
              width: Math.max(pos.width, 220),
              ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
            }}
            className="z-[60] overflow-hidden rounded-xl border border-black/[0.08] bg-white shadow-xl animate-[selectIn_120ms_ease-out]"
          >
            {withSearch && (
              <div className="flex items-center gap-2 border-b border-black/[0.06] px-3">
                <Search size={15} className="shrink-0 text-muted" />
                <input
                  ref={search}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("חיפוש…", "Search…")}
                  role="searchbox"
                  style={{ outline: "none" }}
                  aria-controls={listId}
                  aria-activedescendant={filtered[active] ? optionId(active) : undefined}
                  className="h-10 w-full bg-transparent text-sm placeholder:text-slate-400 focus:outline-none"
                />
              </div>
            )}
            <div
              ref={list}
              id={listId}
              role="listbox"
              tabIndex={withSearch ? -1 : 0}
              style={{ outline: "none" }}
              aria-activedescendant={!withSearch && filtered[active] ? optionId(active) : undefined}
              className="max-h-64 overflow-y-auto p-1 focus:outline-none"
            >
              {filtered.length === 0 && <div className="px-3 py-6 text-center text-sm text-muted">{t("לא נמצאו תוצאות", "No matches")}</div>}
              {filtered.map((o, i) => {
                const isSel = o.value === value;
                return (
                  <div
                    key={o.value}
                    id={optionId(i)}
                    data-idx={i}
                    role="option"
                    aria-selected={isSel}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(o)}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm ${i === active ? "bg-hover" : ""} ${
                      isSel ? "font-medium text-ink" : "text-ink-2"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <Highlight text={o.label} query={query} />
                      {o.hint && <span className="block truncate text-xs text-muted">{o.hint}</span>}
                    </span>
                    {isSel && <Check size={15} className="shrink-0" />}
                  </div>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  const q = query.trim();
  if (!q) return <span className="block truncate">{text}</span>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <span className="block truncate">{text}</span>;
  return (
    <span className="block truncate">
      {text.slice(0, i)}
      <mark className="rounded-sm bg-amber-100 text-inherit">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </span>
  );
}
