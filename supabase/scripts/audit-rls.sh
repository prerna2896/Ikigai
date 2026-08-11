#!/usr/bin/env bash
# Static RLS audit runner.
#
# Expects DATABASE_URL in the environment. Exits nonzero on any RLS gap.
# CI wires this in on any PR that touches packages/db/src/schema.ts or
# supabase/migrations/.

set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL not set" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# psql exits nonzero if the DO block RAISE EXCEPTIONs.
psql "$DATABASE_URL" \
  --set ON_ERROR_STOP=on \
  --quiet \
  --no-psqlrc \
  --file "$SCRIPT_DIR/audit-rls.sql"

echo "✓ RLS audit passed"
