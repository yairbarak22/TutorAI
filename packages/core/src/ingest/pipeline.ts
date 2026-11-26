import { z } from "zod";
import type { LLMApi } from "@ruecai/sdk";
import { t } from "@ruecai/sdk";
import { sectionKey, type Store } from "../db/store.ts";
import type { FileStore } from "../files.ts";
import { BASE_SYSTEM_PROMPT } from "../llm/prompts.ts";
import { formatSections } from "../retrieve.ts";
import { detectKind, parseDocx, parsePdf, parsePptx, parseText, renderPdfPagePng, type PdfDeps, type RawUnit } from "./parsers.ts";

export interface IngestDeps {
  store: Store;
  files: FileStore;
  llm: LLMApi;
  pdf?: PdfDeps;
  /** Enables vision OCR for sparse PDF pages (needs a canvas — browser only). */
  ocrSparsePages?: boolean;
  onProgress?: (sourceId: number, pct: number, message: string) => void;
}

const ANALYSIS_BATCH_CHARS = 60_000;

export const SourceAnalysis = z.object({
  sections: z.array(z.object({ id: z.string(), title: z.string(), summary: z.string() })),
  concepts: z.array(
    z.object({
      name: z.string().describe("Short Hebrew name as used in the material"),
      name_en: z.string(),
      definition: z.string().describe("1-2 sentence definition in Hebrew"),
      prerequisites: z.array(z.string()).describe("Names of other concepts (from this list or the existing list)"),
      citations: z.array(z.string()),
    }),
  ),
});

/**
 * parse → sections → (OCR sparse pages) → LLM analysis (titles, summaries, concepts) → merge concepts.
 * Every step updates the source status so the UI can show progress and resume after a reload.
 */
export async function ingestSource(deps: IngestDeps, sourceId: number): Promise<void> {
  const { store, files, llm } = deps;
  const source = store.source(sourceId);
  if (!source) throw new Error("source not found");
  const report = (pct: number, msg: string) => deps.onProgress?.(sourceId, pct, msg);

  try {
    store.setSourceStatus(sourceId, "parsing", 0.05);
    report(0.05, t("קורא את הקובץ…", "Reading the file…"));
    const bytes = await files.read(source.path);
    const kind = detectKind(source.name, source.mime);
    let units: RawUnit[];
    if (kind === "pdf") {
      if (!deps.pdf) throw new Error("PDF parsing is not available in this environment");
      units = await parsePdf(bytes, deps.pdf);
      if (deps.ocrSparsePages) {
        const sparse = units.filter((u) => u.sparse && u.page);
        for (const [i, u] of sparse.entries()) {
          report(0.1 + (0.2 * i) / sparse.length, t(`מפענח עמוד ${u.page} (תמונה/נוסחאות)…`, `Reading page ${u.page} (images/formulas)…`));
          try {
            const png = await renderPdfPagePng(bytes, u.page!, deps.pdf);
            const text = await llm.text({
              tier: "fast",
              tag: "ingest-ocr",
              maxTokens: 4000,
              images: [{ mediaType: "image/png", base64: png }],
              prompt:
                "Transcribe all the content of this page as text, in its original language. Formulas in LaTeX ($...$). Briefly describe diagrams in square brackets. Return only the content.",
            });
            if (text.trim()) u.text = text.trim();
          } catch {
            /* keep whatever text we have */
          }
        }
      }
    } else if (kind === "pptx") units = await parsePptx(bytes);
    else if (kind === "docx") units = await parseDocx(bytes);
    else if (kind === "text") units = parseText(new TextDecoder().decode(bytes));
    else throw new Error(t("סוג קובץ לא נתמך. נתמכים: PDF, PPTX, DOCX, TXT/MD", "Unsupported file type. Supported: PDF, PPTX, DOCX, TXT/MD"));

    units = units.filter((u) => u.text.trim().length > 0);
    if (units.length === 0) throw new Error(t("לא נמצא טקסט בקובץ (ייתכן שזה סריקה ללא טקסט).", "No text found in the file (it may be a scan without text)."));

    const ids = store.replaceSections(
      source.course_id,
      sourceId,
      units.map((u) => ({ anchor: u.anchor, page: u.page, title: u.title, text: u.text })),
    );
    store.setSourceStatus(sourceId, "analyzing", 0.35);
    report(0.35, t("מנתח נושאים ומושגים…", "Analyzing topics and concepts…"));

    await analyzeSource(deps, sourceId, (p) => {
      store.setSourceStatus(sourceId, "analyzing", 0.35 + 0.6 * p);
      report(0.35 + 0.6 * p, t("מנתח נושאים ומושגים…", "Analyzing topics and concepts…"));
    });
    void ids;
    store.setSourceStatus(sourceId, "ready", 1);
    report(1, t("מוכן", "Done"));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    store.setSourceStatus(sourceId, "error", 0, msg);
    report(0, msg);
    throw e;
  }
}

async function analyzeSource(deps: IngestDeps, sourceId: number, onPart: (p: number) => void) {
  const { store, llm } = deps;
  const source = store.source(sourceId)!;
  const sections = store.sectionsOfSource(sourceId);
  const names = new Map([[source.id, source.name]]);

  // Smaller batches for small local models, so a batch plus the instructions fits their context.
  const batchChars = Math.min(ANALYSIS_BATCH_CHARS, llm.limitsFor?.("fast")?.contextChars ?? Infinity);
  const batches: (typeof sections)[] = [];
  let cur: typeof sections = [];
  let size = 0;
  for (const s of sections) {
    if (size + s.text.length > batchChars && cur.length) {
      batches.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(s);
    size += s.text.length;
  }
  if (cur.length) batches.push(cur);

  for (const [i, batch] of batches.entries()) {
    const existing = store.concepts(source.course_id).map((c) => c.name);
    const isExam = source.kind === "sample_exam";
    const result = await llm.object(SourceAnalysis, {
      tier: "fast",
      tag: "ingest-analyze",
      maxTokens: 16000,
      system: BASE_SYSTEM_PROMPT,
      context: formatSections(batch, names),
      prompt: [
        `Analyze the material sections from "${source.name}"${isExam ? " (this is a sample exam)" : ""}. Write titles, summaries, concept names and definitions in the language of the material itself.`,
        "1. For each section (by id): a short title (up to 8 words) and a one-to-two sentence summary.",
        isExam
          ? "2. Concepts: only the concepts the exam tests (do not extract new concepts that are not tested)."
          : "2. Concepts: the main concepts taught (5–20), with a definition, prerequisites and citations to sections.",
        existing.length
          ? `Existing course concepts (if a concept already exists, use its exact existing name): ${existing.join(" · ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });

    const valid = new Set(batch.map((s) => sectionKey(s.id)));
    for (const s of result.sections) {
      if (!valid.has(s.id)) continue;
      store.updateSectionMeta(Number(s.id.slice(1)), s.title, s.summary);
    }
    mergeConcepts(store, source.course_id, result.concepts.map((c) => ({ ...c, citations: c.citations.filter((x) => valid.has(x)) })));
    onPart((i + 1) / batches.length);
  }
}

export function normalizeName(s: string) {
  return s.trim().replace(/\s+/g, " ").replace(/^ה(?=[א-ת]{3,})/, "").toLowerCase();
}

export function mergeConcepts(
  store: Store,
  courseId: number,
  incoming: { name: string; name_en: string; definition: string; prerequisites: string[]; citations: string[] }[],
) {
  const existing = store.concepts(courseId);
  const byNorm = new Map(existing.map((c) => [normalizeName(c.name), c]));
  const byEn = new Map(existing.filter((c) => c.name_en).map((c) => [c.name_en.toLowerCase(), c]));
  for (const c of incoming) {
    const match = byNorm.get(normalizeName(c.name)) ?? (c.name_en ? byEn.get(c.name_en.toLowerCase()) : undefined);
    if (match) {
      store.upsertConcept(courseId, {
        name: match.name,
        name_en: match.name_en || c.name_en,
        definition: match.definition.length >= c.definition.length ? match.definition : c.definition,
        prerequisites: [...new Set([...match.prerequisites, ...c.prerequisites])].filter((p) => p !== match.name),
        section_ids: [...new Set([...match.section_ids, ...c.citations])],
      });
    } else {
      store.upsertConcept(courseId, {
        name: c.name.trim(),
        name_en: c.name_en,
        definition: c.definition,
        prerequisites: c.prerequisites.filter((p) => p !== c.name),
        section_ids: c.citations,
      });
      byNorm.set(normalizeName(c.name), { ...c, id: 0, course_id: courseId, section_ids: c.citations } as never);
    }
  }
}
