-- pgTAP: Row-Level Security isolation tests.
--
-- Runner: supabase/scripts/run-pgtap.sh — creates two throwaway auth
-- users via the Supabase Admin API, exports their UUIDs, then invokes:
--
--   psql "$DATABASE_URL" \
--     -v userA_id="'<uuid-a>'" \
--     -v userB_id="'<uuid-b>'" \
--     -f supabase/tests/rls_isolation.sql
--
-- Everything inside runs in a single transaction and ROLLBACKs at end.
-- Test rows never persist. Real auth.users rows do persist — the runner
-- deletes them via Admin API after psql exits.

\set ON_ERROR_STOP on

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

-- Test count breakdown:
--   Static coverage:   12 (policies) + 12 (RLS on) + 12 (FORCE RLS on) = 36
--   SELECT isolation:  2 (user A) + 3 (user B) = 5
--   INSERT ownership:  2
--   UPDATE ownership:  3 (row count, unchanged verify, WITH CHECK)
--   DELETE ownership:  2 (row count, still exists)
--   anon lockout:      2 (SELECT, INSERT)
--   Auth boundary:     1 (empty JWT)
--   Total:             51
SELECT plan(51);

-- ─── Static coverage: every user-scoped table has 4 policies ─────────────
SELECT is(
  (SELECT COUNT(*)::int
     FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = t),
  4,
  format('%s has SELECT/INSERT/UPDATE/DELETE policies', t)
)
FROM unnest(ARRAY[
  'profiles','profile_reflections','profile_goals','settings','domains',
  'week_plans','week_domains','week_tasks','week_goals','hours_logged',
  'week_notes','pending_mutations'
]) AS t;

-- ─── Static coverage: RLS + FORCE RLS enabled ────────────────────────────
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = t AND relnamespace = 'public'::regnamespace),
  true,
  format('%s has RLS enabled', t)
)
FROM unnest(ARRAY[
  'profiles','profile_reflections','profile_goals','settings','domains',
  'week_plans','week_domains','week_tasks','week_goals','hours_logged',
  'week_notes','pending_mutations'
]) AS t;

SELECT is(
  (SELECT relforcerowsecurity FROM pg_class WHERE relname = t AND relnamespace = 'public'::regnamespace),
  true,
  format('%s has FORCE RLS (owner is also subject to policies)', t)
)
FROM unnest(ARRAY[
  'profiles','profile_reflections','profile_goals','settings','domains',
  'week_plans','week_domains','week_tasks','week_goals','hours_logged',
  'week_notes','pending_mutations'
]) AS t;

-- ─── Seed: one WeekPlan for user A, one for user B (as superuser) ────────
-- We bypass RLS here by running as the migration user. In production the
-- app would insert these via authenticated role and policies would allow
-- them (each caller inserts their own user_id).

-- Constant IDs so we can assert on them explicitly.
\set planA_id  '''11111111-1111-1111-1111-111111111111'''
\set planB_id  '''22222222-2222-2222-2222-222222222222'''

INSERT INTO public.week_plans
  (id, user_id, week_start_iso, week_end_iso, week_start_day, week_time_zone)
VALUES
  (:planA_id, :'userA_id', '2026-01-05', '2026-01-11', 'monday', 'UTC'),
  (:planB_id, :'userB_id', '2026-01-05', '2026-01-11', 'monday', 'UTC');

-- ─── Behavioral: SELECT isolation ────────────────────────────────────────
-- Switch to authenticated role and stamp the JWT claim.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'userA_id', true);

SELECT is(
  (SELECT COUNT(*)::int FROM public.week_plans),
  1,
  'user A sees exactly one week_plans row (their own)'
);
SELECT is(
  (SELECT user_id FROM public.week_plans LIMIT 1),
  (:'userA_id')::uuid,
  'user A sees their own user_id'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'userB_id', true);

SELECT is(
  (SELECT COUNT(*)::int FROM public.week_plans),
  1,
  'user B sees exactly one week_plans row (their own)'
);
SELECT is(
  (SELECT user_id FROM public.week_plans LIMIT 1),
  (:'userB_id')::uuid,
  'user B sees their own user_id'
);
SELECT is(
  (SELECT COUNT(*)::int FROM public.week_plans WHERE id = :planA_id),
  0,
  'user B cannot see user A row even when querying by id'
);

-- ─── Behavioral: INSERT ownership ────────────────────────────────────────
-- user B tries to insert a row claiming to be user A. Must fail.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'userB_id', true);

SELECT throws_ok(
  format(
    'INSERT INTO public.week_plans (id, user_id, week_start_iso, week_end_iso, week_start_day, week_time_zone) VALUES (''33333333-3333-3333-3333-333333333333'', ''%s'', ''2026-01-12'', ''2026-01-18'', ''monday'', ''UTC'')',
    :'userA_id'
  ),
  '42501',
  NULL,
  'user B cannot INSERT a row with user_id = user A (WITH CHECK denies)'
);

-- user B insert with their own user_id succeeds
SELECT lives_ok(
  format(
    'INSERT INTO public.week_plans (id, user_id, week_start_iso, week_end_iso, week_start_day, week_time_zone) VALUES (''44444444-4444-4444-4444-444444444444'', ''%s'', ''2026-01-12'', ''2026-01-18'', ''monday'', ''UTC'')',
    :'userB_id'
  ),
  'user B can INSERT a row with their own user_id'
);

-- ─── Behavioral: UPDATE ownership ────────────────────────────────────────
-- user B tries to UPDATE user A's row. Must succeed as zero-rows-affected
-- (RLS silently filters — this is Postgres behavior, not an error).
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'userB_id', true);

-- Postgres requires data-modifying CTEs at top level, so we hoist the
-- WITH out of the is() argument and pass the count as a plain subquery.
WITH updated AS (
  UPDATE public.week_plans
     SET week_time_zone = 'America/Los_Angeles'
   WHERE id = :planA_id
   RETURNING 1
)
SELECT is(
  (SELECT COUNT(*)::int FROM updated),
  0,
  'user B UPDATE targeting user A row affects 0 rows (silent RLS filter)'
);

-- Verify user A's row is unchanged
RESET ROLE;
SELECT is(
  (SELECT week_time_zone FROM public.week_plans WHERE id = :planA_id),
  'UTC',
  'user A row is unchanged after user B attempted UPDATE'
);

-- user B tries to reassign a row they DO own to user A — WITH CHECK denies
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'userB_id', true);

SELECT throws_ok(
  format(
    'UPDATE public.week_plans SET user_id = ''%s'' WHERE id = ''44444444-4444-4444-4444-444444444444''',
    :'userA_id'
  ),
  '42501',
  NULL,
  'user B cannot UPDATE user_id on their own row to point at user A (WITH CHECK denies)'
);

-- ─── Behavioral: DELETE ownership ────────────────────────────────────────
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'userB_id', true);

WITH deleted AS (
  DELETE FROM public.week_plans
   WHERE id = :planA_id
   RETURNING 1
)
SELECT is(
  (SELECT COUNT(*)::int FROM deleted),
  0,
  'user B DELETE targeting user A row affects 0 rows (silent RLS filter)'
);

RESET ROLE;
SELECT is(
  (SELECT COUNT(*)::int FROM public.week_plans WHERE id = :planA_id),
  1,
  'user A row still exists after user B attempted DELETE'
);

-- ─── anon role: no access at all ─────────────────────────────────────────
-- With no claim + anon role, table-level GRANTs alone should block reads.
RESET ROLE;
SET LOCAL ROLE anon;

SELECT throws_ok(
  'SELECT COUNT(*) FROM public.week_plans',
  '42501',
  NULL,
  'anon cannot SELECT from week_plans (no GRANT, no policy)'
);

SELECT throws_ok(
  format(
    'INSERT INTO public.week_plans (id, user_id, week_start_iso, week_end_iso, week_start_day, week_time_zone) VALUES (''55555555-5555-5555-5555-555555555555'', ''%s'', ''2026-01-19'', ''2026-01-25'', ''monday'', ''UTC'')',
    :'userA_id'
  ),
  '42501',
  NULL,
  'anon cannot INSERT into week_plans'
);

-- ─── Auth boundary: expired / missing claim ──────────────────────────────
-- authenticated role WITHOUT a JWT claim (auth.uid() returns NULL) should
-- see zero rows: `auth.uid() = user_id` evaluates NULL, treated as false.
RESET ROLE;
SET LOCAL ROLE authenticated;
-- explicitly clear any claim
SELECT set_config('request.jwt.claim.sub', '', true);

SELECT is(
  (SELECT COUNT(*)::int FROM public.week_plans),
  0,
  'authenticated with no JWT claim sees 0 rows'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
