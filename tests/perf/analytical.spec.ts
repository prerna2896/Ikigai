/**
 * Analytical query perf harness.
 *
 * What this proves:
 *   Representative rollup queries against `hours_logged` (the largest
 *   analytical table by far — one row per (user, task, date)) stay
 *   well under a wall-clock budget with a realistic corpus. If a
 *   future index change or query rewrite blows past the budget the
 *   spec fails loudly and we catch it before it lands in prod.
 *
 * Why write benchmarks for queries the app doesn't call yet:
 *   The app's insights layer today (`packages/insights/src/index.ts`)
 *   is a stub interface. When it grows real rollups (weekly hours,
 *   per-domain trends, Ikigai wheel completion, etc.) they'll want
 *   the queries below or shapes very close to them. Establishing the
 *   benchmark + budget now means those future queries land with the
 *   perf gate already wired instead of getting bolted on after a
 *   prod slowdown.
 *
 * Corpus size:
 *   ~20 000 hours_logged rows across 3 users, target user carrying
 *   ~10 000. That's roughly what a heavy solo user accumulates over
 *   6-12 months of daily logging. Big enough that a missing index
 *   on user_id + week_plan_id or user_id + task_id is instantly
 *   visible in wall-clock; small enough to seed in ~10s.
 *
 * Wall-clock vs EXPLAIN ANALYZE:
 *   We measure wall-clock at the SQL layer via the `postgres` driver
 *   (bypassing PostgREST). That's what the server actually spends —
 *   fetch overhead + PostgREST JSON marshalling would swamp small
 *   local-Docker query times and hide real regressions. The
 *   `EXPLAIN ANALYZE` output is captured on failure for diagnosis.
 *
 * Budgets:
 *   200ms per query on local Docker Postgres 17 with the corpus
 *   above. Real production Supabase on a small compute instance
 *   should be similar or faster given tuned storage.
 *
 * Run: pnpm test:perf
 */

import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbUrl =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

if (!url || !serviceKey) {
  throw new Error(
    'perf tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
  );
}

const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Direct SQL connection for the actual benchmarks. Reused across
// tests; `sql.end()` in afterAll releases it.
const sql = postgres(dbUrl, { max: 4, idle_timeout: 5, connect_timeout: 10 });

const BUDGET_MS = 200;

async function createUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'perf-throwaway-password-1234',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  return data.user.id;
}

async function deleteUser(id: string) {
  await admin.auth.admin.deleteUser(id).catch(() => {});
}

// Seed one user with `weekCount` week plans, each with `domainsPerWeek`
// domains, `tasksPerDomain` tasks, and `logsPerTask` hours_logged
// entries. Returns the raw row counts so the assertion in setup can
// confirm the corpus size we expect.
async function seedUserCorpus(
  userId: string,
  weekCount: number,
  domainsPerWeek: number,
  tasksPerDomain: number,
  logsPerTask: number,
): Promise<{ plans: number; domains: number; tasks: number; logs: number }> {
  const nowIso = new Date().toISOString();

  // Profile + settings — needed for the user to be "usable" but not
  // relevant to the analytical queries.
  await admin.from('profiles').insert({
    user_id: userId,
    name: `perf-user-${userId.slice(0, 8)}`,
    created_at: nowIso,
    updated_at: nowIso,
  });
  await admin.from('settings').insert({
    user_id: userId,
    week_start_day: 'monday',
    week_time_zone: 'America/Los_Angeles',
    profession_type: 'full_time_employee',
    created_at: nowIso,
    updated_at: nowIso,
  });

  const principles = [
    'passion',
    'mission',
    'vocation',
    'profession',
    'contribution',
  ];
  const colorKeys = ['blue', 'red', 'green', 'yellow', 'purple'];

  // Build all inserts in memory, batch by table so PostgREST doesn't
  // make one round-trip per row.
  const planRows: unknown[] = [];
  const domainRows: unknown[] = [];
  const taskRows: unknown[] = [];
  const logRows: unknown[] = [];

  // Start weeks 12 weeks back and walk forward. Simple ISO date math
  // — Monday of each week.
  const baseMonday = new Date('2026-01-05T00:00:00Z'); // known Monday
  for (let w = 0; w < weekCount; w += 1) {
    const monday = new Date(baseMonday);
    monday.setUTCDate(monday.getUTCDate() + w * 7);
    const weekStartIso = monday.toISOString().slice(0, 10);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    const weekEndIso = sunday.toISOString().slice(0, 10);
    const planId = `${userId.slice(0, 8)}-${weekStartIso}`; // per-user text pk

    planRows.push({
      id: planId,
      user_id: userId,
      week_start_iso: weekStartIso,
      week_end_iso: weekEndIso,
      week_start_day: 'monday',
      week_time_zone: 'America/Los_Angeles',
      is_frozen: false,
      created_at: nowIso,
      updated_at: nowIso,
    });

    for (let d = 0; d < domainsPerWeek; d += 1) {
      const domainId = randomUUID();
      domainRows.push({
        id: domainId,
        user_id: userId,
        week_plan_id: planId,
        name: `domain-${d}`,
        color_key: colorKeys[d % colorKeys.length],
        principle_id: principles[d % principles.length],
        position: d,
      });

      for (let t = 0; t < tasksPerDomain; t += 1) {
        const taskId = randomUUID();
        taskRows.push({
          id: taskId,
          user_id: userId,
          week_plan_id: planId,
          week_domain_id: domainId,
          title: `task-${d}-${t}`,
          planned_hours: 4,
          position: t,
        });

        // hours_logged has a UNIQUE(user_id, task_id, date_iso)
        // partial index (where task_id IS NOT NULL), so at most one
        // entry per (task, day). The natural cap is 7 logs/task/week.
        // Enforced here to prevent seed-time 23505s if a caller
        // passes a larger value; scale the corpus via more tasks or
        // more weeks instead.
        const dailyLogs = Math.min(logsPerTask, 7);
        for (let l = 0; l < dailyLogs; l += 1) {
          const day = new Date(monday);
          day.setUTCDate(monday.getUTCDate() + l);
          logRows.push({
            id: randomUUID(),
            user_id: userId,
            task_id: taskId,
            week_plan_id: planId,
            date_iso: day.toISOString().slice(0, 10),
            hours: 1 + (l % 3), // 1, 2, or 3 hours
          });
        }
      }
    }
  }

  // Chunk each table's insert so we don't blow past PostgREST body
  // limits or Kong's default 8 MB. 1000 rows per chunk is comfortably
  // under either.
  const CHUNK = 1000;
  const insertChunked = async (table: string, rows: unknown[]) => {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const { error } = await admin.from(table).insert(slice);
      if (error) throw new Error(`seed ${table}[${i}]: ${error.message}`);
    }
  };
  await insertChunked('week_plans', planRows);
  await insertChunked('week_domains', domainRows);
  await insertChunked('week_tasks', taskRows);
  await insertChunked('hours_logged', logRows);

  return {
    plans: planRows.length,
    domains: domainRows.length,
    tasks: taskRows.length,
    logs: logRows.length,
  };
}

async function time<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<{ ms: number; result: T }> {
  const start = performance.now();
  const result = await fn();
  const ms = performance.now() - start;
  // eslint-disable-next-line no-console
  console.log(`  ${label}: ${ms.toFixed(1)}ms`);
  return { ms, result };
}

// Emitted on any failure so a slow query can be diagnosed without
// re-running with a debugger. Wraps EXPLAIN ANALYZE around the same
// SQL and pretty-prints the plan.
async function explain(
  label: string,
  query: string,
  params: (string | number)[],
) {
  // eslint-disable-next-line no-console
  console.log(`  --- EXPLAIN ANALYZE (${label}) ---`);
  const rows = (await sql.unsafe(`EXPLAIN ANALYZE ${query}`, params)) as unknown as Array<
    Record<string, unknown>
  >;
  for (const row of rows) {
    // eslint-disable-next-line no-console
    console.log(`  ${String(row['QUERY PLAN'] ?? '')}`);
  }
}

test.describe('analytical rollups on hours_logged stay under budget', () => {
  const emailTarget = `perf-target-${Date.now()}-${process.pid}@ikigai.test`;
  const emailNoiseA = `perf-noise-a-${Date.now()}-${process.pid}@ikigai.test`;
  const emailNoiseB = `perf-noise-b-${Date.now()}-${process.pid}@ikigai.test`;
  let targetId = '';
  let noiseAId = '';
  let noiseBId = '';

  test.beforeAll(async () => {
    // Target: heavy user. 12 weeks × 5 domains × 20 tasks × 7 logs
    // (one per day) = 8 400 hours_logged rows.
    // Noise: two lighter users (~840 logs each) so the analytical
    // queries can't accidentally skip the user_id filter and still pass.
    // Total corpus: ~10 000 hours_logged rows.
    targetId = await createUser(emailTarget);
    noiseAId = await createUser(emailNoiseA);
    noiseBId = await createUser(emailNoiseB);

    // Kick off in parallel; each seed handles its own errors.
    await Promise.all([
      seedUserCorpus(targetId, 12, 5, 20, 7),
      seedUserCorpus(noiseAId, 6, 4, 5, 7),
      seedUserCorpus(noiseBId, 6, 4, 5, 7),
    ]);

    const { count } = await admin
      .from('hours_logged')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', targetId);
    // eslint-disable-next-line no-console
    console.log(`  seeded target user with ${count} hours_logged rows`);
    expect(count).toBeGreaterThan(8_000);
  });

  test.afterAll(async () => {
    // Cascade purges the whole subtree via FK — see fk_cascade.spec.ts.
    await Promise.all([
      deleteUser(targetId),
      deleteUser(noiseAId),
      deleteUser(noiseBId),
    ]);
    await sql.end({ timeout: 5 });
  });

  test('Q1: weekly hours totals for a user', async () => {
    const query = `
      SELECT week_plan_id, SUM(hours)::numeric AS total_hours
      FROM hours_logged
      WHERE user_id = $1
      GROUP BY week_plan_id
      ORDER BY week_plan_id
    `;
    const { ms, result } = await time('Q1 weekly totals', () =>
      sql.unsafe(query, [targetId]),
    );
    if (ms > BUDGET_MS) await explain('Q1', query, [targetId]);
    expect(result.length).toBe(12);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  test('Q2: hours per domain per week (join hours_logged → tasks → domains)', async () => {
    const query = `
      SELECT
        wp.week_start_iso,
        wd.name AS domain_name,
        SUM(hl.hours)::numeric AS total_hours
      FROM hours_logged hl
      JOIN week_tasks wt ON wt.id = hl.task_id
      JOIN week_domains wd ON wd.id = wt.week_domain_id
      JOIN week_plans wp ON wp.user_id = hl.user_id AND wp.id = hl.week_plan_id
      WHERE hl.user_id = $1
      GROUP BY wp.week_start_iso, wd.name
      ORDER BY wp.week_start_iso, wd.name
    `;
    const { ms, result } = await time('Q2 per-domain per-week', () =>
      sql.unsafe(query, [targetId]),
    );
    if (ms > BUDGET_MS) await explain('Q2', query, [targetId]);
    // 12 weeks × 5 domains = 60 rows.
    expect(result.length).toBe(60);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  test('Q3: Ikigai wheel — hours per principle per week', async () => {
    const query = `
      SELECT
        wp.week_start_iso,
        wd.principle_id,
        SUM(hl.hours)::numeric AS total_hours
      FROM hours_logged hl
      JOIN week_tasks wt ON wt.id = hl.task_id
      JOIN week_domains wd ON wd.id = wt.week_domain_id
      JOIN week_plans wp ON wp.user_id = hl.user_id AND wp.id = hl.week_plan_id
      WHERE hl.user_id = $1
      GROUP BY wp.week_start_iso, wd.principle_id
      ORDER BY wp.week_start_iso, wd.principle_id
    `;
    const { ms, result } = await time('Q3 per-principle per-week', () =>
      sql.unsafe(query, [targetId]),
    );
    if (ms > BUDGET_MS) await explain('Q3', query, [targetId]);
    // 12 weeks × 5 principles = 60 rows (5 domains, each on a distinct
    // principle — see seed rotation).
    expect(result.length).toBe(60);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  test('Q4: top 10 tasks by hours logged', async () => {
    const query = `
      SELECT
        wt.title,
        SUM(hl.hours)::numeric AS total_hours
      FROM hours_logged hl
      JOIN week_tasks wt ON wt.id = hl.task_id
      WHERE hl.user_id = $1
      GROUP BY wt.title
      ORDER BY total_hours DESC
      LIMIT 10
    `;
    const { ms, result } = await time('Q4 top-tasks', () =>
      sql.unsafe(query, [targetId]),
    );
    if (ms > BUDGET_MS) await explain('Q4', query, [targetId]);
    expect(result.length).toBe(10);
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});
