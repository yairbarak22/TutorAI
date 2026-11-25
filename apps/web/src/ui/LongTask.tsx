import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { clock, remainingText } from "../platform/timing.ts";
import { fmtNumber, t } from "../i18n.tsx";

export interface LongTaskProps {
  /** What is being made, e.g. "יוצר סיכום". */
  title: string;
  /** Ordered stage labels; `stage` is the index of the current one (stages.length = all done). */
  stages: string[];
  stage: number;
  /** Extra live detail for the current stage, e.g. "מפענח עמוד 4". */
  detail?: string;
  startedAt: number;
  expectedSec: number;
  /** Characters the model has written so far, and how many it usually writes for this task. */
  chars?: number;
  expectedChars?: number;
  /** Shown after a few seconds, e.g. "you can keep working elsewhere". */
  hint?: ReactNode;
  compact?: boolean;
  /** Known fraction done (0..1) when the task reports it, e.g. file processing. */
  progress?: number;
}

/** Re-render every `ms` while mounted (for live clocks). */
function useTick(ms = 250) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/**
 * Turns elapsed time, stage and streamed output into one honest, smooth, never-going-back progress
 * value plus a remaining-time estimate.
 */
function useEstimate(p: LongTaskProps) {
  useTick();
  const best = useRef(0);
  const writeStart = useRef<{ t: number; c: number } | null>(null);
  const now = Date.now();
  const elapsed = Math.max(0, (now - p.startedAt) / 1000);
  const exp = Math.max(1, p.expectedSec);

  // Time-based: linear to 90% at the expected time, then creeping toward 98%.
  const timeFrac = elapsed < exp ? (0.9 * elapsed) / exp : 0.9 + 0.08 * (1 - Math.exp(-(elapsed - exp) / exp));
  // Output-based: how much of a typical answer has been written.
  let writeFrac = 0;
  let remaining = Math.max(0, exp - elapsed);
  if (p.chars && p.chars > 0) {
    if (!writeStart.current) writeStart.current = { t: now, c: p.chars };
    if (p.expectedChars) {
      writeFrac = Math.min(0.97, p.chars / p.expectedChars);
      const dt = (now - writeStart.current.t) / 1000;
      const dc = p.chars - writeStart.current.c;
      if (dt > 2 && dc > 200) {
        const rate = dc / dt;
        remaining = Math.max(0, (p.expectedChars - p.chars) / rate);
      }
    }
  }
  if (p.progress != null && p.progress > 0.08 && elapsed > 3) {
    // Reported progress is the best predictor: remaining ≈ elapsed × (left / done).
    remaining = (elapsed * (1 - p.progress)) / p.progress;
  }
  const stageFloor = p.stages.length ? p.stage / p.stages.length : 0;
  const value = Math.min(
    0.99,
    Math.max(best.current, stageFloor, p.progress ?? 0, p.progress != null ? 0 : timeFrac, writeFrac ? 0.15 + 0.8 * writeFrac : 0),
  );
  best.current = value;
  const late = elapsed > exp * 1.25 && remaining < 3;
  return { elapsed, value, remaining, late };
}

function Bar({ value }: { value: number }) {
  return (
    <div className="wait-bar relative h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06]" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-ink transition-[width] duration-500 ease-out" style={{ width: `${Math.max(3, value * 100)}%` }} />
    </div>
  );
}

export function LongTask(p: LongTaskProps) {
  const { elapsed, value, remaining, late } = useEstimate(p);
  const words = p.chars ? Math.round(p.chars / 6) : 0;
  const current = p.stages[Math.min(p.stage, p.stages.length - 1)];
  const timeLine = late ? t("לוקח קצת יותר מהרגיל, עדיין עובד…", "Taking a bit longer than usual, still working…") : remainingText(remaining);

  if (p.compact)
    return (
      <div className="space-y-1.5" role="status" aria-live="polite">
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="wait-orb wait-orb-sm" aria-hidden />
          <span className="font-medium text-ink">{p.detail ?? current}</span>
          <span className="ms-auto shrink-0 tabular-nums text-muted">
            {clock(elapsed)} · {timeLine}
          </span>
        </div>
        <Bar value={value} />
      </div>
    );

  return (
    <div className="rounded-2xl border border-black/[0.08] bg-white p-6" role="status" aria-live="polite">
      <div className="flex items-start gap-4">
        <span className="wait-orb shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold tracking-tight">{p.title}</div>
          <div className="mt-0.5 text-[13.5px] text-ink-2">
            {p.detail ?? current}
            {words > 20 && (
              <span className="text-muted">
                {" · "}
                {t(`נכתבו עד עכשיו כ-${fmtNumber(words)} מילים`, `About ${fmtNumber(words)} words written so far`)}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-end">
          <div className="text-[15px] font-semibold tabular-nums" dir="ltr">
            {clock(elapsed)}
          </div>
          <div className="text-[12px] text-muted">{timeLine}</div>
        </div>
      </div>

      <div className="mt-5">
        <Bar value={value} />
      </div>

      <ol className="mt-5 grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
        {p.stages.map((s, i) => {
          const state = i < p.stage ? "done" : i === p.stage ? "now" : "next";
          return (
            <li key={s} className={`flex items-center gap-2 text-[13px] ${state === "next" ? "text-slate-400" : "text-ink"}`}>
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                  state === "done" ? "bg-ink text-white" : state === "now" ? "border-2 border-ink" : "border border-black/15"
                }`}
              >
                {state === "done" ? <Check size={12} strokeWidth={3} /> : state === "now" ? <span className="wait-dot h-1.5 w-1.5 rounded-full bg-ink" /> : null}
              </span>
              <span className={state === "now" ? "font-medium" : ""}>{s}</span>
            </li>
          );
        })}
      </ol>

      {p.hint && elapsed > 6 && <div className="mt-5 rounded-xl bg-[#f7f7f7] px-4 py-3 text-[12.5px] leading-relaxed text-ink-2">{p.hint}</div>}
    </div>
  );
}

/** Small inline "thinking" indicator (tutor before its first word, quick checks). */
export function Thinking({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-ink-2" role="status">
      <span className="wait-orb wait-orb-sm" aria-hidden />
      {label}
      <span className="wait-dots" aria-hidden>
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}
