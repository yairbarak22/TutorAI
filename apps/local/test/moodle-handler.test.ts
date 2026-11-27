import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DataFolder } from "../src/fs/folder.ts";
import { serve, type Running } from "../src/lifecycle.ts";
import { createHandler } from "../src/moodle/handler/index.ts";
import { currentHandler } from "../src/moodle/handler/macos.ts";
import { createMoodle, type MoodleService } from "../src/moodle/index.ts";
import { paths } from "../src/paths.ts";
import { tempEnv } from "./helpers.ts";
import { startMockMoodle, type MockMoodle } from "./mock-moodle.ts";

/**
 * The real macOS sign-in handler: registers an app for moodlemobile:// links, opens one through
 * the system, and removes the app. It changes this computer for a few seconds, so it runs only
 * with TUTORAI_HANDLER_TESTS=1 (CI), never from a plain `npm test`.
 */
const enabled = process.env.TUTORAI_HANDLER_TESTS === "1" && process.platform === "darwin";
const APP = join(homedir(), "Applications", "TutorAI Moodle Sign-in (test).app");
const repo = fileURLToPath(new URL("../../..", import.meta.url));
const main = fileURLToPath(new URL("../src/main.ts", import.meta.url));

describe.skipIf(!enabled)("macOS sign-in handler", () => {
  let env: ReturnType<typeof tempEnv>;
  let mock: MockMoodle;
  let moodle: MoodleService;
  let running: Running;

  beforeEach(async () => {
    env = tempEnv();
    mock = await startMockMoodle();
    process.env.TUTORAI_TEST = "1";
    process.env.TUTORAI_MOODLE_ALLOW_LOCAL = "1";
    process.env.TUTORAI_MOODLE_HANDLER = "on";
    process.env.TUTORAI_MOODLE_TEST_SITES = JSON.stringify([{ id: "mock", site: mock.base }]);
    // Under the test runner the server's own command is the runner, so the handler gets a real one.
    const handler = createHandler({ command: [process.execPath, "--import", "tsx", main], cwd: repo, app: APP });
    moodle = createMoodle({ version: "test", handlerCommand: [], handler, folder: async () => new DataFolder(env.data) });
    running = await serve({ port: 5300 + Math.floor(Math.random() * 300), moodle, services: { settings: async () => ({}) as never, claudeCode: {} as never, chatgpt: {} as never } });
  });
  afterEach(async () => {
    await running.close();
    await mock.close();
    process.env.TUTORAI_MOODLE_HANDLER = "off";
    delete process.env.TUTORAI_MOODLE_TEST_SITES;
    delete process.env.TUTORAI_MOODLE_ALLOW_LOCAL;
  });

  const begin = async () => {
    const { candidates } = await moodle.resolve("mock");
    const start = await moodle.start(candidates[0].site);
    return { start, passport: new URL(start.launchUrl).searchParams.get("passport")! };
  };
  const open = (link: string) => new Promise<void>((resolve, reject) => execFile("/usr/bin/open", [link], (e) => (e ? reject(e) : resolve())));

  it("receives a link from the system, connects, and removes itself", async () => {
    if (await currentHandler()) return; // another program owns the scheme on this computer: nothing to test
    const { start, passport } = await begin();
    expect(start.mode).toBe("auto");
    expect(await currentHandler()).toBe(APP);
    expect(existsSync(paths().moodleHandler)).toBe(true);

    // A link without the passport reaches the server and changes nothing.
    await open(mock.launchLink("not-the-passport"));
    await new Promise((r) => setTimeout(r, 2500));
    expect((await moodle.status()).pending?.state).toBe("waiting");

    await open(mock.launchLink(passport));
    await expect.poll(async () => (await moodle.status()).connections.length, { timeout: 20_000, interval: 300 }).toBe(1);
    expect(await currentHandler()).toBeNull();
    expect(existsSync(APP)).toBe(false);
    expect(existsSync(paths().moodleHandler)).toBe(false);
  }, 60_000);

  it("is removed when the sign-in is cancelled and when the server stops", async () => {
    if (await currentHandler()) return;
    const first = await begin();
    expect(await currentHandler()).toBe(APP);
    await moodle.cancel(first.start.pendingId);
    expect(await currentHandler()).toBeNull();

    await begin();
    expect(await currentHandler()).toBe(APP);
    await running.close(); // beforeExit
    expect(await currentHandler()).toBeNull();
    expect(existsSync(APP)).toBe(false);
    running = await serve({ port: 5300 + Math.floor(Math.random() * 300), moodle, services: { settings: async () => ({}) as never, claudeCode: {} as never, chatgpt: {} as never } });
  }, 60_000);
});
