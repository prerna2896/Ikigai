/**
 * Schema integrity — proves migrations produced the shape schema.ts declares.
 *
 * Item #4 on the original Essential Database Tests list — "migration
 * reversibility & up-down tests." Framed as "does applying all UP
 * migrations against a fresh DB produce the schema we expect."
 *
 * This spec is a static reflection of the DB's structural claims,
 * complementing:
 *   - tests/rls/isolation.spec.ts — runtime behavior of RLS policies
 *   - tests/rls/fk_cascade.spec.ts — runtime behavior of ON DELETE CASCADE
 *   - supabase/scripts/audit-rls.sql — RLS enable + FORCE RLS + policy count
 *
 * What this ADDS on top of those:
 *   - Composite primary key on week_plans (from migration 0003)
 *   - FK to auth.users with ON DELETE CASCADE on every user-scoped table
 *   - Membership in the `supabase_realtime` publication (from migration 0002)
 *   - Column presence on the tables the app relies on
 *
 * How to catch drift before merge:
 *   `supabase db reset --local` re-applies all migrations from scratch,
 *   then `pnpm test:rls` runs this spec against the fresh DB. If someone
 *   hand-edited the DB or added a table without a migration, the two
 *   will diverge and this spec fails.
 *
 * Uses direct SQL through the `postgres` driver — same pattern as
 * tests/perf/analytical.spec.ts. Service-role Supabase client isn't
 * enough because information_schema queries need superuser context for
 * some of the pg_catalog joins we do.
 *
 * Run: pnpm test:rls
 */

import { test, expect } from '@playwright/test';
import postgres from 'postgres';

const dbUrl =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const sql = postgres(dbUrl, { max: 2, idle_timeout: 5, connect_timeout: 10 });

// The canonical list. Kept in sync with USER_SCOPED_TABLES in
// packages/db/src/schema.ts. `supabase/scripts/audit-rls.sql` has the
// same list — both are checked-in copies of the same source of truth,
// which is safer than reading it dynamically (dynamic reads would let
// a broken schema.ts silently pass by drifting both sides together).
const USER_SCOPED_TABLES = [
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
] as const;

test.afterAll(async () => {
  await sql.end({ timeout: 5 });
});

test.describe('schema integrity — every migration produced the shape schema.ts declares', () => {
  test('every user-scoped table exists in public', async () => {
    const rows = (await sql`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = ANY(${USER_SCOPED_TABLES as unknown as string[]})
    `) as unknown as Array<{ tablename: string }>;

    const found = new Set(rows.map((r) => r.tablename));
    const missing = USER_SCOPED_TABLES.filter((t) => !found.has(t));
    expect(missing, `missing tables: ${missing.join(', ')}`).toEqual([]);
  });

  test('week_plans has composite primary key (user_id, id) — migration 0003', async () => {
    // Read column list on the PK constraint. Postgres exposes this via
    // pg_index; the order of columns in `indkey` matters for composite
    // PKs (queries planned as user_id first).
    const rows = (await sql`
      SELECT a.attname AS column_name, k.ordinality::int AS position
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinality)
        ON true
      JOIN pg_attribute a
        ON a.attrelid = c.oid AND a.attnum = k.attnum
      WHERE n.nspname = 'public'
        AND c.relname = 'week_plans'
        AND i.indisprimary
      ORDER BY k.ordinality
    `) as unknown as Array<{ column_name: string; position: number }>;

    const cols = rows.map((r) => r.column_name);
    expect(cols).toEqual(['user_id', 'id']);
  });

  test('every user-scoped table has FK to auth.users with ON DELETE CASCADE', async () => {
    // pg_constraint.confdeltype = 'c' means ON DELETE CASCADE.
    // Filter to FKs where the referenced table is auth.users and the
    // referencing column is user_id.
    const rows = (await sql`
      SELECT c.relname AS table_name
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_class rc ON rc.oid = con.confrelid
      JOIN pg_namespace rn ON rn.oid = rc.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(con.conkey)
      WHERE con.contype = 'f'
        AND con.confdeltype = 'c'
        AND n.nspname = 'public'
        AND rn.nspname = 'auth'
        AND rc.relname = 'users'
        AND a.attname = 'user_id'
    `) as unknown as Array<{ table_name: string }>;

    const found = new Set(rows.map((r) => r.table_name));
    const missing = USER_SCOPED_TABLES.filter((t) => !found.has(t));
    expect(
      missing,
      `these user-scoped tables have no auth.users FK w/ CASCADE: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  test('week_plans children have composite FK back to (user_id, id) with CASCADE', async () => {
    // Children per migration 0003: week_domains, week_tasks, week_goals,
    // hours_logged, week_notes. Composite FK (user_id, week_plan_id)
    // → week_plans(user_id, id).
    const composite_fk_children = [
      'week_domains',
      'week_tasks',
      'week_goals',
      'hours_logged',
      'week_notes',
    ];

    for (const child of composite_fk_children) {
      const rows = (await sql`
        SELECT a.attname AS column_name
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_class rc ON rc.oid = con.confrelid
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(con.conkey)
        WHERE con.contype = 'f'
          AND con.confdeltype = 'c'
          AND n.nspname = 'public'
          AND rc.relname = 'week_plans'
          AND c.relname = ${child}
        ORDER BY array_position(con.conkey, a.attnum)
      `) as unknown as Array<{ column_name: string }>;

      const cols = rows.map((r) => r.column_name);
      expect(
        cols,
        `${child} FK to week_plans is not composite (user_id, week_plan_id) w/ CASCADE`,
      ).toEqual(['user_id', 'week_plan_id']);
    }
  });

  test('every user-scoped table is in the supabase_realtime publication', async () => {
    // Realtime relies on membership in this publication (migration 0002).
    // Missing tables silently drop change events for those rows.
    const rows = (await sql`
      SELECT c.relname AS table_name
      FROM pg_publication p
      JOIN pg_publication_rel pr ON pr.prpubid = p.oid
      JOIN pg_class c ON c.oid = pr.prrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE p.pubname = 'supabase_realtime'
        AND n.nspname = 'public'
    `) as unknown as Array<{ table_name: string }>;

    const found = new Set(rows.map((r) => r.table_name));
    // pending_mutations is a server-side sync log and doesn't need
    // Realtime — clients don't subscribe to it.
    const expected = USER_SCOPED_TABLES.filter(
      (t) => t !== 'pending_mutations',
    );
    const missing = expected.filter((t) => !found.has(t));
    expect(
      missing,
      `these tables are NOT in supabase_realtime publication: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  test('key columns present on each user-scoped table', async () => {
    // Minimal shape check — proves the table isn't just an empty
    // placeholder that would break the app on first read/write.
    // Columns the app relies on across every user-scoped table:
    const required: Record<string, string[]> = {
      profiles: ['user_id', 'name', 'created_at', 'updated_at'],
      profile_reflections: ['id', 'user_id', 'question_id', 'answer'],
      profile_goals: ['id', 'user_id', 'text', 'timeline'],
      settings: [
        'user_id',
        'week_start_day',
        'week_time_zone',
        'profession_type',
      ],
      domains: ['id', 'user_id', 'name', 'color_token'],
      week_plans: [
        'id',
        'user_id',
        'week_start_iso',
        'week_end_iso',
        'week_start_day',
        'week_time_zone',
        'is_frozen',
      ],
      week_domains: [
        'id',
        'user_id',
        'week_plan_id',
        'name',
        'color_key',
        'principle_id',
        'position',
      ],
      week_tasks: [
        'id',
        'user_id',
        'week_plan_id',
        'week_domain_id',
        'title',
        'planned_hours',
        'position',
        'completed_at',
      ],
      week_goals: ['id', 'user_id', 'week_plan_id', 'text', 'position'],
      hours_logged: [
        'id',
        'user_id',
        'task_id',
        'week_plan_id',
        'date_iso',
        'hours',
      ],
      week_notes: ['id', 'user_id', 'week_plan_id', 'note'],
      pending_mutations: [
        'id',
        'user_id',
        'device_id',
        'op',
        'payload',
      ],
    };

    for (const [tableName, expectedCols] of Object.entries(required)) {
      const rows = (await sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ${tableName}
      `) as unknown as Array<{ column_name: string }>;
      const found = new Set(rows.map((r) => r.column_name));
      const missing = expectedCols.filter((c) => !found.has(c));
      expect(
        missing,
        `${tableName} is missing columns: ${missing.join(', ')}`,
      ).toEqual([]);
    }
  });

  test('no orphan public.* table has a user_id column but is not in USER_SCOPED_TABLES', async () => {
    // Guard against "new table added without registering with RLS +
    // realtime + this list." Mirrors the same check in
    // supabase/scripts/audit-rls.sql; duplicated here for the
    // pnpm test:rls path so devs catch it without running psql.
    const rows = (await sql`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND a.attname = 'user_id'
        AND a.attnum > 0
      GROUP BY c.relname
    `) as unknown as Array<{ table_name: string }>;

    const known = new Set<string>(USER_SCOPED_TABLES);
    const orphans = rows
      .map((r) => r.table_name)
      .filter((t) => !known.has(t));
    expect(
      orphans,
      `these public.* tables have user_id but are not in USER_SCOPED_TABLES (add to schema.ts + audit-rls.sql + this file, or drop): ${orphans.join(', ')}`,
    ).toEqual([]);
  });
});
