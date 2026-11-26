/**
 * Quality checks shared by the runtime (to clean outputs) and by evals (to score them).
 */

export interface GroundingReport {
  /** Items that should carry citations (sections, questions, cards…). */
  items: number;
  /** Items with at least one valid citation. */
  citedItems: number;
  /** Citation ids that do not exist in the provided context (removed by `cleanCitations`). */
  invalidIds: string[];
  coverage: number; // citedItems / items
}

type Json = unknown;

function walkCitationHolders(node: Json, visit: (holder: { citations: string[] }) => void) {
  if (Array.isArray(node)) {
    node.forEach((n) => walkCitationHolders(n, visit));
  } else if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj.citations)) visit(obj as { citations: string[] });
    for (const [k, v] of Object.entries(obj)) if (k !== "citations") walkCitationHolders(v, visit);
  }
}

export function checkGrounding(data: Json, validIds: Iterable<string>): GroundingReport {
  const valid = new Set(validIds);
  let items = 0;
  let cited = 0;
  const invalid = new Set<string>();
  walkCitationHolders(data, (h) => {
    items++;
    const good = h.citations.filter((c) => valid.has(c));
    h.citations.filter((c) => !valid.has(c)).forEach((c) => invalid.add(c));
    if (good.length > 0) cited++;
  });
  return { items, citedItems: cited, invalidIds: [...invalid], coverage: items === 0 ? 1 : cited / items };
}

/** Removes citation ids that are not in the context. Mutates and returns `data`. */
export function cleanCitations<T>(data: T, validIds: Iterable<string>): T {
  const valid = new Set(validIds);
  walkCitationHolders(data, (h) => {
    h.citations = [...new Set(h.citations.map((c) => c.trim().replace(/^\[|\]$/g, "")))].filter((c) => valid.has(c));
  });
  return data;
}

/** Share of letters that are Hebrew (ignores digits, punctuation, math). */
export function hebrewRatio(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 0;
  const hebrew = letters.filter((ch) => /[֐-׿]/.test(ch)).length;
  return hebrew / letters.length;
}

/** Collects all human-readable strings of an artifact (for language / keyword checks). */
export function collectText(node: Json): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(collectText).join("\n");
  if (node && typeof node === "object")
    return Object.entries(node as Record<string, unknown>)
      .filter(([k]) => !["citations", "html", "mermaid", "id", "kind"].includes(k))
      .map(([, v]) => collectText(v))
      .join("\n");
  return "";
}

/** Extracts [S12]-style citation markers from free text (tutor replies). */
export function extractInlineCitations(text: string): string[] {
  return [...new Set([...text.matchAll(/\[(S\d+)\]/g)].map((m) => m[1]))];
}

/** Counts the main repeated items of an artifact, for "min_items" checks. */
export function countItems(type: string, data: Record<string, unknown>): number {
  const key: Record<string, string> = {
    markdown_doc: "sections",
    quiz: "questions",
    flashcards: "cards",
    concept_map: "concepts",
    exam_simulation: "questions",
    study_plan: "days",
    solution_check: "steps",
  };
  const k = key[type];
  if (!k) return 1;
  return Array.isArray(data[k]) ? (data[k] as unknown[]).length : 0;
}
