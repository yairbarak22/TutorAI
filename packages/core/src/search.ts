import MiniSearch from "minisearch";
import type { Section } from "./db/store.ts";

const HEB_PREFIXES = ["וה", "שה", "בה", "לה", "מה", "כש", "ו", "ה", "ב", "ל", "מ", "ש", "כ"];

/** Normalizes a term; for Hebrew also emits the form without a common one-letter prefix (ו/ה/ב/ל/מ/ש/כ). */
export function hebrewTerms(term: string): string[] {
  const t = term.toLowerCase().replace(/["'׳״]/g, "");
  if (t.length < 2) return [];
  const out = new Set([t]);
  if (/^[א-ת]/.test(t)) {
    for (const p of HEB_PREFIXES) if (t.startsWith(p) && t.length - p.length >= 3) out.add(t.slice(p.length));
    // final letters ↔ regular (so "סעיפים"/"סעיף" share a stem roughly)
    if (t.endsWith("ים") && t.length > 4) out.add(t.slice(0, -2));
    if (t.endsWith("ות") && t.length > 4) out.add(t.slice(0, -2));
  }
  return [...out];
}

export function buildIndex(sections: Section[]) {
  const ms = new MiniSearch<Section>({
    fields: ["title", "summary", "text"],
    storeFields: ["id"],
    tokenize: (s) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean),
    processTerm: (term) => {
      const terms = hebrewTerms(term);
      return terms.length ? terms : null;
    },
    searchOptions: { boost: { title: 3, summary: 2 }, prefix: true, fuzzy: 0.15, combineWith: "OR" },
  });
  ms.addAll(sections);
  return ms;
}

export function searchSections(sections: Section[], query: string, limit = 50): { id: number; score: number }[] {
  if (!query.trim() || sections.length === 0) return [];
  const ms = buildIndex(sections);
  return ms
    .search(query)
    .slice(0, limit)
    .map((r) => ({ id: Number(r.id), score: r.score }));
}
