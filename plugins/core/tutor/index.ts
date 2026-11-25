import { defineTool, extractInlineCitations } from "@ruecai/sdk";

const MODES: Record<string, string> = {
  socratic:
    "Socratic mode: don't give the answer right away. Ask one leading question at a time, build on what the student already knows, and give a small hint when they get stuck. If they explicitly ask for a full explanation, give it.",
  direct: "Explanation mode: explain clearly and briefly (intuition, definition, example). End with a short question that checks understanding.",
  "quiz-me":
    "Quiz mode: ask one question at a time about the material, wait for the answer, give short feedback (correct / partly / wrong, and why), then the next question. Start with the weak concepts.",
  simple: "Explain in very simple language, with an everyday analogy and no jargon, then introduce the official term.",
};
/** Mode names used before the options became English slugs. */
const LEGACY: Record<string, string> = { "סוקרטי": "socratic", "הסבר ישיר": "direct", "בוחן אותי": "quiz-me", "פשוט כמו לילד בן 12": "simple" };

export default defineTool<"chat">({
  async run(ctx) {
    const chat = ctx.chat;
    if (!chat) throw new Error("tutor requires a chat context");
    const raw = String(ctx.params.mode || "socratic");
    const mode = LEGACY[raw] ?? raw;
    const recent = chat.history.slice(-4).map((t) => t.content).join(" ");
    const material = await ctx.retrieve({ query: `${chat.message} ${recent}`.slice(0, 500) });
    const concepts = await ctx.concepts();
    const weak = concepts.filter((c) => c.attempts > 0 && c.mastery < 0.4).map((c) => c.name);

    const system = [
      ctx.baseSystemPrompt,
      MODES[mode] ?? MODES.socratic,
      "Citations: when you rely on the material, add the section ID in square brackets at the end of the sentence, for example [S12]. Only IDs that appear in the context.",
      "Keep answers short (up to ~200 words) unless asked otherwise. Markdown and LaTeX are allowed.",
      weak.length ? `Concepts the student is weak in (from their practice): ${weak.join(", ")}.` : "",
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
