import { z } from "zod";
import { defineTool, ExamSimulation } from "@ruecai/sdk";

const ExamStyle = z.object({
  question_count: z.number().int(),
  duration_minutes: z.number().int(),
  question_types: z.array(z.string()).describe("e.g. שאלת אירוע, הוכחה, חישוב, אמריקאית"),
  points_pattern: z.string(),
  topics: z.array(z.string()),
  style_notes: z.string().describe("How questions are phrased, what graders look for, materials allowed"),
});

export default defineTool<"exam_simulation">({
  async run(ctx) {
    ctx.progress(0.1, "קורא את המבחנים לדוגמה…");
    const samples = await ctx.retrieve({ mode: "samples" });
    if (samples.sections.length === 0) throw new Error("לא נמצאו מבחנים לדוגמה. העלו מבחן וסמנו אותו כ'מבחן לדוגמה'.");
    const style = await ctx.llm.object(ExamStyle, {
      system: ctx.baseSystemPrompt,
      context: samples.text,
      tier: "smart",
      tag: "exam-from-samples:analyze",
      maxTokens: 4000,
      prompt: "נתח את המבחנים לדוגמה: מספר שאלות, משך, סוגי שאלות, חלוקת נקודות, נושאים, וסגנון הניסוח והבדיקה.",
    });

    ctx.progress(0.4, "כותב מבחן חדש…");
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
        `כתוב מבחן חדש לקורס "${ctx.course.name}" בדיוק בסגנון המבחנים לדוגמה:`,
        JSON.stringify(style, null, 2),
        `מספר שאלות: ${count}. משך: ${style.duration_minutes} דקות.`,
        ctx.params.focus ? `הדגש נושאים: ${ctx.params.focus}.` : "",
        "השאלות חייבות להיות חדשות (עובדות/מספרים/תרחישים חדשים) — לא העתקה של המבחנים לדוגמה.",
        "לכל שאלה: rubric מפורט שסכום הנקודות בו שווה ל-points, ו-model_answer מלא כפי שבודק היה מצפה.",
        `concepts: מתוך הרשימה: ${concepts.join(" · ")}. citations: מזהי קטעים מחומר הקורס שמכסים את התשובה.`,
        "style_notes: מה למדת מהמבחנים לדוגמה, במשפט-שניים לסטודנט.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    exam.duration_minutes ||= style.duration_minutes;
    return { type: "exam_simulation", title: exam.title, data: exam };
  },
});
