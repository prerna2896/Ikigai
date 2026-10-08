-- 0009 — RLS for the companion tables added in 0008.
--
-- Same structure as 0001_enable_rls.sql's loop, scoped to just the two
-- new tables (companion_messages, companion_context) rather than
-- re-running the full original loop — this is the "new numbered
-- migration that extends the loop" 0001's own header comment
-- anticipates for tables added later.
--
-- Both tables were already appended to packages/db/src/schema.ts's
-- USER_SCOPED_TABLES and to supabase/scripts/audit-rls.sql's
-- expected_tables in the same change as this migration.

BEGIN;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'companion_messages',
    'companion_context'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated',
      t
    );
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'companion_messages',
    'companion_context'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
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
DO $$
DECLARE
  expected_count integer := 2 * 4; -- 2 tables x 4 ops
  actual_count integer;
BEGIN
  SELECT COUNT(*) INTO actual_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('companion_messages', 'companion_context');
  IF actual_count <> expected_count THEN
    RAISE EXCEPTION 'Companion RLS migration expected % policies, found %',
      expected_count, actual_count;
  END IF;
END $$;

COMMIT;
