// Starts TutorAI Local for the E2E suite: a temp config + data folder, a fake `claude`, and a mock
// OpenAI (sign-in + Responses). Runs the built binary when TUTORAI_BIN is set (CI), otherwise the
// source. Writes e2e-local/.state.json so tests can get one-time open links.
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { startMockOpenAI } from "../apps/local/test/mock-openai.ts";
import { startMockMoodle, type MockCourse } from "../apps/local/test/mock-moodle.ts";

export const PORT = 4399;
const here = fileURLToPath(new URL(".", import.meta.url));

const root = mkdtempSync(join(tmpdir(), "tutorai-e2e-"));
const config = join(root, "config");
const data = join(root, "data");
const claudeState = join(root, "claude-state");
mkdirSync(config, { recursive: true });
mkdirSync(data, { recursive: true });
mkdirSync(claudeState, { recursive: true });
writeFileSync(join(config, "settings.json"), JSON.stringify({ dataDir: data }));
writeFileSync(join(claudeState, "scenario"), "ok");

// The fake CLI, signed out at first.
const fake = join(root, "bin", process.platform === "win32" ? "claude.cmd" : "claude");
mkdirSync(join(root, "bin"), { recursive: true });
const fakeScript = fileURLToPath(new URL("../apps/local/test/fake-claude.mjs", import.meta.url));
writeFileSync(fake, `#!/bin/sh\nexec "${process.execPath}" "${fakeScript}" "$@"\n`);
chmodSync(fake, 0o755);

const mock = await startMockOpenAI();

// A mock Moodle with real (tiny) course files, so imported files go through real ingestion.
const fixture = (name: string) => readFileSync(join(here, "..", "e2e", "fixtures", name));
const moodleCourses = (): MockCourse[] => [
  {
    id: 101,
    shortname: "GR-2027",
    fullname: "תורת הגרפים",
    sections: [
      {
        name: "שבוע 1",
        modules: [
          { id: 11, modname: "resource", name: "מצגת 1", files: [{ filename: "lecture-graphs.pdf", body: fixture("lecture-graphs.pdf"), modified: 1000 }] },
          { id: 12, modname: "folder", name: "סיכומים", files: [{ filename: "summary-variance.docx", filepath: "/week1/", body: fixture("summary-variance.docx"), modified: 1000 }, { filename: "data.zip", body: Buffer.from("PK\u0003\u0004zip"), modified: 1000 }] },
          { id: 13, modname: "lti", name: "הקלטות" },
        ],
      },
    ],
  },
  { id: 102, shortname: "CT-2027", fullname: "תורת הסיבוכיות", sections: [{ name: "כללי", modules: [{ id: 21, modname: "forum", name: "הודעות" }] }] },
];
const moodle = await startMockMoodle(0, moodleCourses);
const env = {
  ...process.env,
  TUTORAI_TEST: "1",
  TUTORAI_CONFIG_DIR: config,
  TUTORAI_OPENAI_AUTH_BASE: mock.base,
  TUTORAI_OPENAI_API_BASE: mock.api,
  // Windows supports only the native claude.exe; the fake is a shell script, so leave Claude "not installed" there.
  ...(process.platform === "win32" ? {} : { TUTORAI_CLAUDE_PATH: fake }),
  CLAUDE_CONFIG_DIR: claudeState,
  TUTORAI_LOG_STDERR: "1",
  // Moodle: the mock on 127.0.0.1, offered as an institution; no real URL handler in tests.
  TUTORAI_MOODLE: "on",
  TUTORAI_MOODLE_ALLOW_LOCAL: "1",
  TUTORAI_MOODLE_HANDLER: "off",
  TUTORAI_MOODLE_TEST_SITES: JSON.stringify([{ id: "mock", site: moodle.base, he: "מוסד בדיקה", en: "Test institution" }]),
};
writeFileSync(join(here, ".state.json"), JSON.stringify({ config, data, mock: mock.base, moodle: moodle.base, port: PORT }));

const bin = process.env.TUTORAI_BIN;
const child = bin
  ? spawn(bin, ["serve", "--port", String(PORT), "--strict-port"], { env, stdio: "inherit" })
  : spawn(process.execPath, ["--import", "tsx", join(here, "..", "apps", "local", "src", "main.ts"), "serve", "--port", String(PORT), "--strict-port"], { env, stdio: "inherit" });
const stop = () => {
  child.kill();
  void mock.close();
  void moodle.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => {
  void mock.close();
  void moodle.close();
  process.exit(code ?? 0);
});
