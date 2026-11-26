import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { renameWithRetry } from "../config.ts";

/**
 * The student's data folder (tutorai.db, courses/…). Same layout as the web app's folder mode,
 * so the same folder works in both. Every path is checked to stay inside the folder.
 */

export class PathError extends Error {}

/** Rejects absolute paths, "..", NUL and drive letters. Returns the joined absolute path. */
export function lexicalInside(root: string, rel: string): string {
  if (!rel || rel.includes("\0") || isAbsolute(rel) || /^[a-zA-Z]:/.test(rel) || rel.startsWith("\\")) throw new PathError("bad path");
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0 || parts.some((p) => p === ".." || p === ".")) throw new PathError("bad path");
  return join(root, ...parts);
}

/** The nearest existing ancestor's real path must stay inside the root's real path (no symlink escape). */
async function realInside(root: string, abs: string) {
  const realRoot = await realpath(root);
  let probe = abs;
  for (;;) {
    try {
      const real = await realpath(probe);
      if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new PathError("outside the data folder");
      return;
    } catch (e) {
      if (e instanceof PathError) throw e;
      const up = dirname(probe);
      if (up === probe) throw new PathError("outside the data folder");
      probe = up;
    }
  }
}

export class DataFolder {
  constructor(public root: string) {}

  async ensure() {
    await mkdir(this.root, { recursive: true });
  }

  private async resolve(rel: string) {
    await this.ensure();
    const abs = lexicalInside(this.root, rel);
    await realInside(this.root, abs);
    return abs;
  }

  async read(rel: string): Promise<Buffer | null> {
    const abs = await this.resolve(rel);
    try {
      return await readFile(abs);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async exists(rel: string): Promise<boolean> {
    const abs = await this.resolve(rel);
    try {
      return (await stat(abs)).isFile();
    } catch {
      return false;
    }
  }

  /** Atomic replace: write a temp file next to the target, then rename over it. */
  async write(rel: string, data: Uint8Array) {
    const abs = await this.resolve(rel);
    await mkdir(dirname(abs), { recursive: true });
    await realInside(this.root, dirname(abs));
    const tmp = join(dirname(abs), `.${basename(abs)}.tmp-${randomBytes(4).toString("hex")}`);
    await writeFile(tmp, data);
    try {
      await renameWithRetry(tmp, abs);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
  }

  async remove(rel: string) {
    const abs = await this.resolve(rel);
    await rm(abs, { force: true });
  }

  get label() {
    const home = homedir();
    return this.root.startsWith(home + sep) ? `~${this.root.slice(home.length)}` : this.root;
  }
}

/** Validates a folder the student chose: inside their home folder, created if missing, writable. */
export async function prepareFolder(path: string, home = homedir()): Promise<string> {
  const abs = resolve(path);
  const realHome = await realpath(home);
  if (abs !== home && !abs.startsWith(home + sep) && !abs.startsWith(realHome + sep)) throw new PathError("Choose a folder inside your home folder");
  await mkdir(abs, { recursive: true });
  const probe = join(abs, `.tutorai-write-test-${randomBytes(3).toString("hex")}`);
  await writeFile(probe, "ok");
  await rm(probe, { force: true });
  return abs;
}

/** Lists sub-folders (no dot-folders) of a folder inside home, for the folder chooser. */
export async function browse(path: string | undefined, home = homedir()) {
  const abs = resolve(path || home);
  if (abs !== home && !abs.startsWith(home + sep)) throw new PathError("Outside your home folder");
  const entries = await readdir(abs, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !(process.platform === "darwin" && e.name === "Library"))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  return { path: abs, parent: abs === home ? null : dirname(abs), dirs };
}
