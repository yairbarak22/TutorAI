import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import { X } from "lucide-react";
import { t } from "../i18n.tsx";

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-black/80 disabled:bg-slate-200 disabled:text-slate-400",
  secondary: "bg-white text-ink border border-black/10 hover:bg-hover disabled:text-slate-400",
  ghost: "text-ink-2 hover:bg-hover disabled:text-slate-400",
  danger: "bg-white text-red-600 border border-red-200 hover:bg-red-50",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "h-8 px-3 text-[13px]", md: "h-9 px-3.5 text-[13.5px]", lg: "h-11 px-5 text-[14.5px]" };
  return (
    <button
      {...props}
      className={`inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] font-medium transition-colors cursor-pointer disabled:cursor-not-allowed ${VARIANTS[variant]} ${sizes[size]} ${className}`}
    />
  );
}

export function Card({ children, className = "", ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={`rounded-2xl border border-black/[0.08] bg-white ${className}`}>
      {children}
    </div>
  );
}

export function ProgressBar({ value, className = "", color = "bg-ink" }: { value: number; className?: string; color?: string }) {
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06] ${className}`} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-slate-600" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink border-t-transparent" />
      {label}
    </span>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-[8vh] backdrop-blur-[2px]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${wide ? "max-w-4xl" : "max-w-lg"} rounded-3xl bg-white shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-hover hover:text-ink" aria-label={t("סגור", "Close")}>
            <X size={18} />
          </button>
        </div>
        <div className="px-6 pt-2 pb-6">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-14 text-center text-muted">
      <div className="mb-1 grid h-14 w-14 place-items-center rounded-2xl border border-black/[0.08] bg-sidebar text-3xl text-ink">{icon}</div>
      <div className="text-base font-semibold text-ink">{title}</div>
      {children}
    </div>
  );
}

export function Badge({ children, color = "slate" }: { children: ReactNode; color?: "slate" | "green" | "amber" | "red" | "blue" }) {
  const c = {
    slate: "bg-black/[0.05] text-ink-2",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    blue: "bg-sky-50 text-sky-700",
  }[color];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${c}`}>{children}</span>;
}

export function Alert({ kind = "info", children }: { kind?: "info" | "warn" | "error" | "success"; children: ReactNode }) {
  const c = {
    info: "bg-sidebar border-black/[0.08] text-ink-2",
    warn: "bg-amber-50/70 border-amber-200/70 text-amber-900",
    error: "bg-red-50/70 border-red-200/70 text-red-800",
    success: "bg-emerald-50/70 border-emerald-200/70 text-emerald-800",
  }[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${c}`}>
      {children}
    </div>
  );
}

export const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2 text-sm placeholder:text-slate-400 transition focus:border-black/30 focus:outline-none focus:ring-4 focus:ring-black/[0.05]";

export function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {help && <span className="block text-xs text-muted">{help}</span>}
    </label>
  );
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Page header: title, optional subtitle, actions on the far side. */
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A small section label, like the group headings in the sidebar. */
export function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h2 className={`mb-3 text-[13px] font-medium text-muted ${className}`}>{children}</h2>;
}

/** Rounded gradient square holding an icon — the visual signature of tools and quick actions. */
export function IconTile({ children, grad = 1, size = "md" }: { children: ReactNode; grad?: number; size?: "sm" | "md" | "lg" }) {
  const s = { sm: "h-8 w-8 rounded-lg", md: "h-11 w-11 rounded-xl", lg: "h-14 w-14 rounded-2xl" }[size];
  return <span className={`tile-grad-${((grad - 1) % 8) + 1} grid shrink-0 place-items-center text-ink/80 ${s}`}>{children}</span>;
}

/** Underline tabs (page-level sub navigation). */
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode }[] }) {
  return (
    <div className="mt-4 flex gap-5 border-b border-black/[0.08]" role="tablist">
      {items.map((it) => (
        <button
          key={it.id}
          role="tab"
          aria-selected={value === it.id}
          onClick={() => onChange(it.id)}
          className={`-mb-px border-b-2 pb-2.5 text-[13.5px] font-medium transition-colors ${
            value === it.id ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** A settings-style row: title and muted description on one side, an action on the other. */
export function Row({ title, desc, action, children, wide }: { title: ReactNode; desc?: ReactNode; action?: ReactNode; children?: ReactNode; wide?: boolean }) {
  return (
    <div className="border-b border-black/[0.06] py-5">
      <div className={`flex gap-4 ${wide ? "flex-col" : "flex-wrap items-center justify-between"}`}>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium text-ink">{title}</div>
          {desc && <div className="mt-0.5 text-[13px] leading-relaxed text-muted">{desc}</div>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {children}
    </div>
  );
}

/** Soft grey panel (settings-style section): light fill, no hard border. */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-[#f7f7f7] ${className}`}>{children}</div>;
}
