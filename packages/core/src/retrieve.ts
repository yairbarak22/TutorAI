import type { RetrieveOptions, RetrievedContext, SectionRef } from "@ruecai/sdk";
import { sectionKey, type Section, type Store } from "./db/store.ts";
import { searchSections } from "./search.ts";

/** ~4 Hebrew chars per token → 160k chars ≈ 40k tokens. Plenty for a lecture-scoped request. */
export const DEFAULT_BUDGET_CHARS = 160_000;

/**
 * Builds the material context for a request.
 *
 * Strategy (see docs/architecture.md → Retrieval):
 *  1. Candidate sections = picked sources, or sample exams (mode "samples"),
 *     or all regular material.
 *  2. If a concept / query is given, rank candidates with BM25 (+ concept's known sections).
 *  3. If everything relevant fits the budget, send it all (long context beats chunk RAG
 *     at course scale); otherwise take the best-ranked sections up to the budget.
 *  4. Always emit in document order (source → ord) so prompt caching keeps working.
 */
export function retrieve(store: Store, courseId: number, opts: RetrieveOptions = {}): RetrievedContext {
  const budget = opts.budgetChars ?? DEFAULT_BUDGET_CHARS;
  const sources = store.sources(courseId).filter((s) => s.status === "ready");
  const mode = opts.mode ?? "scope";
  if (mode === "none") return { text: "", sections: [], truncated: false };

  let sourceIds: number[];
  if (opts.sourceIds?.length) sourceIds = opts.sourceIds;
  else if (mode === "samples") sourceIds = sources.filter((s) => s.kind === "sample_exam").map((s) => s.id);
  else sourceIds = sources.filter((s) => s.kind === "material").map((s) => s.id);

  if (sourceIds.length === 0) return { text: "", sections: [], truncated: false };
  const candidates = store.sections(courseId, sourceIds);
  const sourceName = new Map(sources.map((s) => [s.id, s.name]));

  let chosen: Section[] = candidates;
  let truncated = false;

  const query = [opts.query, opts.concept].filter(Boolean).join(" ");
  const total = candidates.reduce((n, s) => n + s.text.length, 0);
  if (total <= budget) {
    chosen = candidates; // everything fits: long context beats ranking
  } else if (query) {
    truncated = true;
    const conceptSections = new Set<number>();
    if (opts.concept) {
      const c = store.concepts(courseId).find((x) => x.name === opts.concept);
      c?.section_ids.forEach((k) => conceptSections.add(Number(k.slice(1))));
    }
    const scores = new Map(searchSections(candidates, query, 200).map((r) => [r.id, r.score]));
    conceptSections.forEach((id) => scores.set(id, (scores.get(id) ?? 0) + 100));
    const ranked = candidates.filter((s) => scores.has(s.id)).sort((a, b) => scores.get(b.id)! - scores.get(a.id)!);
    // keep neighbours of hits for continuity
    const keep = new Set<number>();
    let used = 0;
    for (const s of ranked) {
      if (used + s.text.length > budget) break;
      keep.add(s.id);
      used += s.text.length;
    }
    chosen = keep.size ? candidates.filter((s) => keep.has(s.id)) : fitBudget(candidates, budget, (t) => (truncated = t));
  } else {
    chosen = fitBudget(candidates, budget, (t) => (truncated = t));
  }

  const refs: SectionRef[] = chosen.map((s) => ({
    id: sectionKey(s.id),
    sourceId: s.source_id,
    sourceName: sourceName.get(s.source_id) ?? "",
    anchor: s.anchor,
    title: s.title,
  }));
  return { text: formatSections(chosen, sourceName), sections: refs, truncated };
}

function fitBudget(sections: Section[], budget: number, setTruncated: (t: boolean) => void): Section[] {
  const total = sections.reduce((n, s) => n + s.text.length, 0);
  if (total <= budget) return sections;
  setTruncated(true);
  // Spread the budget across the material instead of keeping only the beginning:
  // take every k-th section, then fill remaining room in order.
  const stride = Math.ceil(total / budget);
  const keep = new Set<number>();
  let used = 0;
  sections.forEach((s, i) => {
    if (i % stride === 0 && used + s.text.length <= budget) {
      keep.add(s.id);
      used += s.text.length;
    }
  });
  for (const s of sections) {
    if (!keep.has(s.id) && used + s.text.length <= budget) {
      keep.add(s.id);
      used += s.text.length;
    }
  }
  return sections.filter((s) => keep.has(s.id));
}

export function formatSections(sections: Section[], sourceName: Map<number, string>): string {
  return sections
    .map(
      (s) =>
        `<section id="${sectionKey(s.id)}" source="${escapeAttr(sourceName.get(s.source_id) ?? "")}" anchor="${escapeAttr(s.anchor)}">\n${
          s.title ? `# ${s.title}\n` : ""
        }${s.text}\n</section>`,
    )
    .join("\n\n");
}

const escapeAttr = (s: string) => s.replace(/"/g, "'");
