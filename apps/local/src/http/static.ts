import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Serves the built web app. In the single binary the files are embedded as SEA assets
 * ("web/<path>", listed in the "web-manifest.json" asset); from a source checkout they are
 * read from apps/web/dist.
 */

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".sh": "text/plain; charset=utf-8",
  ".ps1": "text/plain; charset=utf-8",
};

export const mimeFor = (path: string) => MIME[extname(path).toLowerCase()] ?? "application/octet-stream";

export interface StaticFile {
  body: Uint8Array;
  type: string;
  cache: string;
}

type Sea = { isSea(): boolean; getAsset(key: string): ArrayBuffer };

function loadSea(): Sea | null {
  try {
    // node:sea exists from Node 20; isSea() is false outside a single executable.
    const sea = (process as unknown as { getBuiltinModule?: (n: string) => unknown }).getBuiltinModule?.("node:sea") as Sea | undefined;
    return sea?.isSea() ? sea : null;
  } catch {
    return null;
  }
}

const here = typeof __dirname === "string" ? __dirname : dirname(fileURLToPath(import.meta.url));

export function webRoot() {
  return process.env.TUTORAI_WEB_DIR || join(here, "..", "..", "..", "web", "dist");
}

export class StaticFiles {
  private sea = loadSea();
  private manifest: Set<string> | null = null;

  constructor(private root = webRoot()) {
    if (this.sea) {
      const list = JSON.parse(new TextDecoder().decode(this.sea.getAsset("web-manifest.json"))) as string[];
      this.manifest = new Set(list);
    }
  }

  private async read(rel: string): Promise<Uint8Array | null> {
    if (this.sea) return this.manifest!.has(rel) ? new Uint8Array(this.sea.getAsset(`web/${rel}`)) : null;
    const abs = normalize(join(this.root, rel));
    if (!abs.startsWith(normalize(this.root) + sep)) return null;
    try {
      return new Uint8Array(await readFile(abs));
    } catch {
      return null;
    }
  }

  /** Resolves a URL path to a file; unknown paths without an extension fall back to index.html (SPA). */
  async get(urlPath: string): Promise<StaticFile | null> {
    let rel = decodeURIComponent(urlPath).replace(/^\/+/, "");
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    if (rel.split("/").some((p) => p === ".." || p === ".")) return null;
    let body = await this.read(rel);
    if (!body && !extname(rel)) {
      rel = "index.html";
      body = await this.read(rel);
    }
    if (!body) return null;
    const hashed = rel.startsWith("assets/");
    const cache = hashed ? "public, max-age=31536000, immutable" : "no-cache";
    return { body, type: mimeFor(rel), cache };
  }
}
