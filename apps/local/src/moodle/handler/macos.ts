import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * macOS: a small AppleScript app that receives `moodlemobile://…` links (docs/rfc-moodle.md §6.3).
 * Built with tools that ship with macOS: no Xcode, no Apple account, no quarantine. It writes the
 * link to a private file and runs `tutorai moodle-link`, so the token never sits on a command line.
 */

const LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister";
export const BUNDLE_ID = "io.github.yairbarak22.tutorai.moodle";
const TOOL_TIMEOUT_MS = 5000;

const run = (file: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile(file, args, { timeout: TOOL_TIMEOUT_MS, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });

/** Only paths that can be written as an AppleScript string literal. Spaces and non-ASCII letters are fine. */
export const embeddable = (s: string) => s.length > 0 && !/["\\\r\n\u0000-\u001f]/.test(s);
const literal = (s: string) => `"${s}"`;

export interface MacHandlerSpec {
  /** Where the app is created (an Applications folder: apps in temp folders are not registered). */
  app: string;
  /** The command that starts this TutorAI, as separate arguments. */
  command: string[];
  /** The folder the command runs in (a source checkout needs it to find its loader). */
  cwd: string;
  /** This server's config folder; the link reaches the server that owns it. */
  configDir: string;
  inbox: string;
}

export function appleScript(spec: MacHandlerSpec): string | null {
  const parts = [spec.cwd, spec.configDir, spec.inbox, ...spec.command];
  if (!parts.every(embeddable)) return null;
  const command = spec.command.map((p) => `quoted form of ${literal(p)}`).join(' & " " & ');
  return `on open location theURL
	set p to ${literal(`${spec.inbox}/link-`)} & (do shell script "/usr/bin/uuidgen")
	set f to open for access (POSIX file p) with write permission
	try
		set eof of f to 0
		write theURL to f as «class utf8»
		close access f
	on error
		close access f
	end try
	do shell script "cd " & quoted form of ${literal(spec.cwd)} & " && " & ${command} & " moodle-link --config " & quoted form of ${literal(spec.configDir)} & " --from-file " & quoted form of p
end open location
`;
}

/** The app macOS would open for a moodlemobile link, or null when there is none. */
export async function currentHandler(): Promise<string | null> {
  const out = await run("/usr/bin/osascript", [
    "-l",
    "JavaScript",
    "-e",
    'ObjC.import("AppKit"); var u = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.URLWithString("moodlemobile://token=x")); u.isNil() ? "" : ObjC.unwrap(u.path)',
  ]);
  return out.trim() || null;
}

const same = async (a: string, b: string) => {
  const real = (p: string) => realpath(p).catch(() => p);
  return (await real(a)) === (await real(b));
};

/** Builds and registers the app. Returns false (and leaves nothing) when it can't be done safely. */
export async function installMac(spec: MacHandlerSpec): Promise<boolean> {
  const script = appleScript(spec);
  if (!script || !embeddable(spec.app)) return false;
  // Never take the scheme from another program.
  if (await currentHandler()) return false;
  const work = await mkdtemp(join(tmpdir(), "tutorai-handler-"));
  try {
    await mkdir(spec.inbox, { recursive: true, mode: 0o700 });
    await mkdir(dirname(spec.app), { recursive: true });
    await rm(spec.app, { recursive: true, force: true });
    const source = join(work, "handler.applescript");
    await writeFile(source, script, "utf8");
    const plist = join(spec.app, "Contents", "Info.plist");
    await run("/usr/bin/osacompile", ["-o", spec.app, source]);
    await run("/usr/bin/plutil", ["-replace", "CFBundleIdentifier", "-string", BUNDLE_ID, plist]);
    await run("/usr/bin/plutil", ["-replace", "LSUIElement", "-bool", "true", plist]);
    await run("/usr/bin/plutil", ["-insert", "CFBundleURLTypes", "-json", '[{"CFBundleURLName":"Moodle sign-in","CFBundleURLSchemes":["moodlemobile"]}]', plist]);
    await run("/usr/bin/codesign", ["--force", "--sign", "-", spec.app]);
    await run(LSREGISTER, ["-f", spec.app]);
    // The system must now report ours; registration can take a moment.
    for (let i = 0; i < 10; i++) {
      const now = await currentHandler();
      if (now && (await same(now, spec.app))) return true;
      if (now) break; // someone else's
      await new Promise((r) => setTimeout(r, 200));
    }
    await removeMac(spec.app);
    return false;
  } catch {
    await removeMac(spec.app).catch(() => {});
    return false;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Unregisters and deletes our app. Safe when it is already gone. */
export async function removeMac(app: string) {
  await run(LSREGISTER, ["-u", app]).catch(() => {});
  await rm(app, { recursive: true, force: true });
}
