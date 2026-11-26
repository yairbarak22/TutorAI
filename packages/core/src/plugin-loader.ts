import { parse as parseYaml } from "yaml";
import { EvalSpec, ToolManifest, type CodeTool, type LoadedTool } from "@tutorai/sdk";

export interface PluginFiles {
  dir: string;
  manifestYaml: string;
  prompt?: string;
  code?: CodeTool;
  golden?: unknown;
  evalYaml?: string;
}

export class PluginError extends Error {}

/** Validates a plugin folder's files and returns a runnable tool. Throws with a readable message. */
export function loadPlugin(f: PluginFiles): LoadedTool {
  let raw: unknown;
  try {
    raw = parseYaml(f.manifestYaml);
  } catch (e) {
    throw new PluginError(`${f.dir}/plugin.yaml: invalid YAML: ${(e as Error).message}`);
  }
  const parsed = ToolManifest.safeParse(raw);
  if (!parsed.success)
    throw new PluginError(`${f.dir}/plugin.yaml: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const manifest = parsed.data;
  const expectedId = f.dir.split("/").pop();
  if (manifest.id !== expectedId) throw new PluginError(`${f.dir}: id "${manifest.id}" must match folder name "${expectedId}"`);
  if (manifest.kind === "declarative" && !f.prompt) throw new PluginError(`${f.dir}: declarative plugin needs prompt.md`);
  if (manifest.kind === "code" && !f.code) throw new PluginError(`${f.dir}: code plugin needs index.ts with a default export`);
  if (manifest.output === "chat" && manifest.kind !== "code") throw new PluginError(`${f.dir}: chat tools must be code plugins`);
  const evals = f.evalYaml ? EvalSpec.parse(parseYaml(f.evalYaml)) : undefined;
  return { manifest, prompt: f.prompt, code: f.code, golden: f.golden, evals, dir: f.dir };
}
