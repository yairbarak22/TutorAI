/**
 * Discovers every plugin folder at build time: plugins/<pack>/<tool-id>/plugin.yaml
 * Adding a tool = adding a folder. No registration code needed.
 */
import type { CodeTool, LoadedTool } from "@ruecai/sdk";
import { loadPlugin, type CourseFixture } from "@ruecai/core";
import coreGolden from "./_fixtures/core-golden.json";
import probability from "./_fixtures/probability.json";
import law from "./_fixtures/law.json";

const manifests = import.meta.glob<string>("./*/*/plugin.yaml", { query: "?raw", import: "default", eager: true });
const prompts = import.meta.glob<string>("./*/*/prompt.he.md", { query: "?raw", import: "default", eager: true });
const codes = import.meta.glob<CodeTool>("./*/*/index.ts", { import: "default", eager: true });
const goldens = import.meta.glob<Record<string, unknown>>("./*/*/evals/golden.json", { import: "default", eager: true });
const evalSpecs = import.meta.glob<string>("./*/*/evals/eval.yaml", { query: "?raw", import: "default", eager: true });

export const pluginErrors: string[] = [];

export const tools: LoadedTool[] = Object.entries(manifests)
  .map(([path, manifestYaml]) => {
    const dir = path.replace(/^\.\//, "").replace(/\/plugin\.yaml$/, "");
    try {
      return loadPlugin({
        dir,
        manifestYaml,
        prompt: prompts[`./${dir}/prompt.he.md`],
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

/** All recorded outputs, keyed by LLM call tag — used by demo mode and CI evals. */
export function demoFixtures(): Record<string, unknown> {
  const all: Record<string, unknown> = { ...(coreGolden as Record<string, unknown>) };
  for (const t of tools) Object.assign(all, (t.golden as Record<string, unknown>) ?? {});
  return all;
}

export const courseFixtures: Record<string, CourseFixture> = {
  probability: probability as CourseFixture,
  law: law as CourseFixture,
};
