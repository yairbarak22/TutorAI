/**
 * Discovers every plugin folder at build time: plugins/<pack>/<tool-id>/plugin.yaml
 * Adding a tool = adding a folder. No registration code needed.
 */
import type { CodeTool, Lang, LoadedTool } from "@ruecai/sdk";
import { loadPlugin, type CourseFixture } from "@ruecai/core";
import coreGolden from "./_fixtures/core-golden.json";
import coreGoldenEn from "./_fixtures/core-golden.en.json";
import probability from "./_fixtures/probability.json";
import probabilityEn from "./_fixtures/probability.en.json";
import law from "./_fixtures/law.json";
import lawEn from "./_fixtures/law.en.json";

const manifests = import.meta.glob<string>("./*/*/plugin.yaml", { query: "?raw", import: "default", eager: true });
const prompts = import.meta.glob<string>("./*/*/prompt.md", { query: "?raw", import: "default", eager: true });
const codes = import.meta.glob<CodeTool>("./*/*/index.ts", { import: "default", eager: true });
const goldens = import.meta.glob<Record<string, unknown>>("./*/*/evals/golden.json", { import: "default", eager: true });
/** English demo outputs (optional, per tool). Evals always use the Hebrew golden.json. */
const goldensEn = import.meta.glob<Record<string, unknown>>("./*/*/evals/golden.en.json", { import: "default", eager: true });
const evalSpecs = import.meta.glob<string>("./*/*/evals/eval.yaml", { query: "?raw", import: "default", eager: true });

export const pluginErrors: string[] = [];

export const tools: LoadedTool[] = Object.entries(manifests)
  .map(([path, manifestYaml]) => {
    const dir = path.replace(/^\.\//, "").replace(/\/plugin\.yaml$/, "");
    try {
      return loadPlugin({
        dir,
        manifestYaml,
        prompt: prompts[`./${dir}/prompt.md`],
        code: codes[`./${dir}/index.ts`],
        golden: goldens[`./${dir}/evals/golden.json`],
        evalYaml: evalSpecs[`./${dir}/evals/eval.yaml`],
      });
    } catch (e) {
      pluginErrors.push((e as Error).message);
      return null;
    }
  })
  .filter((t): t is LoadedTool => t !== null)
  .sort((a, b) => (a.manifest.pack === "core" ? 0 : 1) - (b.manifest.pack === "core" ? 0 : 1) || a.manifest.id.localeCompare(b.manifest.id));

export function getTool(id: string): LoadedTool {
  const t = tools.find((x) => x.manifest.id === id);
  if (!t) throw new Error(`Unknown tool: ${id}`);
  return t;
}

/**
 * All recorded outputs, keyed by LLM call tag — used by demo mode and CI evals.
 * With lang "en", English outputs replace the Hebrew ones where a tool provides them.
 */
export function demoFixtures(lang: Lang = "he"): Record<string, unknown> {
  const all: Record<string, unknown> = { ...(coreGolden as Record<string, unknown>) };
  for (const t of tools) Object.assign(all, (t.golden as Record<string, unknown>) ?? {});
  if (lang === "en") {
    Object.assign(all, coreGoldenEn as Record<string, unknown>);
    for (const [path, golden] of Object.entries(goldensEn)) if (tools.some((t) => path === `./${t.dir}/evals/golden.en.json`)) Object.assign(all, golden);
  }
  return all;
}

/** Fixture courses for evals and tests (Hebrew). */
export const courseFixtures: Record<string, CourseFixture> = {
  probability: probability as CourseFixture,
  law: law as CourseFixture,
};

const courseFixturesEn: Record<string, CourseFixture> = {
  probability: probabilityEn as CourseFixture,
  law: lawEn as CourseFixture,
};

/** The sample course offered in demo mode, in the interface language. */
export function demoCourse(which: "probability" | "law", lang: Lang = "he"): CourseFixture {
  return (lang === "en" ? courseFixturesEn : courseFixtures)[which];
}
