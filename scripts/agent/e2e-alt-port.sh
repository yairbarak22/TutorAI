#!/usr/bin/env bash
# Run the Playwright E2E suite on its own port (default 4191), for when another
# session already holds 4173. Builds first. Extra args go to `playwright test`.
set -euo pipefail
cd "$(dirname "$0")/../.."
PORT="${PORT:-4191}"
CFG="playwright.alt-port.config.ts"
trap 'rm -f "$CFG"' EXIT
cat > "$CFG" <<CONF
import base from "./playwright.config.ts";
export default {
  ...base,
  use: { ...base.use, baseURL: "http://localhost:$PORT" },
  webServer: { ...base.webServer, command: "npm run build && cd apps/web && npx vite preview --port $PORT --strictPort", url: "http://localhost:$PORT", reuseExistingServer: false },
};
CONF
npx playwright test -c "$CFG" --reporter=line "$@" 2>&1 | grep -v '^\[WebServer\]'
