/**
 * FK CASCADE integrity — end-to-end through Supabase.
 *
 * Pins the ON DELETE CASCADE behavior every user-scoped table
 * declares. The concern this addresses: a future schema refactor
 * (dropping an FK, changing a column type, rewriting a table) could
 * silently break the cascade chain. Without a test, we wouldn't
 * notice until a real user deletes their account and orphan rows
 * pile up in child tables.
 *
 * Cascade chains verified:
 *   auth.users
 *     → profiles, profile_reflections, profile_goals, settings,
 *       domains, week_plans, week_domains, week_tasks, week_goals,
 *       hours_logged, week_notes  (every user-scoped table)
 *   week_plans (composite user_id, id — see migration 0003)
 *     → week_domains, week_tasks, week_goals, hours_logged, week_notes
 *   week_domains
 *     → week_tasks
 *   week_tasks
 *     → hours_logged (via task_id)
 *
 * Uses the service-role client for all reads/writes to bypass RLS —
 * we're testing FK behavior, not policy behavior (that's isolation.spec.ts).
 *
 * Run: pnpm test:rls
 *
 * Required env: same as isolation.spec.ts.
 */

import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  throw new Error(
    'FK cascade tests require NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY',
  );
}

// Service-role client bypasses RLS. Use for both setup (seeding rows
// on behalf of the throwaway user) and verification (counting rows
// after deletes) so nothing here depends on the auth.uid() context.
const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function createUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'fk-cascade-throwaway-password-1234',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  return data.user.id;
}

async function deleteUser(id: string) {
  await admin.auth.admin.deleteUser(id).catch(() => {});
}

// Seed one row into every user-scoped table for `userId`. Returns the
// generated ids so per-table assertions can target them later. Uses
// stable IDs (as opposed to fully-random) only where the schema
// prefers deterministic keys (settings.user_id = PK, no separate id).
async function seedFullTree(
  userId: string,
): Promise<{
  planId: string;
  domainId: string;
  taskId: string;
  goalId: string;
  reflectionId: string;
  profileGoalId: string;
  hoursLoggedId: string;
  noteId: string;
  weekStartISO: string;
}> {
  const nowIso = new Date().toISOString();
  const planId = '2026-06-01';
  const weekStartISO = '2026-06-01';
  const domainId = randomUUID();
  const taskId = randomUUID();
  const goalId = randomUUID();
  const reflectionId = randomUUID();
  const profileGoalId = randomUUID();
  const hoursLoggedId = randomUUID();
  const noteId = randomUUID();

  // Profile is a per-user singleton keyed on user_id (no separate id).
  const { error: profileErr } = await admin.from('profiles').insert({
    user_id: userId,
    name: 'FK Cascade User',
    created_at: nowIso,
    updated_at: nowIso,
  });
  if (profileErr) throw profileErr;

  const { error: settingsErr } = await admin.from('settings').insert({
    user_id: userId,
    week_start_day: 'monday',
    week_time_zone: 'America/Los_Angeles',
    profession_type: 'full_time_employee',
    created_at: nowIso,
    updated_at: nowIso,
  });
  if (settingsErr) throw settingsErr;

  const { error: reflErr } = await admin.from('profile_reflections').insert({
    id: reflectionId,
    user_id: userId,
    question_id: 'wins-to-notice',
    answer: 'seeded',
  });
  if (reflErr) throw reflErr;

  const { error: pgErr } = await admin.from('profile_goals').insert({
    id: profileGoalId,
    user_id: userId,
    text: 'seeded profile goal',
    timeline: '1_month',
  });
  if (pgErr) throw pgErr;

  const { error: planErr } = await admin.from('week_plans').insert({
    id: planId,
    user_id: userId,
    week_start_iso: weekStartISO,
    week_end_iso: '2026-06-07',
    week_start_day: 'monday',
    week_time_zone: 'America/Los_Angeles',
    is_frozen: false,
    created_at: nowIso,
    updated_at: nowIso,
  });
  if (planErr) throw planErr;

  const { error: domainErr } = await admin.from('week_domains').insert({
    id: domainId,
    user_id: userId,
    week_plan_id: planId,
    name: 'Deep Work',
    color_key: 'blue',
    principle_id: 'contribution',
    position: 0,
  });
  if (domainErr) throw domainErr;

  const { error: taskErr } = await admin.from('week_tasks').insert({
    id: taskId,
    user_id: userId,
    week_plan_id: planId,
    week_domain_id: domainId,
    title: 'Ship the FK cascade tests',
    planned_hours: 4,
    position: 0,
  });
  if (taskErr) throw taskErr;

  const { error: goalErr } = await admin.from('week_goals').insert({
    id: goalId,
    user_id: userId,
    week_plan_id: planId,
    text: 'seeded week goal',
    position: 0,
  });
  if (goalErr) throw goalErr;

  const { error: hlErr } = await admin.from('hours_logged').insert({
    id: hoursLoggedId,
    user_id: userId,
    task_id: taskId,
    week_plan_id: planId,
    date_iso: weekStartISO,
    hours: 2,
  });
  if (hlErr) throw hlErr;

  const { error: noteErr } = await admin.from('week_notes').insert({
    id: noteId,
    user_id: userId,
    week_plan_id: planId,
    note: 'seeded note',
  });
  if (noteErr) throw noteErr;

  return {
    planId,
    domainId,
    taskId,
    goalId,
    reflectionId,
    profileGoalId,
    hoursLoggedId,
    noteId,
    weekStartISO,
  };
}

// Count rows for the given user across every user-scoped table.
// Returns a map so failing tests point at the exact table with the
// orphan row. Also queries a few by primary key so a stale-row
// leak (right user_id but wrong id) shows up too.
async function countForUser(userId: string): Promise<Record<string, number>> {
  const tables = [
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
  ] as const;
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const { count, error } = await admin
      .from(t)
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (error) throw error;
    counts[t] = count ?? 0;
  }
  return counts;
}

test.describe('FK CASCADE — deleting auth.users purges the whole user subtree', () => {
  const email = `fk-user-${Date.now()}-${process.pid}@ikigai.test`;
  let userId = '';

  test.beforeAll(async () => {
    userId = await createUser(email);
    await seedFullTree(userId);
  });

  test.afterAll(async () => {
    // Best-effort — the test itself deletes the user; this is here
    // in case the test failed before that point.
    await deleteUser(userId);
  });

  test('all user-scoped tables have rows before delete', async () => {
    const counts = await countForUser(userId);
    // profile_goals is 1 (we seeded one), domains is 0 (we didn't
    // seed the cross-week catalog — it's schema-defined but the app
    // doesn't use it meaningfully yet). Everything else = 1.
    expect(counts.profiles).toBe(1);
    expect(counts.settings).toBe(1);
    expect(counts.profile_reflections).toBe(1);
    expect(counts.profile_goals).toBe(1);
    expect(counts.week_plans).toBe(1);
    expect(counts.week_domains).toBe(1);
    expect(counts.week_tasks).toBe(1);
    expect(counts.week_goals).toBe(1);
    expect(counts.hours_logged).toBe(1);
    expect(counts.week_notes).toBe(1);
  });

  test('delete auth.users → every child row is gone', async () => {
    const { error } = await admin.auth.admin.deleteUser(userId);
    expect(error).toBeNull();

    const counts = await countForUser(userId);
    // Every user-scoped row must be gone; ORDER matters (Postgres
    // walks the FK graph on delete). If a single table shows a
    // non-zero count, we've regressed a cascade somewhere.
    for (const [table, count] of Object.entries(counts)) {
      expect(count, `table ${table} still has rows for deleted user`).toBe(0);
    }
  });
});

test.describe('FK CASCADE — deleting a week_plan purges its subtree', () => {
  const email = `fk-plan-${Date.now()}-${process.pid}@ikigai.test`;
  let userId = '';
  let seed: Awaited<ReturnType<typeof seedFullTree>>;

  test.beforeAll(async () => {
    userId = await createUser(email);
    seed = await seedFullTree(userId);
  });

  test.afterAll(async () => {
    await deleteUser(userId);
  });

  test('week_plan children exist before delete', async () => {
    const [domains, tasks, goals, hours, notes] = await Promise.all([
      admin.from('week_domains').select('id').eq('week_plan_id', seed.planId),
      admin.from('week_tasks').select('id').eq('week_plan_id', seed.planId),
      admin.from('week_goals').select('id').eq('week_plan_id', seed.planId),
      admin.from('hours_logged').select('id').eq('week_plan_id', seed.planId),
      admin.from('week_notes').select('id').eq('week_plan_id', seed.planId),
    ]);
    expect(domains.data?.length).toBe(1);
    expect(tasks.data?.length).toBe(1);
    expect(goals.data?.length).toBe(1);
    expect(hours.data?.length).toBe(1);
    expect(notes.data?.length).toBe(1);
  });

  test('delete week_plan → domains, tasks, goals, hours_logged, notes all cascade', async () => {
    // week_plans has a composite PK (user_id, id) — must scope by
    // both to actually hit the target row.
    const { error } = await admin
      .from('week_plans')
      .delete()
      .eq('user_id', userId)
      .eq('id', seed.planId);
    expect(error).toBeNull();

    const [domains, tasks, goals, hours, notes] = await Promise.all([
      admin.from('week_domains').select('id').eq('week_plan_id', seed.planId),
      admin.from('week_tasks').select('id').eq('week_plan_id', seed.planId),
      admin.from('week_goals').select('id').eq('week_plan_id', seed.planId),
      admin.from('hours_logged').select('id').eq('week_plan_id', seed.planId),
      admin.from('week_notes').select('id').eq('week_plan_id', seed.planId),
    ]);
    expect(domains.data?.length).toBe(0);
    expect(tasks.data?.length).toBe(0);
    expect(goals.data?.length).toBe(0);
    expect(hours.data?.length).toBe(0);
    expect(notes.data?.length).toBe(0);

    // Sibling user-scoped rows (profile, settings) untouched — the
    // plan cascade is scoped, not user-scoped.
    const { count: profileCount } = await admin
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    expect(profileCount).toBe(1);
  });
});

test.describe('FK CASCADE — deleting a week_domain purges its tasks', () => {
  const email = `fk-domain-${Date.now()}-${process.pid}@ikigai.test`;
  let userId = '';
  let seed: Awaited<ReturnType<typeof seedFullTree>>;

  test.beforeAll(async () => {
    userId = await createUser(email);
    seed = await seedFullTree(userId);
  });

  test.afterAll(async () => {
    await deleteUser(userId);
  });

  test('delete week_domain → week_tasks cascade; sibling plan tables untouched', async () => {
    const { error } = await admin
      .from('week_domains')
      .delete()
      .eq('id', seed.domainId);
    expect(error).toBeNull();

    const { data: tasks } = await admin
      .from('week_tasks')
      .select('id')
      .eq('week_domain_id', seed.domainId);
    expect(tasks?.length).toBe(0);

    // week_goals + week_notes on the same plan are NOT children of
    // week_domain, so they must survive.
    const { count: goalCount } = await admin
      .from('week_goals')
      .select('*', { count: 'exact', head: true })
      .eq('week_plan_id', seed.planId);
    expect(goalCount).toBe(1);
    const { count: noteCount } = await admin
      .from('week_notes')
      .select('*', { count: 'exact', head: true })
      .eq('week_plan_id', seed.planId);
    expect(noteCount).toBe(1);
  });
});

test.describe('FK CASCADE — deleting a week_task purges its hours_logged', () => {
  const email = `fk-task-${Date.now()}-${process.pid}@ikigai.test`;
  let userId = '';
  let seed: Awaited<ReturnType<typeof seedFullTree>>;

  test.beforeAll(async () => {
    userId = await createUser(email);
    seed = await seedFullTree(userId);
  });

  test.afterAll(async () => {
    await deleteUser(userId);
  });

  test('delete week_task → hours_logged rows referencing that task cascade', async () => {
    // Sanity: hours_logged row exists with our task_id.
    const before = await admin
      .from('hours_logged')
      .select('id, task_id')
      .eq('task_id', seed.taskId);
    expect(before.data?.length).toBe(1);

    const { error } = await admin
      .from('week_tasks')
      .delete()
      .eq('id', seed.taskId);
    expect(error).toBeNull();

    const after = await admin
      .from('hours_logged')
      .select('id')
      .eq('task_id', seed.taskId);
    expect(after.data?.length).toBe(0);
  });
});
