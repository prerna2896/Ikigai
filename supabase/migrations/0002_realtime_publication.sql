-- M2.4: add user-scoped tables to the supabase_realtime publication so
-- Supabase Realtime broadcasts postgres_changes for INSERT / UPDATE /
-- DELETE on them. The Realtime service still applies RLS per-subscriber,
-- so a user only receives events for their own rows.
--
-- Tables NOT in this list: no realtime broadcasts. Keep in sync with
-- USER_SCOPED_TABLES in packages/db/src/schema.ts.
--
-- REPLICA IDENTITY FULL: without this, UPDATE / DELETE events only
-- carry the primary key. FULL sends the whole old row so subscribers
-- can diff. Some cost (larger WAL) but simplifies client-side cache
-- reconciliation.

BEGIN;

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
    'week_notes'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
      t
    );
    EXECUTE format(
      'ALTER TABLE public.%I REPLICA IDENTITY FULL',
      t
    );
  END LOOP;
END $$;

COMMIT;
