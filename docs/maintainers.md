# Maintainer guide

## Deployment (production)

- Every push to `main` runs `.github/workflows/deploy.yml`: tests, build, and deploy to **GitHub Pages**.
- URL: https://yairbarak22.github.io/RuecAI_Tutor/
- One-time setup: in Settings → Pages, under Source, choose **GitHub Actions**.
- Worth doing later: a custom domain (for example `ruecai.app`), so the site has an origin separate from other GitHub Pages sites of the same user.

## Checking a PR

There are no per-PR preview links: Cloudflare was dropped. Every PR goes through CI (typecheck, unit tests, recorded plugin evals, and Playwright E2E). To try a PR locally: `gh pr checkout <number> && npm i && npm run dev`.

**Security:** never deploy a PR build to the real site's origin, because a malicious PR could read API keys that students saved in their browser.

## Live evals (real model)

If a secret named `ANTHROPIC_API_KEY` is set, every push to `main` runs every tool's quality checks against Claude, using the cheap model (`claude-haiku-5-5`) for both tiers. You can switch the model with `RUECAI_EVAL_MODEL`. A run costs a few cents. PRs run only the recorded evals, at no cost.

## Review

- **New tool:** make sure it has passing `evals/`, a clear English prompt (`prompt.md`) and Hebrew translations in the manifest's `i18n.he` block, no external `fetch`, and that the tool doesn't solve assignments for the student.
- **Core/SDK:** only after an agreed RFC. A breaking SDK change bumps the version.
- **Security:** any change to `Visuals.tsx` (iframe/CSP), `Markdown.tsx` (sanitizing), `secrets.ts`, or the workflows requires review by a core maintainer.

## Releases

Deployment is continuous (every merge). Every so often, tag `vX.Y.Z` in git and write release notes.
