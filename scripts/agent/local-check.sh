#!/bin/sh
# TutorAI Local in one go: server unit tests → single binary build → E2E against the binary
# (Chromium; PROJECTS="--project=webkit" etc. to change). Prints only results.
set -eu
cd "$(dirname "$0")/../.."
lsof -nP -iTCP:4399 -sTCP:LISTEN >/dev/null 2>&1 && { echo "port 4399 is busy (a TutorAI server is running?)"; exit 1; }
echo "== unit tests (apps/local)"
npx vitest run apps/local 2>&1 | grep -E "Test Files|Tests |FAIL|×" || true
echo "== build"
node apps/local/scripts/build.mjs 2>&1 | grep -E "^Built|Error" || true
BIN="$(ls apps/local/out/tutorai-* | grep -v '\.new$' | head -1)"
echo "== e2e against $BIN"
TUTORAI_BIN="$PWD/$BIN" npx playwright test -c playwright.local.config.ts ${PROJECTS:---project=chromium} 2>&1 | grep -E "✓|✘|passed|failed|flaky" || true
