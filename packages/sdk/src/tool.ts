import { z } from "zod";
import { ARTIFACT_TYPES, type ArtifactPayload, type ArtifactType } from "./artifacts.ts";

/* ------------------------------------------------------------------ */
/* Manifest (plugin.yaml)                                              */
/* ------------------------------------------------------------------ */

export const InputSpec = z.object({
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/),
  label: z.string(),
  type: z.enum(["text", "textarea", "select", "number", "concept", "source"]),
  options: z.array(z.string()).optional(),
  default: z.union([z.string(), z.number()]).optional(),
  required: z.boolean().optional(),
  help: z.string().optional(),
});
export type InputSpec = z.infer<typeof InputSpec>;

export const RetrievalSpec = z.object({
  /**
   * scope   — the sources / concept the student picked (default)
   * search  — keyword search with `query` (template), falls back to scope
   * samples — only sources marked as sample exams
   * none    — the tool does not read course material
   */
  mode: z.enum(["scope", "search", "samples", "none"]).default("scope"),
  query: z.string().optional(),
  budget_chars: z.number().int().positive().optional(),
});
export type RetrievalSpec = z.infer<typeof RetrievalSpec>;

export const ToolManifest = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string(),
  description: z.string(),
  icon: z.string().default("✨"),
  pack: z.string(),
  kind: z.enum(["declarative", "code"]),
  /** "chat" is reserved for conversational tools (the tutor). */
  output: z.enum([...ARTIFACT_TYPES, "chat"] as unknown as [ArtifactType | "chat", ...(ArtifactType | "chat")[]]),
  tier: z.enum(["fast", "smart"]).default("smart"),
  inputs: z.array(InputSpec).default([]),
  /** Optional translations, e.g. `i18n: { he: { name, description, inputs: { topic: { label } } } }`. */
  i18n: z.lazy(() => z.object({ he: ManifestI18n.optional(), en: ManifestI18n.optional() })).optional(),
  retrieval: RetrievalSpec.default({ mode: "scope" }),
  disciplines: z.array(z.string()).default(["all"]),
  sdk: z.string().default("^0.1"),
  authors: z.array(z.string()).default([]),
});
export type ToolManifest = z.infer<typeof ToolManifest>;

/** Translations of a manifest's user-facing texts. English (the base fields) is the default. */
export const ManifestI18n = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  inputs: z
    .record(
      z.string(),
      z.object({
        label: z.string().optional(),
        help: z.string().optional(),
        /** value → display label, for select inputs */
        options: z.record(z.string(), z.string()).optional(),
      }),
    )
    .optional(),
});

/* ------------------------------------------------------------------ */
/* Runtime contract                                                    */
/* ------------------------------------------------------------------ */

export type Tier = "fast" | "smart";

export interface SectionRef {
  id: string; // "S12"
  sourceId: number;
  sourceName: string;
  anchor: string; // "p. 4" / "Slide 7" (in the UI language at ingestion time)
  title: string;
}

export interface RetrievedContext {
  /** Formatted material: each section is wrapped as <section id="S12" ...>…</section>. */
  text: string;
  sections: SectionRef[];
  truncated: boolean;
}

export interface RetrieveOptions {
  mode?: RetrievalSpec["mode"];
  query?: string;
  concept?: string;
  sourceIds?: number[];
  budgetChars?: number;
}

export interface LLMCallOptions {
  system?: string;
  /** Course material (from ctx.retrieve().text). Sent as a cached system block. */
  context?: string;
  prompt: string;
  tier?: Tier;
  maxTokens?: number;
  /** Free-form label used for logging, cost tracking and demo-mode fixtures. */
  tag?: string;
  images?: { mediaType: "image/png" | "image/jpeg"; base64: string }[];
  /** Called while the model writes, with the number of output characters so far (for progress UI). */
  onOutput?: (chars: number) => void;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface LLMApi {
  object<S extends z.ZodType>(schema: S, opts: LLMCallOptions): Promise<z.infer<S>>;
  text(opts: LLMCallOptions): Promise<string>;
  stream(opts: LLMCallOptions & { history?: ChatTurn[] }, onDelta: (text: string) => void): Promise<string>;
}

export interface ConceptInfo {
  name: string;
  nameEn: string;
  definition: string;
  prerequisites: string[];
  mastery: number; // 0..1 (BKT p_known)
  attempts: number;
}

export interface CourseInfo {
  id: number;
  name: string;
  examDate: string | null; // ISO date
  language: "he" | "en";
}

export interface ToolContext {
  course: CourseInfo;
  params: Record<string, string | number>;
  llm: LLMApi;
  retrieve(opts?: RetrieveOptions): Promise<RetrievedContext>;
  concepts(): Promise<ConceptInfo[]>;
  progress(pct: number, message: string): void;
  /** Shared pedagogy + citation rules, prepend to your own system prompt. */
  baseSystemPrompt: string;
  /** Today's date (ISO yyyy-mm-dd) — injectable for tests. */
  today: string;
  signal?: AbortSignal;
  /** Present only for output: "chat" tools. */
  chat?: { history: ChatTurn[]; message: string; onDelta: (text: string) => void };
}

export interface ChatReply {
  text: string;
  citations: string[];
}

export interface CodeTool<T extends ArtifactType | "chat" = ArtifactType | "chat"> {
  run(ctx: ToolContext): Promise<T extends "chat" ? ChatReply : ArtifactPayload>;
  /** Optional: fix an artifact that failed to render (e.g. widget runtime error). */
  repair?(ctx: ToolContext, artifact: ArtifactPayload, error: string): Promise<ArtifactPayload>;
}

/** Identity helper that gives code plugins full type inference. */
export function defineTool<T extends ArtifactType | "chat">(tool: CodeTool<T>): CodeTool<T> {
  return tool;
}

export interface LoadedTool {
  manifest: ToolManifest;
  /** Declarative tools: the prompt template (prompt.he.md). */
  prompt?: string;
  /** Code tools: the implementation. */
  code?: CodeTool;
  /** Recorded reference output used for CI evals and demo mode. */
  golden?: unknown;
  evals?: EvalSpec;
  dir: string;
}

export const EvalSpec = z.object({
  fixture: z.string().default("probability"),
  params: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  checks: z
    .object({
      min_items: z.number().int().default(1),
      min_citation_coverage: z.number().min(0).max(1).default(0.8),
      min_hebrew_ratio: z.number().min(0).max(1).default(0.5),
      must_mention: z.array(z.string()).default([]),
      judge: z.string().optional(),
    })
    .default({ min_items: 1, min_citation_coverage: 0.8, min_hebrew_ratio: 0.5, must_mention: [] }),
});
export type EvalSpec = z.infer<typeof EvalSpec>;
