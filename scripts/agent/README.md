# Agent helper scripts

Small scripts that make repeated or noisy agent workflows cheaper (one line per script: name — what it does). None may delete data, deploy, push, or touch secrets.

Prefer the npm scripts in the root `package.json` (`typecheck`, `test`, `eval`, `e2e`, `check`).
- `npm run screenshots` (scripts/readme-screenshots.mjs): regenerate README screenshots from a running `npm run preview` in demo mode.
- `scripts/agent/e2e-alt-port.sh` — run the E2E suite on port 4191 (or `PORT=…`) when 4173 is taken; filters build noise.
- `scripts/agent/local-check.sh` — TutorAI Local: server unit tests, binary build, E2E against the binary (quiet output; `PROJECTS=` to pick browsers).
