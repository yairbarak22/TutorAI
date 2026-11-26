# Agent helper scripts

Small scripts that make repeated or noisy agent workflows cheaper (one line per script: name — what it does). None may delete data, deploy, push, or touch secrets.

Prefer the npm scripts in the root `package.json` (`typecheck`, `test`, `eval`, `e2e`, `check`).
- `npm run screenshots` (scripts/readme-screenshots.mjs): regenerate README screenshots from a running `npm run preview` in demo mode.
