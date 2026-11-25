import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-300",
  secondary: "bg-white text-brand-700 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400",
  ghost: "text-brand-700 hover:bg-brand-50 disabled:text-slate-400",
  danger: "bg-white text-red-700 border border-red-200 hover:bg-red-50",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "px-2.5 py-1 text-sm", md: "px-4 py-2", lg: "px-6 py-3 text-lg" };
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors cursor-pointer disabled:cursor-not-allowed ${VARIANTS[variant]} ${sizes[size]} ${className}`}
    />
  );
}

export function Card({ children, className = "", ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function ProgressBar({ value, className = "", color = "bg-brand-500" }: { value: number; className?: string; color?: string }) {
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-slate-100 ${className}`} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-slate-600" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[6vh]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${wide ? "max-w-4xl" : "max-w-xl"} rounded-2xl bg-white shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-2xl leading-none text-slate-500 hover:bg-slate-100" aria-label="סגור">
            ×
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-14 text-center text-slate-600">
      <div className="text-5xl">{icon}</div>
      <div className="text-lg font-semibold text-slate-800">{title}</div>
      {children}
    </div>
  );
}

export function Badge({ children, color = "slate" }: { children: ReactNode; color?: "slate" | "green" | "amber" | "red" | "blue" }) {
  const c = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-800",
    blue: "bg-brand-100 text-brand-700",
  }[color];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${c}`}>{children}</span>;
}

export function Alert({ kind = "info", children }: { kind?: "info" | "warn" | "error" | "success"; children: ReactNode }) {
  const c = {
    info: "bg-brand-50 border-brand-100 text-brand-700",
    warn: "bg-amber-50 border-amber-200 text-amber-900",
    error: "bg-red-50 border-red-200 text-red-800",
    success: "bg-emerald-50 border-emerald-200 text-emerald-800",
  }[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${c}`}>
      {children}
    </div>
  );
}

export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100";

export function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {help && <span className="block text-xs text-slate-500">{help}</span>}
    </label>
  );
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
