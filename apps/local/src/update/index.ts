import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, rename, rm, writeFile, stat } from "node:fs/promises";
import type { UpdateStatus } from "@tutorai/local-api";
import { loadSettings } from "../config.ts";
import { log } from "../log.ts";
import { RELEASE_PUBLIC_KEY, verifySums } from "./signing.ts";

/**
 * Self-update from GitHub Releases (RFC §8.3): download the binary for this OS/CPU and
 * SHA256SUMS, verify, stage next to the running binary, swap on restart.
 */

export const REPO = "yairbarak22/TutorAI";
const CHECK_EVERY_MS = 24 * 3600 * 1000;

export function assetName(platform = process.platform, arch = process.arch) {
  const os = platform === "win32" ? "windows" : platform === "darwin" ? "macos" : "linux";
  return `tutorai-${os}-${arch}${platform === "win32" ? ".exe" : ""}`;
}

export function newer(a: string, b: string) {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

export function parseSums(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of text.split("\n")) {
    const match = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (match) m.set(match[2].trim(), match[1].toLowerCase());
  }
  return m;
}

export interface UpdaterOptions {
  current: string;
  /** The running binary; updates only apply to an installed single binary. */
  binary: string | null;
  apiBase?: string;
  fetchFn?: typeof fetch;
  /** Restarts into the new binary (lifecycle provides it). */
  relaunch: (binary: string) => Promise<void>;
  /** The release signing key (tests pass their own). */
  publicKey?: string;
}

export class Updater {
  private latest: string | null = null;
  private staged = false;
  private checking: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private o: UpdaterOptions) {}

  private get fetchFn() {
    return this.o.fetchFn ?? fetch;
  }

  async status(): Promise<UpdateStatus> {
    const s = await loadSettings();
    return { current: this.o.current, latest: this.latest, staged: this.staged, auto: s.autoUpdate };
  }

  start() {
    const run = async () => {
      if ((await loadSettings()).autoUpdate) await this.check().catch((e) => log("warn", `update check: ${(e as Error).message}`));
    };
    void run();
    this.timer = setInterval(run, CHECK_EVERY_MS);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  check(): Promise<void> {
    this.checking ??= this.doCheck().finally(() => (this.checking = null));
    return this.checking;
  }

  private async doCheck() {
    if (!this.o.binary || this.staged) return;
    const base = this.o.apiBase ?? `https://api.github.com/repos/${REPO}`;
    const r = await this.fetchFn(`${base}/releases/latest`, { headers: { accept: "application/vnd.github+json" } });
    if (!r.ok) throw new Error(`releases ${r.status}`);
    const rel = (await r.json()) as { tag_name?: string; assets?: { name: string; browser_download_url: string }[] };
    if (!rel.tag_name) return;
    this.latest = rel.tag_name.replace(/^v/, "");
    if (!newer(this.latest, this.o.current)) return;
    const want = assetName();
    const bin = rel.assets?.find((a) => a.name === want);
    const sums = rel.assets?.find((a) => a.name === "SHA256SUMS");
    if (!bin || !sums) throw new Error("release is missing assets");
    const sumsRes = await this.fetchFn(sums.browser_download_url);
    if (!sumsRes.ok) throw new Error(`SHA256SUMS ${sumsRes.status}`);
    const sumsText = await sumsRes.text();
    // Fail closed: without a release key built in, never install an update automatically.
    const publicKey = this.o.publicKey ?? RELEASE_PUBLIC_KEY;
    if (!publicKey) throw new Error("no release signing key in this build; automatic updates are off (reinstall to update)");
    const sigAsset = rel.assets?.find((a) => a.name === "SHA256SUMS.sig");
    const sigRes = sigAsset ? await this.fetchFn(sigAsset.browser_download_url) : null;
    if (!sigRes?.ok || !verifySums(sumsText, await sigRes.text(), publicKey)) throw new Error("release signature is missing or invalid; update skipped");
    const expected = parseSums(sumsText).get(want);
    if (!expected) throw new Error("no checksum for this platform");
    const res = await this.fetchFn(bin.browser_download_url);
    if (!res.ok) throw new Error(`download ${res.status}`);
    const data = new Uint8Array(await res.arrayBuffer());
    const got = createHash("sha256").update(data).digest("hex");
    if (got !== expected) throw new Error("checksum mismatch; update skipped");
    const staged = `${this.o.binary}.new`;
    await writeFile(staged, data, { mode: 0o755 });
    this.staged = true;
    log("info", `update ${this.latest} staged`);
  }

  /** Swaps the staged binary in and restarts into it. */
  async restart() {
    const bin = this.o.binary;
    if (!bin) return this.o.relaunch(process.execPath);
    const staged = `${bin}.new`;
    if (this.staged && (await exists(staged))) {
      if (process.platform === "win32") {
        // A running .exe can be renamed but not replaced.
        await rm(`${bin}.old`, { force: true }).catch(() => {});
        await rename(bin, `${bin}.old`);
        try {
          await rename(staged, bin);
        } catch (e) {
          await rename(`${bin}.old`, bin).catch(() => {}); // put the working binary back
          throw e;
        }
      } else {
        await rename(staged, bin);
        await chmod(bin, 0o755);
        if (process.platform === "darwin") await adhocSign(bin);
      }
      this.staged = false;
    }
    await this.o.relaunch(bin);
  }
}

const exists = (p: string) => stat(p).then(() => true, () => false);

function adhocSign(file: string) {
  return new Promise<void>((resolve) => execFile("/usr/bin/codesign", ["--force", "--sign", "-", file], () => resolve()));
}

/** Leftover from a Windows swap. */
export async function cleanupOld(binary: string | null) {
  if (binary) await rm(`${binary}.old`, { force: true }).catch(() => {});
}

