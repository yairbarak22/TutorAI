import { z } from "zod";

/**
 * Artifact schemas — the structured outputs every tool returns.
 *
 * Rules for contributors:
 * - Every claim that comes from course material carries `citations`: a list of
 *   section ids exactly as they appear in the context, e.g. ["S12", "S14"].
 * - Keep fields required (use "" / [] / -1 for "none"): the schemas are sent to the
 *   model as structured-output JSON Schema, and required-only schemas are the most reliable.
 */

export const Citations = z
  .array(z.string())
  .describe('Section ids from the context, e.g. ["S3","S7"]. Never invent ids.');

export const MarkdownDoc = z.object({
  title: z.string(),
  sections: z.array(
    z.object({
      heading: z.string(),
      markdown: z.string().describe("Markdown body. Math in $...$ or $$...$$ (KaTeX)."),
      citations: Citations,
    }),
  ),
});
export type MarkdownDoc = z.infer<typeof MarkdownDoc>;

export const Quiz = z.object({
  title: z.string(),
  questions: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["mcq", "open"]),
      prompt: z.string(),
      options: z.array(z.string()).describe("4 options for mcq, empty for open"),
      correct_index: z.number().int().describe("0-based index for mcq, -1 for open"),
      model_answer: z.string(),
      explanation: z.string(),
      concept: z.string().describe("Exact concept name from the course concept list"),
      citations: Citations,
    }),
  ),
});
export type Quiz = z.infer<typeof Quiz>;

export const Flashcards = z.object({
  title: z.string(),
  cards: z.array(
    z.object({
      front: z.string(),
      back: z.string(),
      concept: z.string(),
      citations: Citations,
    }),
  ),
});
export type Flashcards = z.infer<typeof Flashcards>;

export const ConceptMap = z.object({
  concepts: z.array(
    z.object({
      name: z.string().describe("Hebrew name as used in the course"),
      name_en: z.string(),
      definition: z.string(),
      prerequisites: z.array(z.string()).describe("Names of other concepts in this list"),
      citations: Citations,
    }),
  ),
});
export type ConceptMap = z.infer<typeof ConceptMap>;

export const ExamSimulation = z.object({
  title: z.string(),
  instructions: z.string(),
  duration_minutes: z.number().int(),
  style_notes: z.string().describe("What was learned from the sample exams"),
  questions: z.array(
    z.object({
      id: z.string(),
      prompt: z.string(),
      points: z.number(),
      rubric: z.array(z.object({ criterion: z.string(), points: z.number() })),
      model_answer: z.string(),
      concepts: z.array(z.string()),
      citations: Citations,
    }),
  ),
});
export type ExamSimulation = z.infer<typeof ExamSimulation>;

export const StudyPlan = z.object({
  title: z.string(),
  exam_date: z.string(),
  days: z.array(
    z.object({
      date: z.string(),
      items: z.array(
        z.object({
          concept: z.string(),
          activity: z.enum(["learn", "practice", "review"]),
          minutes: z.number(),
          reason: z.string(),
        }),
      ),
    }),
  ),
});
export type StudyPlan = z.infer<typeof StudyPlan>;

export const InteractiveWidget = z.object({
  title: z.string(),
  explanation: z.string().describe("Short markdown explanation shown above the widget"),
  html: z
    .string()
    .describe(
      "One self-contained HTML document (inline <style>/<script>, no external URLs, no network). RTL Hebrew UI.",
    ),
  concept: z.string(),
  citations: Citations,
});
export type InteractiveWidget = z.infer<typeof InteractiveWidget>;

export const Diagram = z.object({
  title: z.string(),
  mermaid: z.string().describe("Valid Mermaid source. Quote labels that contain Hebrew or symbols."),
  explanation: z.string(),
  citations: Citations,
});
export type Diagram = z.infer<typeof Diagram>;

export const GradeResult = z.object({
  score: z.number(),
  max_score: z.number(),
  correct: z.boolean().describe("true if score >= 70% of max"),
  criteria: z.array(z.object({ criterion: z.string(), awarded: z.number(), comment: z.string() })),
  feedback: z.string().describe("Encouraging, specific feedback in Hebrew"),
});
export type GradeResult = z.infer<typeof GradeResult>;

export const ARTIFACT_SCHEMAS = {
  markdown_doc: MarkdownDoc,
  quiz: Quiz,
  flashcards: Flashcards,
  concept_map: ConceptMap,
  exam_simulation: ExamSimulation,
  study_plan: StudyPlan,
  interactive_widget: InteractiveWidget,
  diagram: Diagram,
} as const;

export type ArtifactType = keyof typeof ARTIFACT_SCHEMAS;
export const ARTIFACT_TYPES = Object.keys(ARTIFACT_SCHEMAS) as ArtifactType[];

export type ArtifactData<T extends ArtifactType = ArtifactType> = z.infer<(typeof ARTIFACT_SCHEMAS)[T]>;

export interface ArtifactPayload<T extends ArtifactType = ArtifactType> {
  type: T;
  title: string;
  data: ArtifactData<T>;
}
