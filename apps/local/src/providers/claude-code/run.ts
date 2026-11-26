import { spawn, execFile, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PLAN_MODEL_PREFIX, type ErrorKind, type LLMEvent, type LLMRequest } from "@tutorai/local-api";
import { claudeEnv } from "./env.ts";

export const CALL_TIMEOUT_MS = 10 * 60 * 1000;

/** Running CLI processes, so quitting TutorAI never leaves one behind. */
export const activeChildren = new Set<ChildProcess>();
export function killAllChildren() {
  for (const c of activeChildren) killTree(c);
}
const KILL_GRACE_MS = 3000;
const STDERR_TAIL = 2000;

/** The official CLI's print mode, with only documented flags (verified against claude --help 2.1.332). */
export function buildArgs(req: LLMRequest, model: string): string[] {
  const args = [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    `--model=${model}`,
    `--system-prompt=${req.system?.trim() || "You are a helpful study assistant."}`,
    "--tools", "",
    "--strict-mcp-config",
    "--setting-sources", "",
    "--permission-mode", "dontAsk",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--effort", req.tier === "fast" ? "low" : "medium",
  ];
  if (req.jsonSchema) args.push(`--json-schema=${JSON.stringify(req.jsonSchema)}`);
  return args;
}

/** One user message (stream-json input): course material as data, earlier turns, images, then the prompt. */
export function buildInput(req: LLMRequest): string {
  const content: unknown[] = [];
  if (req.context) content.push({ type: "text", text: `<course_material>\n${req.context}\n</course_material>` });
  if (req.history?.length) {
    const turns = req.history.map((h) => `<${h.role}>\n${h.content}\n</${h.role}>`).join("\n");
    content.push({ type: "text", text: `Earlier in this conversation:\n${turns}` });
  }
  for (const img of req.images ?? []) content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } });
  content.push({ type: "text", text: req.prompt });
  return JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n";
}

/* ---------------- output parsing ---------------- */

export interface ParseState {
  text: string;
  result: LLMEvent | null;
}

/** Classifies a failed run from its result text and stderr. */
export function classifyError(text: string): { kind: ErrorKind; resetAt?: string } {
  const t = text.toLowerCase();
  if (/usage limit|rate limit|hit your limit|limit reached|resets? (at|in)|too many requests|\b429\b/.test(t)) {
    // Older CLIs: "Claude AI usage limit reached|<unix seconds>".
    const epoch = text.match(/limit reached\|(\d{9,})/i)?.[1];
    return { kind: "rate_limit", resetAt: epoch ? new Date(Number(epoch) * 1000).toISOString() : undefined };
  }
  if (/not logged in|please run \/login|claude auth login|invalid api key|oauth token|authentication|unauthorized|\b401\b/.test(t)) return { kind: "auth" };
  if (/overloaded|network|econn|enotfound|etimedout|connection/.test(t)) return { kind: "network" };
  return { kind: "other" };
}

/** Handles one stdout line. Returns a delta to emit, if any. */
export function parseLine(line: string, state: ParseState, model: string): string | null {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(line);
  } catch {
    return null;
  }
  if (msg.type === "stream_event") {
    const ev = msg.event as { type?: string; delta?: { type?: string; text?: string; partial_json?: string } } | undefined;
    if (ev?.type === "content_block_delta") {
      const d = ev.delta?.type === "text_delta" ? ev.delta.text : ev.delta?.type === "input_json_delta" ? ev.delta.partial_json : undefined;
      if (d) {
        state.text += d;
        return d;
      }
    }
    return null;
  }
  if (msg.type === "result") {
    const usage = (msg.usage ?? {}) as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
    const resultText = typeof msg.result === "string" ? msg.result : state.text;
    if (msg.is_error || (typeof msg.subtype === "string" && msg.subtype !== "success")) {
      const c = classifyError(`${resultText} ${String(msg.subtype ?? "")}`);
      state.result = { type: "error", kind: c.kind, message: resultText || String(msg.subtype), ...(c.resetAt ? { resetAt: c.resetAt } : {}) };
    } else {
      state.result = {
        type: "result",
        text: resultText,
        ...(msg.structured_output !== undefined ? { json: msg.structured_output } : {}),
        model: PLAN_MODEL_PREFIX + model,
        usage: { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0, cacheRead: usage.cache_read_input_tokens ?? 0 },
      };
    }
  }
  return null;
}

/* ---------------- process ---------------- */

function killTree(child: ChildProcess) {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
    return;
  }
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, KILL_GRACE_MS).unref();
}

export interface RunOptions {
  claudePath: string;
  model: string;
  signal: AbortSignal;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

/** Runs one call through `claude -p` in an empty private folder; emits deltas and one result/error. */
export async function runClaude(req: LLMRequest, emit: (e: LLMEvent) => void, opts: RunOptions): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "tutorai-claude-"));
  let child: ChildProcess | null = null;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (child) killTree(child);
  }, opts.timeoutMs ?? CALL_TIMEOUT_MS);
  const onAbort = () => child && killTree(child);
  opts.signal.addEventListener("abort", onAbort, { once: true });
  try {
    try {
      child = spawn(opts.claudePath, buildArgs(req, opts.model), {
      cwd,
      env: claudeEnv(opts.claudePath, opts.env),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
        shell: false,
      });
    } catch (e) {
      emit({ type: "error", kind: "not_installed", message: `Claude Code couldn't be started (${(e as Error).message}).` });
      return;
    }
    activeChildren.add(child);
    child.once("close", () => activeChildren.delete(child!));
    const state: ParseState = { text: "", result: null };
    let stderr = "";
    child.stderr!.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString("utf8")).slice(-STDERR_TAIL);
    });
    const spawnError = new Promise<Error>((resolve) => child!.once("error", resolve));
    const exited = new Promise<number | null>((resolve) => child!.once("close", (code) => resolve(code)));
    child.stdin!.on("error", () => {}); // EPIPE if the CLI exits early
    child.stdin!.end(buildInput(req));

    const lines = createInterface({ input: child.stdout! });
    const reading = (async () => {
      for await (const line of lines) {
        const d = parseLine(line, state, opts.model);
        if (d) emit({ type: "delta", text: d });
      }
    })();
    const first = await Promise.race([exited.then(() => null), spawnError]);
    if (first instanceof Error) {
      const code = (first as NodeJS.ErrnoException).code;
      emit(code === "ENOENT" ? { type: "error", kind: "not_installed", message: "Claude Code is not installed." } : { type: "error", kind: "other", message: first.message });
      return;
    }
    await reading;
    const code = await exited;
    if (opts.signal.aborted) return;
    if (state.result) {
      emit(state.result);
      return;
    }
    if (timedOut) {
      emit({ type: "error", kind: "network", message: "Claude Code took too long to answer." });
      return;
    }
    const c = classifyError(`${stderr} ${state.text}`);
    emit({
      type: "error",
      kind: c.kind,
      message: stderr.trim().split("\n").pop() || `Claude Code exited with code ${code}`,
      ...(c.resetAt ? { resetAt: c.resetAt } : {}),
    });
  } finally {
    clearTimeout(timer);
    opts.signal.removeEventListener("abort", onAbort);
    if (child) killTree(child);
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}
