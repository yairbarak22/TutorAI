import { defineTool, InteractiveWidget, WIDGET_KIT_API, type ArtifactPayload } from "@ruecai/sdk";

const WIDGET_RULES = `כללים טכניים מחייבים לשדה html:
- החזר **רק** את תוכן ה-body: אלמנט <script> אחד (ואם צריך גם <style> קצר). בלי <!doctype>, <html> או <head>: המסגרת, העיצוב והספריות כבר טעונים.
- בנה הכול עם Viz Kit (מתועד למטה) ו-THREE. אל תכתוב מנוע ציור, צירים, סליידרים או עיצוב בעצמך: ה-Kit נותן מראה אחיד ומקצועי.
- אסור: <script src>, קישורים חיצוניים, fetch/XMLHttpRequest/WebSocket, localStorage, cookies, alert/prompt, iframes.
- כל נוסחה: ui.formula("...") או $...$ בתוך ui.note/readouts. לעולם לא נוסחה כטקסט רגיל. בתוך מחרוזת JS כתוב \\\\ לכל \\ של LaTeX.
- הקוד חייב לרוץ בלי שגיאות: בלי משתנים לא מוגדרים, בלי לולאות כבדות (עד ~20,000 נקודות), עדכון רק כשסליידר משתנה.`;

const DESIGN_RULES = `איך נראית המחשה מצוינת:
1. **היא מראה משהו שאי אפשר לראות בטקסט.** לא "גרף של הנוסחה" סתמי, אלא את המנגנון: איך שינוי פרמטר מזיז את התוצאה, למה המשפט נכון, איפה האינטואיציה נשברת.
2. **חפשו קודם זווית תלת-ממדית בעלת משמעות.** כמעט לכל מושג יש אחת, למשל התפלגות כפונקציה של x ושל הפרמטר שלה, או תוצאה כפונקציה של שני פרמטרים. **תלת-ממד מתאים במיוחד ל:** פונקציה של שני משתנים (משטח), התפלגות משותפת (משטח צפיפות או עמודות 3D), וקטורים ומרחבים (אלגברה לינארית), גיאומטריה, משטח הפסד/אופטימיזציה, ענני דגימות. במקרה כזה: Viz.scene3d כרכיב המרכזי, ולצידו plot2d של חתך או השוואה (columns: 2).
   אם המושג באמת חד-ממדי (התפלגות של משתנה אחד, פונקציה של x): plot2d מושקע עם הצללות, קווי ייחוס ואנימציה, ולא תלת-ממד מאולץ.
3. **אינטראקציה שמלמדת:** 2–4 פקדים עם שמות ברורים בעברית, readouts חיים של הערכים החשובים, ונוסחה שמתעדכנת עם הערכים (ui.formula(...).set(...)).
4. **תנועה כשהיא מוסיפה הבנה:** סימולציה שרצה (דגימות מצטברות, התכנסות, אלגוריתם צעד-צעד) עם כפתורי הפעל/עצור/אפס.
5. **הכוונה:** ui.note עם "מה לשים לב" ו"נסו:" משימה קונקרטית אחת ("הזיזו את p ל-0.01 וראו…").
6. כותרת ותתי-כותרות בעברית, תוויות צירים קצרות, צבעים מה-palette בלבד.`;

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
      maxTokens: 16000,
      prompt: [
        `בנה הסבר אינטראקטיבי ${concept ? `למושג "${concept}"` : ""} ${idea ? `שממחיש: ${idea}` : ""} מתוך הקורס "${ctx.course.name}".`,
        "תכנן קודם (בראש): מה התובנה המרכזית שהסטודנט צריך לקבל? איזו המחשה (3D או 2D) מראה אותה הכי טוב? אילו פקדים משנים אותה?",
        DESIGN_RULES,
        "explanation: 2–4 משפטים בעברית: מה רואים ומה לנסות לשנות, נוסחאות ב-LaTeX. citations: מזהי הקטעים.",
        WIDGET_RULES,
        WIDGET_KIT_API,
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
      prompt: `הווידג'ט הבא נכשל בדפדפן עם השגיאה:\n${error}\n\nתקן את הקוד ושמור על אותה מטרה. החזר את כל השדות (אותם title, explanation, concept, citations).\n\n${WIDGET_RULES}\n\n${WIDGET_KIT_API}\n\n<html_to_fix>\n${prev.html}\n</html_to_fix>`,
    });
    return { type: "interactive_widget", title: data.title, data: { ...data, citations: prev.citations } };
  },
});
