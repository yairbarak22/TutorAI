import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { readJson, writePrivate } from "../../config.ts";
import { log } from "../../log.ts";
import { configDir, moodleHandlerApp, paths } from "../../paths.ts";
import { BUNDLE_ID, installMac, removeMac, type MacHandlerSpec } from "./macos.ts";

/**
 * The temporary handler for `moodlemobile://` links (docs/rfc-moodle.md §6.3). It exists only while
 * a sign-in is pending, never replaces another program's registration, and is removed afterwards.
 * Where it can't be installed, sign-in falls back to copying the link by hand ("manual" mode).
 *
 * v1: macOS. Windows stays manual until its registry handler is verified; Linux is manual.
 */
export interface Handler {
  /** True when TutorAI will open by itself after sign-in. */
  install(): Promise<boolean>;
  remove(): Promise<void>;
  /** Removes a handler an earlier run left behind (if it is still ours) and empties the inbox. */
  cleanup(): Promise<void>;
}

export interface HandlerOptions {
  /** The command that starts this TutorAI, as separate arguments (absolute paths). */
  command: string[];
  cwd?: string;
  platform?: NodeJS.Platform;
  /** macOS: where the app is created. Only this path is ever created or deleted. */
  app?: string;
  /** Tests: stand-ins for the system steps. */
  mac?: { install(spec: MacHandlerSpec): Promise<boolean>; remove(app: string): Promise<void> };
}

interface Marker {
  platform: "darwin";
  app: string;
  bundleId: string;
}

export const noHandler: Handler = { install: async () => false, remove: async () => {}, cleanup: async () => {} };

export function createHandler(opts: HandlerOptions): Handler {
  const platform = opts.platform ?? process.platform;
  const forcedOff = () => process.env.TUTORAI_MOODLE_HANDLER === "off";
  const app = opts.app ?? moodleHandlerApp();
  const mac = opts.mac ?? { install: installMac, remove: removeMac };
  const marker = () => paths().moodleHandler;

  // Install and remove never overlap: a removal that arrives while the app is being built waits
  // for it and then removes it, so nothing is left registered without a marker.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };

  const emptyInbox = async () => {
    const inbox = paths().moodleInbox;
    for (const name of await readdir(inbox).catch(() => [] as string[])) await rm(join(inbox, name), { force: true });
  };

  const removeNow = async () => {
    if (platform !== "darwin") return;
    const m = await readJson<Marker>(marker());
    // Ours to remove: what the marker describes, or the app at our own fixed path (a marker can be
    // lost; that path is created by nothing else). The marker is never trusted to name another path.
    // (With the handler switched off, as in unit tests, an unmarked app is left alone: it may belong to a real TutorAI running on this computer.)
    const ours = (m?.platform === "darwin" && m.bundleId === BUNDLE_ID && m.app === app) || (!forcedOff() && existsSync(app));
    if (!ours) return void (await rm(marker(), { force: true }));
    try {
      await mac.remove(app);
      await rm(marker(), { force: true });
    } catch (e) {
      // Keep the marker: the next start tries again.
      log("warn", `moodle handler removal: ${(e as Error).message}`);
    }
  };

  return {
    install: () =>
      serial(async () => {
        if (forcedOff() || platform !== "darwin") return false;
        await removeNow();
        try {
          // The marker is written first, so a crash in the middle is still cleaned up next time.
          await writePrivate(marker(), JSON.stringify({ platform: "darwin", app, bundleId: BUNDLE_ID } satisfies Marker));
          const ok = await mac.install({ app, command: opts.command, cwd: opts.cwd ?? process.cwd(), configDir: configDir(), inbox: paths().moodleInbox });
          if (!ok) await removeNow();
          return ok;
        } catch (e) {
          log("warn", `moodle handler install: ${(e as Error).message}`);
          await removeNow();
          return false;
        }
      }),
    remove: () => serial(removeNow),
    cleanup: () =>
      serial(async () => {
        await removeNow();
        await emptyInbox();
      }),
  };
}
