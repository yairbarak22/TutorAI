import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { renameWithRetry } from "../config.ts";
import { configDir } from "../paths.ts";

/** The only dot-file the app keeps in the data folder (marks it open on another device). */
const LOCK_FILE = ".tutorai-lock";

/**
 * The student's data folder (tutorai.db, courses/…). Same layout as the web app's folder mode,
 * so the same folder works in both. Every path is checked to stay inside the folder.
 */

export class PathError extends Error {}
/** A streamed file went over its size limit. */
export class TooLargeError extends Error {}

const PART_NAME = /^incoming-[a-f0-9]{12}\.part$/;

/** Rejects absolute paths, "..", NUL and drive letters. Returns the joined absolute path. */
export function lexicalInside(root: string, rel: string): string {
  if (!rel || rel.includes("\0") || isAbsolute(rel) || /^[a-zA-Z]:/.test(rel) || rel.startsWith("\\")) throw new PathError("bad path");
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0 || parts.some((p) => p === ".." || p === ".")) throw new PathError("bad path");
  // No hidden files or folders (.ssh, .config, …), except the app's own lock file at the top.
  if (parts.some((p, i) => p.startsWith(".") && !(i === 0 && parts.length === 1 && p === LOCK_FILE))) throw new PathError("bad path");
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

  /**
   * Streams a download into the folder `dirRel` as `incoming-<random>.part`, hashing as it goes,
   * so a large file is never held in memory and never appears under its final name half-written.
   * The caller checks the result and then calls `commitPart` or `discardPart`.
   */
  async importStream(
    dirRel: string,
    source: AsyncIterable<Uint8Array>,
    opts: { maxBytes: number; onProgress?: (received: number) => void },
  ): Promise<{ part: string; hash: string; size: number; head: Buffer }> {
    const part = `${dirRel.replace(/[\\/]+$/, "")}/incoming-${randomBytes(6).toString("hex")}.part`;
    const abs = await this.resolve(part);
    await mkdir(dirname(abs), { recursive: true });
    await realInside(this.root, dirname(abs));
    const hash = createHash("sha256");
    const head: Buffer[] = [];
    let headLength = 0;
    let size = 0;
    const handle = await open(abs, "wx");
    try {
      for await (const chunk of source) {
        size += chunk.length;
        if (size > opts.maxBytes) throw new TooLargeError("too large");
        hash.update(chunk);
        if (headLength < 64) {
          const slice = Buffer.from(chunk.subarray(0, 64 - headLength));
          head.push(slice);
          headLength += slice.length;
        }
        await handle.write(chunk);
        opts.onProgress?.(size);
      }
    } catch (e) {
      await handle.close().catch(() => {});
      await rm(abs, { force: true });
      throw e;
    }
    await handle.close();
    return { part, hash: hash.digest("hex"), size, head: Buffer.concat(head) };
  }

  private async partPath(part: string) {
    const abs = await this.resolve(part);
    if (!PART_NAME.test(basename(abs))) throw new PathError("bad path");
    return abs;
  }

  /** Gives a finished part its final name, in the same folder. */
  async commitPart(part: string, finalRel: string) {
    const from = await this.partPath(part);
    const to = await this.resolve(finalRel);
    if (dirname(from) !== dirname(to)) throw new PathError("bad path");
    await renameWithRetry(from, to);
  }

  async discardPart(part: string) {
    await rm(await this.partPath(part), { force: true });
  }

  /** Removes parts an interrupted download left behind. */
  async sweepParts(dirRel: string, olderThanMs: number, now = Date.now()) {
    const abs = await this.resolve(dirRel);
    let names: string[] = [];
    try {
      names = await readdir(abs);
    } catch {
      return;
    }
    for (const name of names) {
      if (!PART_NAME.test(name)) continue;
      const file = join(abs, name);
      const info = await stat(file).catch(() => null);
      if (info && now - info.mtimeMs > olderThanMs) await rm(file, { force: true });
    }
  }

  get label() {
    const home = homedir();
    return this.root.startsWith(home + sep) ? `~${this.root.slice(home.length)}` : this.root;
  }
}

const within = (p: string, dir: string) => p === dir || p.startsWith(dir + sep);

/**
 * Validates a folder the student chose: a sub-folder of their home folder (not home itself), not
 * hidden, not a system/app-data folder, not TutorAI's own config; created if missing, writable.
 */
export async function prepareFolder(path: string, home = homedir()): Promise<string> {
  const abs = resolve(path);
  const realHome = await realpath(home);
  const inside = (p: string) => (p.startsWith(home + sep) ? p : p.startsWith(realHome + sep) ? home + p.slice(realHome.length) : null);
  const blocked = [configDir(home), join(home, "Library"), join(home, "AppData"), join(home, ".config"), join(home, ".ssh")];
  const check = (candidate: string | null) => {
    if (!candidate) throw new PathError("Choose a folder inside your home folder (not the home folder itself)");
    const parts = candidate.slice(home.length + 1).split(sep);
    if (parts.some((p) => p.startsWith("."))) throw new PathError("Choose a regular (not hidden) folder");
    if (blocked.some((b) => within(candidate, b) || within(b, candidate))) throw new PathError("Choose a different folder");
  };
  check(inside(abs)); // before creating anything
  await mkdir(abs, { recursive: true });
  check(inside(await realpath(abs))); // the real location too, in case a symlink points elsewhere
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
