import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { Plugin } from "vite";

const ID = "virtual:widget-kit";
const RESOLVED = "\0" + ID;
const ENTRY = fileURLToPath(new URL("./src/widget-kit/kit.ts", import.meta.url));

/**
 * `import kit from "virtual:widget-kit"` → the Viz Kit (three.js + helpers) bundled to one
 * minified IIFE string, ready to inline as a <script> inside the sandboxed widget iframe
 * (whose CSP forbids loading anything from the network).
 */
export function widgetKit(): Plugin {
  return {
    name: "ruecai-widget-kit",
    resolveId: (id) => (id === ID ? RESOLVED : null),
    async load(id) {
      if (id !== RESOLVED) return null;
      const out = await build({
        entryPoints: [ENTRY],
        bundle: true,
        format: "iife",
        minify: true,
        target: "es2020",
        legalComments: "none",
        write: false,
        metafile: true,
        absWorkingDir: process.cwd(),
      });
      for (const f of Object.keys(out.metafile!.inputs)) if (!f.includes("node_modules")) this.addWatchFile(resolve(process.cwd(), f));
      const code = out.outputFiles[0].text.replace(/<\/(script)/gi, "<\\/$1");
      return `export default ${JSON.stringify(code)};`;
    },
  };
}
