import { defineTool, t } from "@tutorai/sdk";
import { buildStudyPlan } from "./plan.ts";

export default defineTool<"study_plan">({
  async run(ctx) {
    const examDate = String(ctx.params.exam_date || ctx.course.examDate || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(examDate)) throw new Error(t("הגדירו תאריך מבחן (בהגדרות הקורס או כאן) בפורמט YYYY-MM-DD.", "Set an exam date (in the course settings or here) in YYYY-MM-DD format."));
    if (examDate <= ctx.today) throw new Error(t("תאריך המבחן כבר עבר.", "The exam date has already passed."));
    const concepts = await ctx.concepts();
    if (concepts.length === 0) throw new Error(t("אין עדיין מושגים בקורס. העלו חומר קודם.", "This course has no concepts yet. Upload material first."));
    const plan = buildStudyPlan({
      concepts,
      today: ctx.today,
      examDate,
      minutesPerDay: Number(ctx.params.minutes_per_day) || 90,
      title: t(`תוכנית לימוד — ${ctx.course.name}`, `Study plan: ${ctx.course.name}`),
    });
    return { type: "study_plan", title: plan.title, data: plan };
  },
});
