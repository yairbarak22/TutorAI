import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LLMEvent, LLMRequest } from "@tutorai/local-api";
import { claudeEnv } from "../src/providers/claude-code/env.ts";
import { classifyError, runClaude } from "../src/providers/claude-code/run.ts";
import { createClaudeCode } from "../src/providers/claude-code/index.ts";
import { candidatePaths, findClaude, version, versionAtLeast } from "../src/providers/claude-code/find.ts";
import { fakeClaude, tempEnv } from "./helpers.ts";

const req: LLMRequest = { provider: "claude-code", tier: "fast", system: "שורה ראשונה\nשורה שנייה", context: "חומר", prompt: "מה זה?" };

async function run(scenario: string, extra: Partial<LLMRequest> = {}, opts: { timeoutMs?: number; abortAfterMs?: number } = {}) {
  const { root } = tempEnv();
  const fake = fakeClaude(root, scenario);
  const events: LLMEvent[] = [];
  const ctrl = new AbortController();
  if (opts.abortAfterMs) setTimeout(() => ctrl.abort(), opts.abortAfterMs);
  await runClaude({ ...req, ...extra }, (e) => events.push(e), { claudePath: fake.path, model: "claude-haiku-5-5", signal: ctrl.signal, timeoutMs: opts.timeoutMs, env: fake.env });
  const recordFile = join(fake.state, "record.json");
  const record = existsSync(recordFile) ? JSON.parse(readFileSync(recordFile, "utf8")) : null;
  return { events, record, fake };
}

describe.skipIf(process.platform === "win32")("Claude Code provider (fake CLI)", () => {
  it("streams deltas, then one result with usage", async () => {
    const { events } = await run("ok");
    expect(events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("")).toBe("שלום עולם");
    const result = events.at(-1)!;
    expect(result).toMatchObject({ type: "result", text: "שלום עולם", model: "plan:claude-haiku-5-5", usage: { input: 12, output: 3, cacheRead: 5 } });
  });

  it("passes only documented flags, the system prompt, and the schema", async () => {
    const { record } = await run("ok-json", { jsonSchema: { type: "object" } });
    const a: string[] = record.args;
    expect(a).toContain("-p");
    // --flag=value, so a value can never be read as another flag.
    expect(a).toContain("--system-prompt=שורה ראשונה\nשורה שנייה");
    expect(a).toContain("--model=claude-haiku-5-5");
    expect(a[a.indexOf("--tools") + 1]).toBe("");
    expect(a).toContain("--no-session-persistence");
    expect(a).toContain('--json-schema={"type":"object"}');
    expect(a).not.toContain("--max-turns");
    expect(a).not.toContain("--system-prompt-file");
    const input = JSON.parse(record.stdin.trim());
    expect(input.message.content[0].text).toContain("<course_material>");
    expect(input.message.content.at(-1).text).toBe("מה זה?");
  });

  it("returns structured output as json", async () => {
    const { events } = await run("ok-json", { jsonSchema: { type: "object" } });
    expect(events.at(-1)).toMatchObject({ type: "result", json: { answer: 42 } });
  });

  it("never passes API keys or other secrets to the CLI, and runs in an empty temp folder that is removed", async () => {
    const { record } = await run("ok");
    expect(record.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(record.env.SECRET_TOKEN).toBeUndefined();
    expect(record.env.DISABLE_AUTOUPDATER).toBe("1");
    expect(record.cwd).toMatch(/tutorai-claude-/);
    expect(existsSync(record.cwd)).toBe(false);
  });

  it("maps a usage limit to rate_limit with the reset time", async () => {
    const { events } = await run("usage-limit");
    expect(events.at(-1)).toMatchObject({ type: "error", kind: "rate_limit", resetAt: new Date(1900000000 * 1000).toISOString() });
  });

  it("maps not-logged-in to auth, crashes to an error with the stderr line", async () => {
    expect((await run("not-logged-in")).events.at(-1)).toMatchObject({ type: "error", kind: "auth" });
    expect((await run("crash")).events.at(-1)).toMatchObject({ type: "error", message: "fatal: something broke" });
    expect((await run("is-error")).events.at(-1)).toMatchObject({ type: "error", kind: "other" });
  });

  it("kills a hanging CLI on timeout and on abort", async () => {
    const t = await run("hang", {}, { timeoutMs: 500 });
    expect(t.events.at(-1)).toMatchObject({ type: "error", kind: "network" });
    const a = await run("hang", {}, { abortAfterMs: 300 });
    expect(a.events.filter((e) => e.type !== "delta")).toHaveLength(0); // aborted: nobody to tell
  }, 15_000);

  it("reports not_installed when the binary is missing", async () => {
    const events: LLMEvent[] = [];
    await runClaude(req, (e) => events.push(e), { claudePath: "/nonexistent/claude", model: "m", signal: new AbortController().signal });
    expect(events.at(-1)).toMatchObject({ type: "error", kind: "not_installed" });
  });

  it("status, login and logout use the CLI's own commands", async () => {
    const { root } = tempEnv();
    const fake = fakeClaude(root, "ok", false);
    const svc = createClaudeCode({ find: async () => ({ found: { path: fake.path, version: "2.1.332" }, cmdOnly: false }), env: fake.env });
    expect(await svc.status(true)).toMatchObject({ installed: true, versionOk: true, loggedIn: false });
    const r = await svc.login();
    expect(r).toEqual({ started: true, manualCommand: "claude auth login" });
    await new Promise((res) => setTimeout(res, 700));
    expect(await svc.status(true)).toMatchObject({ loggedIn: true });
    await svc.logout();
    expect(await svc.status(true)).toMatchObject({ loggedIn: false });
  });

  it("install runs the injected installer and streams its lines", async () => {
    const { root } = tempEnv();
    const fake = fakeClaude(root);
    const svc = createClaudeCode({
      find: async () => ({ found: { path: fake.path, version: "2.1.332" }, cmdOnly: false }),
      install: { file: "/bin/sh", args: ["-c", "echo installing; echo '\u001b[32mdone\u001b[0m'"] },
    });
    const lines: string[] = [];
    let done: unknown;
    await svc.install((e) => (e.type === "log" ? lines.push(e.line) : (done = e)), new AbortController().signal);
    expect(lines).toEqual(["installing", "done"]);
    expect(done).toEqual({ type: "done", ok: true });
  });
});

describe("Claude Code helpers", () => {
  it("builds the env from an allowlist", () => {
    const env = claudeEnv("/x/bin/claude", { PATH: "/usr/bin", HOME: "/h", ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: "u", LC_ALL: "he_IL", OPENAI_API_KEY: "o" });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.LC_ALL).toBe("he_IL");
    expect(env.PATH.startsWith("/x/bin")).toBe(true);
  });

  it("compares versions", () => {
    expect(versionAtLeast("2.1.332")).toBe(true);
    expect(versionAtLeast("2.1.279")).toBe(false);
    expect(versionAtLeast("3.0.0")).toBe(true);
    expect(versionAtLeast(null)).toBe(false);
  });

  it("classifies errors", () => {
    expect(classifyError("You've hit your limit · resets 5pm").kind).toBe("rate_limit");
    expect(classifyError("Invalid API key · Please run /login").kind).toBe("auth");
    // The CLI's sign-in ran out: the student is told to sign in again, not shown the raw text.
    expect(classifyError("Failed to authenticate: OAuth session expired and could not be refreshed").kind).toBe("auth");
    expect(classifyError("weird").kind).toBe("other");
  });

  it("never throws when a command can't be started (Windows .cmd) and ignores a .cmd override", async () => {
    const r = await findClaude({ env: { PATH: "", TUTORAI_CLAUDE_PATH: "C:\\x\\claude.cmd" }, loginShell: false, home: "/nonexistent-home" });
    expect(r.found).toBeNull();
    expect(await version("/definitely/not/here")).toBeNull();
  });

  it("looks in the native installer's folder first", () => {
    if (process.platform === "win32") return;
    expect(candidatePaths("/home/u")[0]).toBe("/home/u/.local/bin/claude");
  });
});
