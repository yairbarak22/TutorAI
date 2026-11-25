import { defineTool } from "@ruecai/sdk";
import { buildStudyPlan } from "./plan.ts";

export default defineTool<"study_plan">({
  async run(ctx) {
    const examDate = String(ctx.params.exam_date || ctx.course.examDate || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(examDate)) throw new Error("הגדירו תאריך מבחן (בהגדרות הקורס או כאן) בפורמט YYYY-MM-DD.");
    if (examDate <= ctx.today) throw new Error("תאריך המבחן כבר עבר.");
    const concepts = await ctx.concepts();
    if (concepts.length === 0) throw new Error("אין עדיין מושגים בקורס. העלו חומר קודם.");
    const plan = buildStudyPlan({
      concepts,
      today: ctx.today,
      examDate,
      minutesPerDay: Number(ctx.params.minutes_per_day) || 90,
      title: `תוכנית לימוד — ${ctx.course.name}`,
    });
    return { type: "study_plan", title: plan.title, data: plan };
  },
});
