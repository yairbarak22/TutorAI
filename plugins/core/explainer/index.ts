import { defineTool, InteractiveWidget, type ArtifactPayload } from "@ruecai/sdk";

const WIDGET_RULES = `כללים טכניים מחייבים ל-html:
- מסמך HTML אחד שלם (<!doctype html>), עם <html dir="rtl" lang="he">, CSS ו-JavaScript בתוך הקובץ בלבד.
- אסור: קישורים חיצוניים, <script src>, fetch/XMLHttpRequest/WebSocket, localStorage, cookies, alert/prompt, iframes, טפסים שנשלחים.
- רק Canvas 2D / SVG / DOM רגיל. בלי ספריות.
- רספונסיבי: רוחב 100%, גובה עד ~520px, נראה טוב גם במסך צר. צבעים ניטרליים, ניגודיות טובה, גופן מערכת.
- אינטראקציה אמיתית: לפחות 2 פקדים (סליידרים/כפתורים/גרירה) שמשנים את התצוגה בזמן אמת, ומספרים מחושבים שמוצגים ליד.
- הוסף שורת "מה לשים לב" קצרה בתוך הווידג'ט, ונוסחה מרכזית בטקסט.
- קוד נקי ללא שגיאות. עטוף הכול ב-try/catch והצג שגיאה בעדינות.`;

export default defineTool<"interactive_widget">({
  async run(ctx) {
    const concept = String(ctx.params.concept || "");
    const idea = String(ctx.params.idea || "");
    if (!concept && !idea) throw new Error("בחרו מושג או תארו מה להמחיש.");
    ctx.progress(0.1, "אוסף חומר…");
    const material = await ctx.retrieve({ query: `${concept} ${idea}` });
    ctx.progress(0.3, "בונה סימולציה…");
    const data = await ctx.llm.object(InteractiveWidget, {
      system: ctx.baseSystemPrompt,
      context: material.text,
      tier: "smart",
      tag: "explainer",
      maxTokens: 24000,
      prompt: [
        `בנה הסבר אינטראקטיבי ${concept ? `למושג "${concept}"` : ""} ${idea ? `שממחיש: ${idea}` : ""} מתוך הקורס "${ctx.course.name}".`,
        "בחר את ההמחשה הכי מאירה (סימולציה הסתברותית, גרף שמשתנה עם פרמטרים, דיאגרמת ון, עץ החלטה, אנימציה של אלגוריתם וכו').",
        "explanation: 2–4 משפטים בעברית — מה רואים ומה לנסות לשנות. citations: מזהי הקטעים.",
        WIDGET_RULES,
      ].join("\n\n"),
    });
    return { type: "interactive_widget", title: data.title, data };
  },

  async repair(ctx, artifact: ArtifactPayload, error: string) {
    const prev = artifact.data as InteractiveWidget;
    const data = await ctx.llm.object(InteractiveWidget, {
      system: ctx.baseSystemPrompt,
      tier: "smart",
      tag: "explainer:repair",
      maxTokens: 24000,
      prompt: `הווידג'ט הבא נכשל בדפדפן עם השגיאה:\n${error}\n\nתקן את הקוד ושמור על אותה מטרה. החזר את כל השדות (אותם title, explanation, concept, citations).\n\n${WIDGET_RULES}\n\n<html_to_fix>\n${prev.html}\n</html_to_fix>`,
    });
    return { type: "interactive_widget", title: data.title, data: { ...data, citations: prev.citations } };
  },
});
