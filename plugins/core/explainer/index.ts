import { defineTool, InteractiveWidget, WIDGET_KIT_API, languageName, t, type ArtifactPayload } from "@tutorai/sdk";

const WIDGET_RULES = `Mandatory technical rules for the html field:
- Return ONLY the body content: one <script> element (and a short <style> if needed). No <!doctype>, <html> or <head>: the frame, styling and libraries are already loaded.
- Build everything with the Viz Kit (documented below) and THREE. Do not write your own drawing engine, axes, sliders or styling: the kit gives a consistent, professional look.
- Forbidden: <script src>, external links, fetch/XMLHttpRequest/WebSocket, localStorage, cookies, alert/prompt, iframes.
- Every formula: ui.formula("...") or $...$ inside ui.note/readouts. Never a formula as plain text. Inside a JS string write \\\\ for every \\ in LaTeX.
- The code must run without errors: no undefined variables, no heavy loops (up to ~20,000 points), update only when a slider changes.`;

const DESIGN_RULES = `What an excellent visualization looks like:
1. **It shows something text cannot.** Not a plain "graph of the formula" but the mechanism: how changing a parameter moves the result, why the theorem holds, where intuition breaks.
2. **Look for a meaningful 3D angle first.** Almost every concept has one, for example a distribution as a function of x and of its parameter, or an outcome as a function of two parameters. **3D fits especially well for:** a function of two variables (surface), a joint distribution (density surface or 3D bars), vectors and spaces (linear algebra), geometry, a loss/optimization landscape, clouds of samples. In that case: Viz.scene3d as the main element, and next to it a plot2d of a cross-section or comparison (columns: 2).
   If the concept really is one-dimensional (a distribution of one variable, a function of x): a polished plot2d with shading, reference lines and animation, not forced 3D.
3. **Interaction that teaches:** 2–4 controls with clear names, live readouts of the important values, and a formula that updates with the values (ui.formula(...).set(...)).
4. **Motion when it adds understanding:** a running simulation (accumulating samples, convergence, an algorithm step by step) with play/pause/reset buttons.
5. **Guidance:** ui.note with "what to notice" and one concrete "try this" task ("move p to 0.01 and see…").
6. Title, subtitles, labels and notes in the output language; short axis labels; colors from the palette only.`;

export default defineTool<"interactive_widget">({
  async run(ctx) {
    const concept = String(ctx.params.concept || "");
    const idea = String(ctx.params.idea || "");
    if (!concept && !idea) throw new Error(t("בחרו מושג או תארו מה להמחיש.", "Choose a concept or describe what to visualize."));
    ctx.progress(0.1, t("אוסף חומר…", "Collecting material…"));
    const material = await ctx.retrieve({ query: `${concept} ${idea}` });
    ctx.progress(0.3, t("בונה סימולציה…", "Building the simulation…"));
    const data = await ctx.llm.object(InteractiveWidget, {
      system: ctx.baseSystemPrompt,
      context: material.text,
      tier: "smart",
      tag: "explainer",
      maxTokens: 16000,
      prompt: [
        `Build an interactive explanation ${concept ? `of the concept "${concept}"` : ""} ${idea ? `that shows: ${idea}` : ""} from the course "${ctx.course.name}". All visible text in ${languageName()}.`,
        "Plan first (in your head): what is the key insight the student should get? Which visualization (3D or 2D) shows it best? Which controls change it?",
        DESIGN_RULES,
        `explanation: 2–4 sentences in ${languageName()}: what you see and what to try changing, formulas in LaTeX. citations: the section IDs.`,
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
      prompt: `The following widget failed in the browser with this error:\n${error}\n\nFix the code and keep the same goal. Return all fields (the same title, explanation, concept, citations).\n\n${WIDGET_RULES}\n\n${WIDGET_KIT_API}\n\n<html_to_fix>\n${prev.html}\n</html_to_fix>`,
    });
    return { type: "interactive_widget", title: data.title, data: { ...data, citations: prev.citations } };
  },
});
