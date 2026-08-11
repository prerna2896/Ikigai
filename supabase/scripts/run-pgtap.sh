#!/usr/bin/env bash
# pgTAP RLS runner.
#
# Creates two throwaway auth users via the Supabase Admin API, passes
# their UUIDs into supabase/tests/rls_isolation.sql via psql variables,
# tears the users down after.
#
# Required env:
#   DATABASE_URL              — session-mode Supavisor URL (migrations
#                                 pooler). Session mode is required for
#                                 SET LOCAL ROLE to work.
#   NEXT_PUBLIC_SUPABASE_URL  — https://<ref>.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY — needed for the Admin API (auth.admin.*)
#
# Exits nonzero if any pgTAP assertion fails.

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL not set}"
: "${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL not set}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY not set}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUITE="$SCRIPT_DIR/../tests/rls_isolation.sql"

api="${NEXT_PUBLIC_SUPABASE_URL%/}/auth/v1/admin/users"
key="$SUPABASE_SERVICE_ROLE_KEY"

# Generate two unique throwaway emails to avoid collisions across runs.
run_id="$(date +%s)-$$"
emailA="pgtap-a-${run_id}@ikigai.test"
emailB="pgtap-b-${run_id}@ikigai.test"

create_user() {
  local email="$1"
  local resp
  resp="$(curl -sS -X POST "$api" \
    -H "apikey: $key" \
    -H "Authorization: Bearer $key" \
    -H "Content-Type: application/json" \
    -d "$(printf '{"email":"%s","password":"pgtap-throwaway-password","email_confirm":true}' "$email")")"
  # Extract id via node (avoids a jq dependency).
  node -e "process.stdout.write(JSON.parse(process.argv[1]).id ?? '')" -- "$resp" || {
    echo "Failed to create test user $email. Response: $resp" >&2
    exit 1
  }
}

delete_user() {
  local id="$1"
  [ -z "$id" ] && return 0
  curl -sS -o /dev/null -X DELETE "$api/$id" \
    -H "apikey: $key" \
    -H "Authorization: Bearer $key" || true
}

userA_id=""
userB_id=""

cleanup() {
  # Always delete throwaway users, even on early exit.
  delete_user "$userA_id"
  delete_user "$userB_id"
}
trap cleanup EXIT

echo "→ creating throwaway auth users…"
userA_id="$(create_user "$emailA")"
userB_id="$(create_user "$emailB")"
[ -n "$userA_id" ] && [ -n "$userB_id" ] || {
  echo "Failed to obtain both user IDs (A=$userA_id, B=$userB_id)" >&2
  exit 1
}
echo "  A=$userA_id"
echo "  B=$userB_id"

echo "→ running pgTAP suite…"
# psql -v wraps the value in single quotes when the SQL references :'var',
# so we pass raw UUID strings and let SQL cast to uuid where needed.
psql "$DATABASE_URL" \
  --set ON_ERROR_STOP=on \
  --no-psqlrc \
  --quiet \
  -v userA_id="$userA_id" \
  -v userB_id="$userB_id" \
  -f "$SUITE"

echo "✓ pgTAP suite passed"
