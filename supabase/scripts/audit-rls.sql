-- Static RLS audit.
--
-- Purpose: fail hard if any user-scoped table is missing a policy for any
-- of the four DML operations, or has RLS disabled, or is missing FORCE RLS.
--
-- Runner: supabase/scripts/audit-rls.sh — calls this file via psql and
-- exits nonzero on the RAISE below. Wired into CI as a required check.
--
-- Source of truth for "user-scoped tables" is USER_SCOPED_TABLES in
-- packages/db/src/schema.ts. The audit script includes a keep-in-sync
-- guard: adding a public.* table with a user_id column that is NOT in
-- this list also fails the audit.

\set ON_ERROR_STOP on

DO $$
DECLARE
  expected_tables text[] := ARRAY[
    'profiles',
    'profile_reflections',
    'profile_goals',
    'settings',
    'domains',
    'week_plans',
    'week_domains',
    'week_tasks',
    'week_goals',
    'hours_logged',
    'week_notes',
    'pending_mutations',
    'companion_messages',
    'companion_context'
  ];
  -- Deliberately NOT RLS-scoped: insight_reactions has a best-effort,
  -- nullable user_id but no client read path and no RLS policies at
  -- all — only the service-role key (which bypasses RLS) ever touches
  -- it. See supabase/migrations/0006_insight_reactions.sql's own
  -- comment. A genuine exception to "every user_id table is per-user
  -- RLS-scoped," not an oversight — excluded from the drift check
  -- below, NOT added to expected_tables above (which would wrongly
  -- demand 4 RLS policies on a table that correctly has zero).
  deliberately_unscoped text[] := ARRAY['insight_reactions'];
  t text;
  policy_count integer;
  rls_on boolean;
  rls_forced boolean;
  drift_table text;
BEGIN
  -- ─── Coverage: expected tables have all four ops ───────────────────────
  FOREACH t IN ARRAY expected_tables LOOP
    SELECT COUNT(*) INTO policy_count
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = t;
    IF policy_count <> 4 THEN
      RAISE EXCEPTION 'RLS audit failed: table public.% has % policies, expected 4', t, policy_count;
    END IF;

    SELECT relrowsecurity, relforcerowsecurity
      INTO rls_on, rls_forced
      FROM pg_class
     WHERE relname = t
       AND relnamespace = 'public'::regnamespace;
    IF NOT rls_on THEN
      RAISE EXCEPTION 'RLS audit failed: table public.% has RLS disabled', t;
    END IF;
    IF NOT rls_forced THEN
      RAISE EXCEPTION 'RLS audit failed: table public.% is missing FORCE RLS', t;
    END IF;
  END LOOP;

  -- ─── Drift: any public.* table with user_id NOT in the manifest ────────
  -- Catches "someone added a new user-scoped table without wiring RLS".
  SELECT c.relname INTO drift_table
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND a.attname = 'user_id'
     AND a.attnum > 0
     AND NOT a.attisdropped
     AND c.relname <> ALL(expected_tables)
     AND c.relname <> ALL(deliberately_unscoped)
   LIMIT 1;

  IF drift_table IS NOT NULL THEN
    RAISE EXCEPTION 'RLS audit failed: table public.% has a user_id column but is not in USER_SCOPED_TABLES manifest', drift_table;
  END IF;

  RAISE NOTICE 'RLS audit passed: % tables, 4 policies each, RLS+FORCE RLS enabled, no drift', array_length(expected_tables, 1);
END $$;
