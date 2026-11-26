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

/** Launcher locations created by the installers. */
export function launchers(home = homedir()): string[] {
  if (process.platform === "darwin") return [join(home, "Applications", "TutorAI.app")];
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    return [
      join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "TutorAI.lnk"),
      join(home, "Desktop", "TutorAI.lnk"),
    ];
  }
  return [join(home, ".local", "share", "applications", "tutorai.desktop")];
}
