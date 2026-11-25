---
name: distill-tools
description: Audit recent session work and git history to turn repetitive or token-heavy workflows into lean scripts or Skills, and prune stale ones. Invoke via /distill-tools or when asked to save repeated actions as reusable tools.
---

# Distill Tools

Convert repetitive, deterministic, or noisy workflows into minimal-context reusable assets. **Act autonomously:** do not wait for approval. Only ask first when a change would delete or rewrite a tool the user wrote by hand.

## 1. Read-Only Audit
1. **Inventory existing assets:** Inspect `scripts/agent/` (and `scripts/agent/README.md`), `.claude/skills/`, and `package.json` (or Makefile) to avoid duplicates and spot broken/stale tools.
2. **Scan recent work:** Review the current session for repeated multi-step commands (3+ times), verbose outputs (tests, builds, linters, typechecks, migrations) that burned tokens, or fragile verification loops. Unless scoped to session-only, also run `git log -n 15 --stat`.
3. **Apply the ROI filter:** Keep a candidate ONLY if it meets at least one criterion:
   - Deterministic sequence repeated 3+ times (or weekly).
   - Wraps noisy output into a 1-line `OK` on pass and **errors-only** (no ANSI noise) on fail.
   - Prevents a multi-step mistake that burns debugging tokens.
   - Skip one-offs, trivial 1-line aliases, and MCP servers where a local script suffices.
4. **Pick the leanest format:**
   - `scripts/agent/<name>.sh` (or `.mjs`) for deterministic execution and output filtering.
   - `.claude/skills/<name>/SKILL.md` only when judgment, domain rules, or multi-step orchestration is needed.
   - `Prune` for obsolete or duplicated tools.

## 2. Select
Take **at most 3 items** ranked by token ROI. For each, settle internally:
- **Trigger:** When to use it.
- **Contract:** Inputs and exact compact stdout/stderr behavior.

## 3. Implement (no approval needed)
- **Scripts (`scripts/agent/`):** Use `set -euo pipefail` (for bash), `chmod +x`, 1-line success output, filtered errors only on non-zero exit. Add a **single-line entry** to `scripts/agent/README.md`.
- **Skills (`.claude/skills/<name>/SKILL.md`):** Keep YAML `description` to max 2 sharp trigger sentences; delegate shell work to `scripts/agent/`.
- **Verify:** Smoke-test each created script once for clean exit codes and compact output, then report the result in 3 lines or fewer, as a compact table:

| Action | Path | Token Saving |
|---|---|---|
| Created / Pruned | `path/to/file` | 1-sentence reason |
