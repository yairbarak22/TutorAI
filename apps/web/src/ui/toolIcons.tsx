import type { LucideIcon } from "lucide-react";
import { Box, CalendarDays, ScanLine, ClipboardCheck, FileText, Layers, ListChecks, MessagesSquare, Scale, Sigma, Workflow } from "lucide-react";
import { IconTile } from "./components.tsx";

/** Line icon + gradient for built-in tools. Community tools fall back to their manifest emoji. */
const TOOL_ICONS: Record<string, { icon: LucideIcon; grad: number }> = {
  summary: { icon: FileText, grad: 6 },
  quiz: { icon: ListChecks, grad: 1 },
  flashcards: { icon: Layers, grad: 2 },
  diagram: { icon: Workflow, grad: 3 },
  explainer: { icon: Box, grad: 4 },
  "exam-from-samples": { icon: ClipboardCheck, grad: 5 },
  "study-plan": { icon: CalendarDays, grad: 7 },
  "case-brief": { icon: Scale, grad: 8 },
  "worked-example": { icon: Sigma, grad: 3 },
  tutor: { icon: MessagesSquare, grad: 1 },
  "check-solution": { icon: ScanLine, grad: 7 },
};

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export function ToolTile({ id, emoji, size = "md" }: { id: string; emoji: string; size?: "sm" | "md" | "lg" }) {
  const t = TOOL_ICONS[id];
  const px = { sm: 15, md: 20, lg: 26 }[size];
  return (
    <IconTile grad={t?.grad ?? (hash(id) % 8) + 1} size={size}>
      {t ? <t.icon size={px} strokeWidth={1.8} /> : <span className={size === "lg" ? "text-2xl" : "text-lg"}>{emoji}</span>}
    </IconTile>
  );
}

/** Voice-library style avatar: a soft grey square holding a gradient orb with the tool icon. */
export function ToolOrb({ id, emoji }: { id: string; emoji: string }) {
  const t = TOOL_ICONS[id];
  const g = t?.grad ?? (hash(id) % 8) + 1;
  return (
    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-black/[0.04]">
      <span className={`tile-grad-${g} grid h-9 w-9 place-items-center rounded-full text-ink/80 shadow-[inset_0_-6px_12px_rgba(0,0,0,0.08)]`}>
        {t ? <t.icon size={17} strokeWidth={1.9} /> : <span className="text-base">{emoji}</span>}
      </span>
    </span>
  );
}
