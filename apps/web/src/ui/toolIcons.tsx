import type { LucideIcon } from "lucide-react";
import { Box, CalendarDays, ClipboardCheck, FileText, Layers, ListChecks, MessagesSquare, Scale, Sigma, Workflow } from "lucide-react";
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
