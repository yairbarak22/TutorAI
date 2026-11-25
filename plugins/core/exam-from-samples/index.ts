import { z } from "zod";
import { defineTool, ExamSimulation, t } from "@ruecai/sdk";

const ExamStyle = z.object({
  question_count: z.number().int(),
  duration_minutes: z.number().int(),
  question_types: z.array(z.string()).describe("e.g. case question, proof, calculation, multiple choice"),
  points_pattern: z.string(),
  topics: z.array(z.string()),
  style_notes: z.string().describe("How questions are phrased, what graders look for, materials allowed"),
});

export default defineTool<"exam_simulation">({
  async run(ctx) {
    ctx.progress(0.1, t("קורא את המבחנים לדוגמה…", "Reading the sample exams…"));
    const samples = await ctx.retrieve({ mode: "samples" });
    if (samples.sections.length === 0) throw new Error(t("לא נמצאו מבחנים לדוגמה. העלו מבחן וסמנו אותו כ'מבחן לדוגמה'.", "No sample exams found. Upload an exam and mark it as a sample exam."));
    const style = await ctx.llm.object(ExamStyle, {
      system: ctx.baseSystemPrompt,
      context: samples.text,
      tier: "smart",
      tag: "exam-from-samples:analyze",
      maxTokens: 8000,
      prompt:
        "Analyze the sample exams: number of questions, duration, question types, how points are split, topics, and the style of phrasing and grading. Be concise: at most 10 topics, points_pattern in one sentence, style_notes under 80 words.",
    });

    ctx.progress(0.4, t("כותב מבחן חדש…", "Writing a new exam…"));
    const material = await ctx.retrieve({ mode: "scope", query: [String(ctx.params.focus || ""), ...style.topics].join(" ") });
    const count = Number(ctx.params.count) > 0 ? Number(ctx.params.count) : style.question_count;
    const concepts = (await ctx.concepts()).map((c) => c.name);
    const exam = await ctx.llm.object(ExamSimulation, {
      system: ctx.baseSystemPrompt,
      context: material.text,
      tier: "smart",
      tag: "exam-from-samples",
      maxTokens: 24000,
      prompt: [
        `Write a new exam for the course "${ctx.course.name}", exactly in the style of the sample exams:`,
        JSON.stringify(style, null, 2),
        `Number of questions: ${count}. Duration: ${style.duration_minutes} minutes.`,
        ctx.params.focus ? `Emphasize these topics: ${ctx.params.focus}.` : "",
        "The questions must be new (new facts, numbers and scenarios), not copies of the sample exams.",
        "For each question: a detailed rubric whose points add up to `points`, and a complete model_answer as a grader would expect.",
        `concepts: from this list: ${concepts.join(" · ")}. citations: IDs of course-material sections that cover the answer.`,
        "style_notes: what you learned from the sample exams, in one or two sentences for the student.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    exam.duration_minutes ||= style.duration_minutes;
    return { type: "exam_simulation", title: exam.title, data: exam };
  },
});
