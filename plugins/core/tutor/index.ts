import { defineTool, extractInlineCitations } from "@ruecai/sdk";

const MODES: Record<string, string> = {
  "סוקרטי":
    "מצב סוקרטי: אל תיתן את התשובה מיד. שאל שאלה מנחה אחת בכל פעם, בנה על מה שהסטודנט כבר יודע, ותן רמז קטן כשהוא נתקע. אם הוא מבקש במפורש הסבר מלא — תן אותו.",
  "הסבר ישיר": "מצב הסבר: הסבר בבהירות ובקצרה — אינטואיציה, הגדרה, דוגמה. סיים בשאלה קצרה שבודקת הבנה.",
  "בוחן אותי":
    "מצב בוחן: שאל שאלה אחת בכל פעם על החומר, חכה לתשובה, תן משוב קצר (נכון/חלקי/שגוי ולמה) ואז שאלה הבאה. התחל מהמושגים החלשים.",
  "פשוט כמו לילד בן 12": "הסבר בשפה פשוטה מאוד, עם אנלוגיה מחיי היומיום, בלי ז'רגון — ואז הצג את המונח הרשמי.",
};

export default defineTool<"chat">({
  async run(ctx) {
    const chat = ctx.chat;
    if (!chat) throw new Error("tutor requires a chat context");
    const mode = String(ctx.params.mode || "סוקרטי");
    const recent = chat.history.slice(-4).map((t) => t.content).join(" ");
    const material = await ctx.retrieve({ query: `${chat.message} ${recent}`.slice(0, 500) });
    const concepts = await ctx.concepts();
    const weak = concepts.filter((c) => c.attempts > 0 && c.mastery < 0.4).map((c) => c.name);

    const system = [
      ctx.baseSystemPrompt,
      MODES[mode] ?? MODES["סוקרטי"],
      "ציטוטים: כשאתה מסתמך על החומר, הוסף בסוף המשפט את מזהה הקטע בסוגריים מרובעים, למשל [S12]. רק מזהים שמופיעים בהקשר.",
      "תשובות קצרות (עד ~200 מילים) אלא אם התבקש אחרת. Markdown ו-LaTeX מותרים.",
      weak.length ? `מושגים שהסטודנט חלש בהם (לפי התרגול): ${weak.join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const text = await ctx.llm.stream(
      { system, context: material.text, prompt: chat.message, history: chat.history, tier: "smart", tag: "tutor", maxTokens: 8000 },
      chat.onDelta,
    );
    return { text, citations: extractInlineCitations(text) };
  },
});
