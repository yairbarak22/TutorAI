# Maintainer guide

## Deployment (production)

- Every push to `main` runs `.github/workflows/deploy.yml`: tests, build, and deploy to **GitHub Pages**.
- URL: https://yairbarak22.github.io/TutorAI/
- One-time setup: in Settings → Pages, under Source, choose **GitHub Actions**.
- Worth doing later: a custom domain (for example `tutorai.app`), so the site has an origin separate from other GitHub Pages sites of the same user.

## Releasing TutorAI Local

TutorAI Local (`apps/local`) ships as GitHub Release binaries that `install.sh` / `install.ps1` and the self-updater download.

1. **One-time setup:** create the release signing key with `node apps/local/scripts/release-key.mjs <file>`. Add the file's content as the GitHub secret `TUTORAI_RELEASE_SIGNING_KEY`, keep a backup somewhere safe, and paste the printed public key into `RELEASE_PUBLIC_KEY` in `apps/local/src/update/signing.ts`. Without the key, the release workflow refuses to publish and installed copies don't update themselves.
2. **Release:** bump `version` in `apps/local/package.json`, then push a tag such as `v0.2.0`. `.github/workflows/local.yml` builds and tests on macOS (arm64, x64), Linux (x64, arm64) and Windows (x64), then publishes the binaries, icons, `SHA256SUMS` and `SHA256SUMS.sig`.
3. **Check:** run the install line on a clean machine. Installed copies pick up the update within a day.

## Checking a PR

Every PR goes through CI (typecheck, unit tests, recorded plugin evals, and Playwright E2E). To try a PR locally: `gh pr checkout <number> && npm i && npm run dev`.

**Security:** never deploy a PR build to the real site's origin, because a malicious PR could read API keys that students saved in their browser.

## Live evals (real model)

If a secret named `ANTHROPIC_API_KEY` is set, every push to `main` runs every tool's quality checks against Claude, using the cheap model (`claude-haiku-5-5`) for both tiers. You can switch the model with `TUTORAI_EVAL_MODEL`. A run costs a few cents. PRs run only the recorded evals, at no cost.

## Review

- **New tool:** make sure it has passing `evals/`, a clear English prompt (`prompt.md`) and Hebrew translations in the manifest's `i18n.he` block, no external `fetch`, and that the tool doesn't solve assignments for the student.
- **Core/SDK:** only after an agreed RFC. A breaking SDK change bumps the version.
- **Security:** any change to `Visuals.tsx` (iframe/CSP), `Markdown.tsx` (sanitizing), `secrets.ts`, the model clients (`packages/core/src/llm/`), `sympy.ts` / `sympy.worker.ts` (expression whitelist), the workflows, or TutorAI Local's security-sensitive files (listed in `.github/CODEOWNERS`: localhost security, file access, tokens, the Claude Code environment, updates, installers) requires review by a core maintainer.
- **Pedagogy:** a tool must guide, not solve graded work. Prefer hints and questions over full answers, and keep the shared system prompt (`packages/core/src/llm/prompts.ts`) as the single place for these rules.

## Pack owners

When a faculty joins, add its owner to `.github/CODEOWNERS` (for example `/plugins/law/ @owner`). Pack owners review new tools in their field for accuracy and level; core maintainers still review anything outside `plugins/`.

## Releases

Deployment is continuous (every merge). Every so often, tag `vX.Y.Z` in git and write release notes.

## README screenshots

After a visible UI change, regenerate them in demo mode: `npm run build && npm run preview`, then `npm run screenshots` in another terminal. The images go to `docs/screenshots/`.
