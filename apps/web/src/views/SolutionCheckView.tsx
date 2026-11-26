import { useState } from "react";
import { Check, CircleHelp, Lightbulb, RotateCcw, Sigma, X } from "lucide-react";
import type { SolutionCheck } from "@ruecai/sdk";
import { go, href } from "../router.ts";
import { Badge, Button, Card, Panel } from "../ui/components.tsx";
import { Markdown } from "../ui/Markdown.tsx";
import { CitationChips } from "../ui/Citations.tsx";
import { t } from "../i18n.tsx";

/** Step-by-step feedback on the student's own solution, with hints revealed one at a time. */
export function SolutionCheckView({ c, courseId, photo }: { c: SolutionCheck; courseId: number; photo?: string }) {
  const [revealed, setRevealed] = useState(0);
  const [showFix, setShowFix] = useState(false);
  const verdict = {
    correct: { label: t("הפתרון נכון", "Your solution is correct"), color: "green" as const },
    partial: { label: t("בכיוון הנכון, עם טעות", "On the right track, with a mistake"), color: "amber" as const },
    incorrect: { label: t("יש טעות בפתרון", "There is a mistake"), color: "red" as const },
  }[c.verdict];
  const checked = c.steps.filter((s) => s.verified && s.verified !== "unknown").length;

  return (
    <div className="space-y-4" data-testid="solution-check">
      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge color={verdict.color}>{verdict.label}</Badge>
          {checked > 0 && (
            <Badge color="blue">
              <Sigma size={11} /> {t(`${checked} שלבים אומתו ב-SymPy`, `${checked} steps verified with SymPy`)}
            </Badge>
          )}
        </div>
        <div className="flex gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium text-muted">{t("השאלה", "The question")}</div>
            <Markdown text={c.problem} />
          </div>
          {photo && (
            <a href={photo} target="_blank" rel="noreferrer" className="shrink-0">
              <img src={photo} alt={t("הפתרון שצילמתם", "Your photo")} className="h-24 w-24 rounded-xl border border-black/10 object-cover" />
            </a>
          )}
        </div>
      </Card>

      <ol className="space-y-2">
        {c.steps.map((s, i) => {
          const first = i === c.first_error;
          const icon =
            s.status === "correct" ? (
              <Check size={14} className="text-emerald-600" />
            ) : s.status === "error" ? (
              <X size={14} className="text-red-600" />
            ) : (
              <CircleHelp size={14} className="text-amber-600" />
            );
          return (
            <li
              key={i}
              className={`rounded-2xl border bg-white p-4 ${first ? "border-red-300 ring-2 ring-red-100" : "border-black/[0.08]"}`}
              data-testid="solution-step"
            >
              <div className="flex items-start gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-black/[0.05] text-[12px] font-medium">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <Markdown text={s.text} />
                  {(s.comment || first) && (
                    <div className={`mt-1 text-[13px] ${s.status === "error" ? "text-red-700" : "text-muted"}`}>
                      {first && <span className="font-semibold">{t("כאן הטעות הראשונה. ", "First mistake is here. ")}</span>}
                      {s.comment && <Markdown text={s.comment} className="inline" />}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-black/[0.04]">{icon}</span>
                  {s.verified === "pass" && <span className="text-[11px] font-medium text-emerald-700">{t("SymPy ✓", "SymPy ✓")}</span>}
                  {s.verified === "fail" && <span className="text-[11px] font-medium text-red-700">{t("SymPy ✗", "SymPy ✗")}</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {c.first_error >= 0 && (
        <Panel className="space-y-3 p-5">
          <div className="flex items-center gap-2 text-[14px] font-semibold">
            <Lightbulb size={16} className="text-amber-600" /> {t("רמזים", "Hints")}
          </div>
          {c.hints.slice(0, revealed).map((h, i) => (
            <div key={i} className="flex gap-2 rounded-xl bg-white px-3 py-2 text-[14px]">
              <span className="mt-[0.6rem] shrink-0 text-[12px] font-medium text-muted">{i + 1}.</span>
              <Markdown text={h} className="min-w-0 flex-1" />
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {revealed < c.hints.length && (
              <Button size="sm" onClick={() => setRevealed(revealed + 1)}>
                <Lightbulb size={13} /> {revealed === 0 ? t("רמז ראשון", "First hint") : t("רמז נוסף", "Another hint")}
              </Button>
            )}
            {revealed >= Math.min(1, c.hints.length) && c.fix && !showFix && (
              <Button size="sm" variant="secondary" onClick={() => setShowFix(true)}>
                {t("הצגת התיקון לשלב הזה", "Show the fix for this step")}
              </Button>
            )}
          </div>
          {showFix && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2">
              <div className="text-[12px] font-medium text-emerald-700">{t("תיקון השלב", "Corrected step")}</div>
              <Markdown text={c.fix} />
            </div>
          )}
          <p className="text-[12.5px] text-muted">
            {t(
              "נסו לתקן בעצמכם לפני שאתם מסתכלים על התיקון. הטעות נשמרה במחברת הטעויות ותחזור אליכם כשאלה חדשה.",
              "Try fixing it yourself before looking at the fix. The mistake was saved to your notebook and will come back as a new question.",
            )}
          </p>
        </Panel>
      )}

      <CitationChips ids={c.citations} />
      <Button variant="secondary" onClick={() => go(href.course(courseId, "studio", "check-solution"))}>
        <RotateCcw size={14} /> {t("לבדוק פתרון מתוקן", "Check a corrected solution")}
      </Button>
    </div>
  );
}
