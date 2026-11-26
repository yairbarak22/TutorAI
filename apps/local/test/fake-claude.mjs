#!/usr/bin/env node
// A stand-in for the official `claude` CLI in tests. It only sees the allowlisted environment
// TutorAI passes, so its state lives in CLAUDE_CONFIG_DIR (which the allowlist keeps):
//   scenario     which -p behavior to play
//   logged-in    present = signed in
//   record.json  the last -p call's args, env and stdin (for assertions)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.CLAUDE_CONFIG_DIR;
const args = process.argv.slice(2);
const scenario = dir && existsSync(join(dir, "scenario")) ? readFileSync(join(dir, "scenario"), "utf8").trim() : "ok";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");

if (args[0] === "--version") {
  console.log("2.1.332 (Claude Code)");
  process.exit(0);
}
if (args[0] === "auth") {
  if (args[1] === "status") {
    out({ loggedIn: existsSync(join(dir, "logged-in")), authMethod: existsSync(join(dir, "logged-in")) ? "claude.ai" : "none", apiProvider: "firstParty" });
    process.exit(0);
  }
  if (args[1] === "login") {
    writeFileSync(join(dir, "logged-in"), "1");
    process.exit(0);
  }
  if (args[1] === "logout") {
    try {
      writeFileSync(join(dir, "logged-in"), "");
      (await import("node:fs")).rmSync(join(dir, "logged-in"));
    } catch {}
    process.exit(0);
  }
}

if (args.includes("-p")) {
  let stdin = "";
  for await (const chunk of process.stdin) stdin += chunk;
  writeFileSync(join(dir, "record.json"), JSON.stringify({ args, env: process.env, stdin, cwd: process.cwd() }));
  const model = args[args.indexOf("--model") + 1];
  const delta = (text) => out({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } });
  const result = (extra) => out({ type: "result", subtype: "success", is_error: false, result: "שלום עולם", usage: { input_tokens: 12, output_tokens: 3, cache_read_input_tokens: 5 }, ...extra });
  out({ type: "system", subtype: "init", model });
  switch (scenario) {
    case "ok":
      delta("שלום ");
      delta("עולם");
      result();
      break;
    case "ok-json":
      result({ result: "", structured_output: { answer: 42 } });
      break;
    case "is-error":
      out({ type: "result", subtype: "success", is_error: true, result: "Something went wrong" });
      break;
    case "usage-limit":
      out({ type: "result", subtype: "success", is_error: true, result: "Claude AI usage limit reached|1900000000" });
      break;
    case "not-logged-in":
      out({ type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login" });
      break;
    case "crash":
      process.stderr.write("fatal: something broke\n");
      process.exit(3);
      break;
    case "hang":
      delta("…");
      setInterval(() => {}, 1000); // never ends (an unsettled top-level await would exit)
      await new Promise(() => {});
      break;
  }
  if (scenario !== "hang") process.exit(0);
}
if (!args.includes("-p")) {
  console.error("unknown command", args.join(" "));
  process.exit(2);
}
