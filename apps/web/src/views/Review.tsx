import { useMemo, useState } from "react";
import { CircleCheck, Layers } from "lucide-react";
import { previewIntervals, type ReviewGrade } from "@tutorai/core";
import { useEngine } from "../engine.ts";
import { href } from "../router.ts";
import { Button, Card, Empty, ProgressBar } from "../ui/components.tsx";
import { Markdown } from "../ui/Markdown.tsx";
import { CitationChips } from "../ui/Citations.tsx";
import { t } from "../i18n.tsx";

const buttons = (): { g: ReviewGrade; label: string; cls: string }[] => [
  { g: "again", label: t("שכחתי", "Again"), cls: "bg-red-600 hover:bg-red-700" },
  { g: "hard", label: t("קשה", "Hard"), cls: "bg-amber-600 hover:bg-amber-700" },
  { g: "good", label: t("טוב", "Good"), cls: "bg-emerald-600 hover:bg-emerald-700" },
  { g: "easy", label: t("קל", "Easy"), cls: "bg-brand-600 hover:bg-brand-700" },
];

/** Daily spaced-repetition session (FSRS). */
export function Review({ courseId }: { courseId: number }) {
  const engine = useEngine();
  const [sessionStart] = useState(() => new Date().toISOString());
  const queue = engine.store.dueCards(courseId, sessionStart);
  const [initial] = useState(queue.length);
  const [shown, setShown] = useState(false);
  const card = queue[0];
  const intervals = useMemo(() => (card ? previewIntervals(card.fsrs, new Date()) : null), [card?.id, card?.fsrs]);

  if (engine.store.cardCount(courseId) === 0)
    return (
      <Empty icon={<Layers size={26} strokeWidth={1.6} />} title={t("עוד אין כרטיסיות", "No flashcards yet")}>
        <a className="underline" href={href.course(courseId, "studio", "flashcards")}>
          {t("צרו כרטיסיות מהחומר", "Create flashcards from your material")}
        </a>
      </Empty>
    );
  if (!card)
    return (
      <Empty icon={<CircleCheck size={26} strokeWidth={1.6} />} title={t("סיימתם את החזרה להיום!", "You're done reviewing for today!")}>
        {t("הכרטיסיות יחזרו בדיוק כשתהיו קרובים לשכוח אותן.", "The next cards will come back just as you're about to forget them.")}
      </Empty>
    );

  const done = Math.max(0, initial - queue.length);
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-center gap-3 text-sm text-slate-600">
        <span>
          {done} / {Math.max(initial, done + queue.length)}
        </span>
        <ProgressBar value={done / Math.max(1, initial)} />
      </div>
      <Card className="min-h-[220px] space-y-4 p-6" data-testid="review-card">
        <div className="text-xs text-slate-400">{card.concept}</div>
        <Markdown text={card.front} className="text-lg" />
        {shown && (
          <div className="border-t border-slate-100 pt-4">
            <Markdown text={card.back} />
            <CitationChips ids={card.citations} />
          </div>
        )}
      </Card>
      {!shown ? (
        <Button size="lg" className="w-full" onClick={() => setShown(true)}>
          {t("הצגת התשובה", "Show answer")}
        </Button>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {buttons().map((b) => (
            <button
              key={b.g}
              className={`rounded-lg px-2 py-3 text-white ${b.cls}`}
              onClick={() => {
                engine.review(card.id, card.fsrs, b.g, courseId, card.concept);
                setShown(false);
              }}
            >
              <div className="font-semibold">{b.label}</div>
              <div className="text-xs opacity-80">{intervals?.[b.g]}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
