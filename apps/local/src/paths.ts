import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Everything TutorAI Local keeps for itself (never the student's data) lives here. */
export function configDir(home = homedir()) {
  return process.env.TUTORAI_CONFIG_DIR || join(home, ".tutorai");
}

export const paths = (home = homedir()) => {
  const dir = configDir(home);
  return {
    dir,
    settings: join(dir, "settings.json"),
    hostId: join(dir, "host-id"),
    sessionKey: join(dir, "session.key"),
    run: join(dir, "run.json"),
    chatgpt: join(dir, "chatgpt"),
    /** Moodle connections (one owner-only file per site), the sign-in handler's inbox and its marker. */
    moodle: join(dir, "moodle"),
    moodleInbox: join(dir, "moodle", "inbox"),
    moodleHandler: join(dir, "moodle", "handler.json"),
    logs: join(dir, "logs"),
    updates: join(dir, "updates"),
  };
};

/** ~/Documents/TutorAI, or ~/TutorAI when there is no Documents folder. */
export function defaultDataDir(home = homedir()) {
  const docs = join(home, "Documents");
  return existsSync(docs) ? join(docs, "TutorAI") : join(home, "TutorAI");
}

/** Where the installers put the binary (used by update and uninstall). */
export function installedBinary(home = homedir()) {
  return process.platform === "win32"
    ? join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), "TutorAI", "tutorai.exe")
    : join(home, ".local", "bin", "tutorai");
}

/** macOS: the temporary app that receives the Moodle sign-in link (docs/rfc-moodle.md §6.3). */
export function moodleHandlerApp(home = homedir()) {
  return join(home, "Applications", "TutorAI Moodle Sign-in.app");
}

/** Launcher locations created by the installers. */
export function launchers(home = homedir()): string[] {
  if (process.platform === "darwin") return ["/Applications/TutorAI.app", join(home, "Applications", "TutorAI.app")];
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    return [
      join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "TutorAI.lnk"),
      join(home, "Desktop", "TutorAI.lnk"),
    ];
  }
  return [join(home, ".local", "share", "applications", "tutorai.desktop")];
}
