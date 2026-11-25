# Agent Tooling & Token Hygiene

- **Reuse first:** Before running multi-step bash flows or noisy checks (build, test, lint, typecheck), check `scripts/agent/README.md` and prefer existing wrappers over raw commands.
- **Build tools autonomously:** Proactively create, improve, or fix scripts in `scripts/agent/` mid-task, without asking, whenever a sequence repeats, output is noisy, or a helper would speed up the work. Add a one-line entry to `scripts/agent/README.md`, smoke-test it, and keep going.
- **Distill at the end:** When a task ends, if a sequence repeated 3+ times or produced noisy output, run the `distill-tools` skill yourself without waiting for approval. Mention what you created in one line.
- **Guardrails:** Never put destructive actions (deleting data, deploying, pushing, touching secrets) inside an auto-created script.
- **Keep context lean:** Never inline script implementations or verbose tool catalogs into `CLAUDE.md` or `.claude/rules/`.
