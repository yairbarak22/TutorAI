#!/usr/bin/env bash
# Run the Playwright E2E suite on its own port (default 4191), for when another
# session already holds 4173. Builds first. Extra args go to `playwright test`.
#
# The preview is served at http://[::1]:PORT, not http://localhost:PORT: on localhost or
# 127.0.0.1 the web app treats every port except 5173 and 4173 as TutorAI Local and shows
# "open TutorAI from its icon" (apps/web/src/platform/local-server.ts).
set -euo pipefail
cd "$(dirname "$0")/../.."
PORT="${PORT:-4191}"
URL="http://[::1]:$PORT"
CFG="playwright.alt-port.config.ts"
trap 'rm -f "$CFG"' EXIT
cat > "$CFG" <<CONF
import base from "./playwright.config.ts";
export default {
  ...base,
  use: { ...base.use, baseURL: "$URL" },
  webServer: { ...base.webServer, command: "npm run build && cd apps/web && npx vite preview --host ::1 --port $PORT --strictPort", url: "$URL", reuseExistingServer: false },
};
CONF
npx playwright test -c "$CFG" --reporter=line "$@" 2>&1 | grep -v '^\[WebServer\]'
