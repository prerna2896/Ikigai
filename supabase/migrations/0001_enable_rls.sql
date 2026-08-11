-- Milestone 1: Row-Level Security setup.
--
-- Goal: every user-scoped table refuses reads and writes for rows the
-- caller doesn't own, enforced at the database layer. The `anon` role
-- (unauthenticated) has zero access to these tables; the `authenticated`
-- role can only see/write rows where user_id = auth.uid().
--
-- The static audit script at supabase/scripts/audit-rls.sql diffs this
-- coverage against packages/db/src/schema.ts (USER_SCOPED_TABLES) and
-- fails CI if any table is missing a policy.
--
-- Any new user-scoped table added later must be added to this file's
-- USER_SCOPED_TABLES loop AND to schema.ts's exported constant.

BEGIN;

-- ─── Privileges reset ────────────────────────────────────────────────────
-- Start from a locked-down baseline. RLS is a filter, not a gate — you
-- still need table-level GRANTs for a role to reach a policy at all.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
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
    'pending_mutations'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Revoke first so we don't accidentally leave anon with legacy access.
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
    -- Grant authenticated the four DML ops. RLS then filters row-by-row.
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated',
      t
    );
    -- service_role is Supabase's admin role (BYPASSRLS at the role
    -- level). Supabase's default schema grants it access on
    -- CREATE TABLE, but Drizzle-generated tables don't inherit that
    -- default — grant explicitly. Used by server-side Route Handlers,
    -- migrations, and test cleanup.
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
    -- Enable RLS. Without this, GRANT would let authenticated see all rows.
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE RLS so the table owner (Supabase's postgres role) is also
    -- subject to policies when queried via PostgREST. service_role
    -- bypasses via its role-level BYPASSRLS attribute, not via table
    -- ownership.
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ─── Policy template ─────────────────────────────────────────────────────
-- Every user-scoped table gets four policies, one per DML op.
--   SELECT: USING  (auth.uid() = user_id)
--   INSERT: WITH CHECK (auth.uid() = user_id)
--   UPDATE: USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)
--   DELETE: USING (auth.uid() = user_id)
--
-- The WITH CHECK on UPDATE prevents a caller from changing user_id to
-- point at their own account and stealing another user's row.
--
-- All policies are keyed to role `authenticated`. anon has no policies
-- so RLS denies-by-default when it queries (even though we also revoked
-- table-level GRANTs above — belt and braces).

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
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
    'pending_mutations'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- SELECT policy
    EXECUTE format(
      $POL$
        CREATE POLICY "%1$s_select_own"
          ON public.%1$I
          FOR SELECT
          TO authenticated
          USING (auth.uid() = user_id)
      $POL$,
      t
    );
    -- INSERT policy — WITH CHECK only (no USING for INSERT)
    EXECUTE format(
      $POL$
        CREATE POLICY "%1$s_insert_own"
          ON public.%1$I
          FOR INSERT
          TO authenticated
          WITH CHECK (auth.uid() = user_id)
      $POL$,
      t
    );
    -- UPDATE policy — USING filters visible rows, WITH CHECK constrains
    -- the post-update row so user_id can't be reassigned.
    EXECUTE format(
      $POL$
        CREATE POLICY "%1$s_update_own"
          ON public.%1$I
          FOR UPDATE
          TO authenticated
          USING (auth.uid() = user_id)
          WITH CHECK (auth.uid() = user_id)
      $POL$,
      t
    );
    -- DELETE policy
    EXECUTE format(
      $POL$
        CREATE POLICY "%1$s_delete_own"
          ON public.%1$I
          FOR DELETE
          TO authenticated
          USING (auth.uid() = user_id)
      $POL$,
      t
    );
  END LOOP;
END $$;

-- ─── Sanity assertion ────────────────────────────────────────────────────
-- Verify every table listed above has exactly four policies before the
-- migration commits. If drift is introduced later, the audit script
-- catches it in CI; this is the migration-time safety net.
DO $$
DECLARE
  expected_count integer := 12 * 4; -- 12 tables x 4 ops
  actual_count integer;
BEGIN
  SELECT COUNT(*) INTO actual_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'profiles','profile_reflections','profile_goals','settings','domains',
      'week_plans','week_domains','week_tasks','week_goals','hours_logged',
      'week_notes','pending_mutations'
    );
  IF actual_count <> expected_count THEN
    RAISE EXCEPTION 'RLS migration expected % policies, found %',
      expected_count, actual_count;
  END IF;
END $$;

COMMIT;
