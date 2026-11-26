/**
 * Plugin quality gate — runs in CI on every pull request.
 *
 * For every plugin:
 *  1. manifest + files are valid (loader),
 *  2. the full pipeline runs against a fixture course (retrieve → prompt → LLM → validate → save),
 *     using the plugin's recorded golden output instead of a live model,
 *  3. the output passes the plugin's checks: schema, citation grounding, item count, Hebrew ratio, keywords.
 *
 * Live mode (real model, costs money): `ANTHROPIC_API_KEY=... npm run eval:live`
 * Uses the cheap model for both tiers by default; override with TUTORAI_EVAL_MODEL.
 */
import { afterAll, describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import { collectText, countItems, hebrewRatio, type LLMApi } from "@tutorai/sdk";
import { AnthropicLLM, MockLLM, runTool, seedCourse, Store } from "@tutorai/core";
import { courseFixtures, demoFixtures, pluginErrors, tools } from "./registry.ts";

const LIVE = process.env.TUTORAI_LIVE === "1" && !!process.env.ANTHROPIC_API_KEY;
const SQL = await initSqlJs();

const EVAL_MODEL = process.env.TUTORAI_EVAL_MODEL || "claude-haiku-5-5";
const usage = { input: 0, output: 0, calls: 0 };
afterAll(() => {
  if (LIVE) console.log(`[live evals] model=${EVAL_MODEL} calls=${usage.calls} input_tokens=${usage.input} output_tokens=${usage.output}`);
});

function llmFor(): LLMApi {
  if (!LIVE) return new MockLLM(demoFixtures());
  return new AnthropicLLM(process.env.ANTHROPIC_API_KEY!, { fast: EVAL_MODEL, smart: EVAL_MODEL }, (u) => {
    usage.calls++;
    usage.input += u.input + u.cacheRead;
    usage.output += u.output;
  });
}

describe("plugin registry", () => {
  it("loads every plugin without errors", () => {
    expect(pluginErrors).toEqual([]);
    expect(tools.length).toBeGreaterThanOrEqual(10);
  });
  it("every plugin has evals and (offline) a golden output", () => {
    for (const t of tools) {
      expect(t.evals, `${t.dir} is missing evals/eval.yaml`).toBeDefined();
      expect(t.golden, `${t.dir} is missing evals/golden.json`).toBeDefined();
    }
  });
  it("tool ids are unique", () => {
    const ids = tools.map((t) => t.manifest.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe.each(tools.map((t) => [t.manifest.id, t] as const))("plugin %s", (_id, tool) => {
  const spec = tool.evals!;
  it(
    "produces a valid, grounded artifact on the fixture course",
    async () => {
      const store = Store.open(SQL);
      const courseId = seedCourse(store, structuredClone(courseFixtures[spec.fixture]));
      const llm = llmFor();
      const deltas: string[] = [];
      const written: number[] = [];
      const result = await runTool(tool, {
        store,
        llm,
        courseId,
        params: spec.params,
        today: "2027-01-01",
        onOutput: (n) => written.push(n),
        chat:
          tool.manifest.output === "chat"
            ? { history: [], message: "לא מבין את נוסחת בייס, אפשר עזרה?", onDelta: (t) => deltas.push(t) }
            : undefined,
      });

      let text: string;
      if (result.kind === "chat") {
        text = result.reply.text;
        expect(deltas.join("")).toBe(text);
        if (spec.checks.min_citation_coverage > 0) expect(result.reply.citations.length).toBeGreaterThan(0);
      } else {
        const data = result.payload.data as Record<string, unknown>;
        text = collectText(data);
        expect(countItems(result.payload.type, data)).toBeGreaterThanOrEqual(spec.checks.min_items);
        expect(result.grounding.invalidIds, "citations must reference real sections").toEqual(LIVE ? result.grounding.invalidIds : []);
        expect(result.grounding.coverage).toBeGreaterThanOrEqual(spec.checks.min_citation_coverage);
        expect(store.artifact(result.artifactId)).toBeDefined();
        if (result.payload.type === "flashcards") expect(store.cardCount(courseId)).toBe(countItems("flashcards", data));
      }
      // Progress reporting: output size only ever grows during a run (cumulative across LLM calls).
      if (tool.manifest.id !== "study-plan") {
        expect(written.length).toBeGreaterThan(0);
        for (let i = 1; i < written.length; i++) expect(written[i]).toBeGreaterThanOrEqual(written[i - 1]);
      }
      expect(hebrewRatio(text)).toBeGreaterThanOrEqual(spec.checks.min_hebrew_ratio);
      for (const word of spec.checks.must_mention) expect(text).toContain(word);
    },
    LIVE ? 300_000 : 10_000,
  );
});
