import { useMemo, useState } from "react";
import { masteryLevel, MASTERY_LABEL, conceptInfos, type MasteryLevel } from "@ruecai/core";
import { useEngine } from "../engine.ts";
import { go, href } from "../router.ts";
import { Button, Card, Empty } from "../ui/components.tsx";
import { CitationChips } from "../ui/Citations.tsx";
import { MermaidView } from "../ui/Visuals.tsx";

const COLORS: Record<MasteryLevel, { fill: string; chip: string }> = {
  new: { fill: "#e2e8f0", chip: "bg-slate-100 text-slate-700" },
  weak: { fill: "#fecaca", chip: "bg-red-100 text-red-800" },
  progress: { fill: "#fde68a", chip: "bg-amber-100 text-amber-900" },
  strong: { fill: "#a7f3d0", chip: "bg-emerald-100 text-emerald-800" },
};

export function conceptGraph(concepts: { name: string; prerequisites: string[]; level: MasteryLevel }[]) {
  const id = new Map(concepts.map((c, i) => [c.name, `C${i}`]));
  const esc = (s: string) => s.replace(/"/g, "'");
  const lines = ["flowchart TD"];
  concepts.forEach((c) => lines.push(`  ${id.get(c.name)}["${esc(c.name)}"]:::${c.level}`));
  concepts.forEach((c) => c.prerequisites.forEach((p) => id.has(p) && lines.push(`  ${id.get(p)} --> ${id.get(c.name)}`)));
  (Object.keys(COLORS) as MasteryLevel[]).forEach((l) => lines.push(`  classDef ${l} fill:${COLORS[l].fill},stroke:#64748b,color:#0f172a`));
  return lines.join("\n");
}

export function Concepts({ courseId }: { courseId: number }) {
  const engine = useEngine();
  const raw = engine.store.concepts(courseId);
  const infos = conceptInfos(engine.store, courseId);
  const concepts = raw.map((c, i) => ({ ...c, level: masteryLevel(infos[i].mastery, infos[i].attempts), mastery: infos[i].mastery }));
  const graph = useMemo(() => conceptGraph(concepts), [JSON.stringify(concepts.map((c) => [c.name, c.prerequisites, c.level]))]);
  const [showGraph, setShowGraph] = useState(true);

  if (concepts.length === 0)
    return (
      <Empty icon="🗺️" title="עוד אין מושגים">
        המושגים מחולצים אוטומטית מהחומרים שהעליתם. <a className="underline" href={href.course(courseId, "materials")}>העלו חומר</a>.
      </Empty>
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(Object.keys(COLORS) as MasteryLevel[]).map((l) => (
          <span key={l} className={`rounded-full px-2 py-0.5 ${COLORS[l].chip}`}>
            {MASTERY_LABEL[l]}
          </span>
        ))}
        <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setShowGraph(!showGraph)}>
          {showGraph ? "הסתרת התרשים" : "הצגת התרשים"}
        </Button>
      </div>
      {showGraph && (
        <Card className="p-4">
          <MermaidView source={graph} />
          <p className="mt-2 text-xs text-slate-500">חץ מ-א ל-ב = כדאי להבין את א לפני ב.</p>
        </Card>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {concepts.map((c) => (
          <Card key={c.id} className="p-4" data-testid="concept-card">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-bold">{c.name}</div>
                {c.name_en && <div className="text-xs text-slate-500" dir="ltr">{c.name_en}</div>}
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${COLORS[c.level].chip}`}>{MASTERY_LABEL[c.level]}</span>
            </div>
            <p className="mt-2 text-sm text-slate-700">{c.definition}</p>
            {c.prerequisites.length > 0 && <p className="mt-1 text-xs text-slate-500">דרישות קדם: {c.prerequisites.join(", ")}</p>}
            <CitationChips ids={c.section_ids.slice(0, 4)} />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => go(href.course(courseId, "studio", `quiz?concept=${encodeURIComponent(c.name)}`))}>
                ❓ תרגול
              </Button>
              <Button size="sm" variant="secondary" onClick={() => go(href.course(courseId, "studio", `explainer?concept=${encodeURIComponent(c.name)}`))}>
                🧪 הסבר אינטראקטיבי
              </Button>
              <Button size="sm" variant="ghost" onClick={() => go(href.course(courseId, "studio", `flashcards?concept=${encodeURIComponent(c.name)}`))}>
                🃏 כרטיסיות
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
