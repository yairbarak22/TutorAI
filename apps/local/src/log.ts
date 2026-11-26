import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./paths.ts";

const MAX_BYTES = 5 * 1024 * 1024;

/** Tokens and secrets never reach the log, whatever the caller passes. */
export function redact(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[jwt]")
    .replace(/("?(?:access_token|refresh_token|id_token|code_verifier|client_secret|code)"?\s*[:=]\s*"?)[^"&\s,}]+/gi, "$1[redacted]")
    .replace(/sk-ant-[\w-]+/g, "[key]")
    .replace(/sk-[\w-]{16,}/g, "[key]");
}

let file: string | null = null;

function target() {
  if (file) return file;
  const dir = paths().logs;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  file = join(dir, "tutorai.log");
  return file;
}

/** Writes one line: time, level, message. Never pass prompts, course text or request bodies. */
export function log(level: "info" | "warn" | "error", message: string) {
  const line = `${new Date().toISOString()} ${level} ${redact(message)}\n`;
  if (process.env.TUTORAI_LOG_STDERR === "1") process.stderr.write(line);
  try {
    const f = target();
    try {
      if (statSync(f).size > MAX_BYTES) renameSync(f, `${f}.1`);
    } catch {
      /* no file yet */
    }
    appendFileSync(f, line, { mode: 0o600 });
  } catch {
    /* logging must never break the server */
  }
}
