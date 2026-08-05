#!/usr/bin/env bash
#
# Phase 2 acceptance criterion 1: "/__design shows the full library, dev-only."
# TEST checklist: "/__design returns 404 with NODE_ENV=production."
#
# The Playwright suite runs against `pnpm dev` so it can audit the gallery at all, which
# means it structurally cannot verify the production guard. This script does — against a
# real production server, on its own port so it never collides with a running dev server.
#
#   ./scripts/verify-production-guard.sh
set -euo pipefail

PORT="${PORT:-3100}"
BASE="http://127.0.0.1:${PORT}"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "→ building production bundle"
pnpm build >/dev/null

echo "→ starting production server on :${PORT}"
NODE_ENV=production pnpm start --port "$PORT" >/tmp/prod-guard.log 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "${BASE}/api/health" 2>/dev/null; then break; fi
  sleep 1
done

fail=0

check() {
  local path="$1" expected="$2" label="$3"
  local actual
  # -L follows redirects so we assert the status a *user* ends on. Next normalises a
  # trailing slash with a 308, and "308 to a 404" is still unreachable — the property
  # under test is reachability, not the absence of a redirect hop.
  actual=$(curl -sL -o /dev/null -w '%{http_code}' "${BASE}${path}")
  if [[ "$actual" == "$expected" ]]; then
    printf '  PASS  %-38s %s\n' "$label" "$actual"
  else
    printf '  FAIL  %-38s expected %s, got %s\n' "$label" "$expected" "$actual"
    fail=1
  fi
}

echo "→ asserting production behaviour"
check /__design            404 "/__design is unreachable in prod"
check /__design/           404 "/__design/ (trailing slash)"
check /                    200 "/ still renders"
check /api/health          200 "/api/health still responds"

if [[ "$fail" -ne 0 ]]; then
  echo
  echo "Production guard FAILED — the dev-only gallery is reachable in production."
  exit 1
fi

echo
echo "Production guard passed."
