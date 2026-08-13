/**
 * Regression: partial saveWeekLog must NOT wipe other tasks' rows for
 * the same date.
 *
 * The bug: CloudRepository.saveWeekLog used to
 *   DELETE FROM hours_logged
 *   WHERE user_id = $1 AND week_plan_id = $2 AND date_iso = $3
 * before re-inserting the incoming rows. That's correct when the
 * caller passes a complete snapshot for the day, but the log UI
 * saves a partial snapshot every time — the form only contains the
 * hours the user just typed. Result: 16h of sleep entered at
 * 10am → 2h of an unplanned task entered at 2pm with sleep left
 * blank → sleep dropped from 16h back to 0.
 *
 * The fix (this spec verifies): upsert only the rows in the incoming
 * entry, keyed by the (user_id, task_id, date_iso) unique index.
 * Other tasks' rows for the same date survive.
 *
 * Uses the raw admin client for reads — we're testing the write's
 * DB-side effect, not RLS behavior.
 *
 * Depends on: local Supabase, dev server on 3724.
 */

import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { CloudRepository } from '@ikigai/cloud-storage';
import { randomUUID } from 'node:crypto';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  throw new Error('partial saveWeekLog spec requires cloud env vars');
}

const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function createUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'partial-log-throwaway-1234',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  return data.user.id;
}

async function deleteUser(id: string) {
  await admin.auth.admin.deleteUser(id).catch(() => {});
}

// Sign in with password → get a real JWT → build a Supabase client
// scoped to this user. Needed because CloudRepository uses
// `getUser()` internally to derive user_id for RLS-friendly writes.
async function clientAsUser(email: string): Promise<SupabaseClient> {
  const client = createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: 'partial-log-throwaway-1234',
  });
  if (error || !data.session)
    throw new Error(`signIn: ${error?.message}`);
  return client;
}

test.describe('CloudRepository.saveWeekLog — partial writes preserve other tasks', () => {
  const email = `partial-log-${Date.now()}-${process.pid}@ikigai.test`;
  let userId = '';
  const weekPlanId = '2026-09-07';
  const weekStartIso = '2026-09-07';
  const weekEndIso = '2026-09-13';
  const dateIso = '2026-09-08';
  const domainId = randomUUID();
  const sleepTaskId = randomUUID();
  const focusTaskId = randomUUID();
  const readingTaskId = randomUUID();

  test.beforeAll(async () => {
    userId = await createUser(email);

    // Seed a plan + 3 tasks under one domain so we have real task_ids
    // to log against. hours_logged.task_id has an FK to week_tasks so
    // we can't just make up UUIDs.
    const nowIso = new Date().toISOString();
    await admin.from('profiles').insert({
      user_id: userId,
      name: 'Partial Log Test',
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
    await admin.from('week_plans').insert({
      id: weekPlanId,
      user_id: userId,
      week_start_iso: weekStartIso,
      week_end_iso: weekEndIso,
      week_start_day: 'monday',
      week_time_zone: 'America/Los_Angeles',
      is_frozen: false,
      created_at: nowIso,
      updated_at: nowIso,
    });
    await admin.from('week_domains').insert({
      id: domainId,
      user_id: userId,
      week_plan_id: weekPlanId,
      name: 'Foundations',
      color_key: 'blue',
      principle_id: 'contribution',
      position: 0,
    });
    await admin.from('week_tasks').insert([
      { id: sleepTaskId, user_id: userId, week_plan_id: weekPlanId, week_domain_id: domainId, title: 'Sleep', planned_hours: 8, position: 0 },
      { id: focusTaskId, user_id: userId, week_plan_id: weekPlanId, week_domain_id: domainId, title: 'Focus block', planned_hours: 4, position: 1 },
      { id: readingTaskId, user_id: userId, week_plan_id: weekPlanId, week_domain_id: domainId, title: 'Reading', planned_hours: 1, position: 2 },
    ]);
  });

  test.afterAll(async () => {
    await deleteUser(userId);
  });

  test('two partial saves on the same date accumulate — neither wipes the other', async () => {
    const supabase = await clientAsUser(email);
    const repo = new CloudRepository(supabase);

    // Save #1: sleep = 16h, focus = 4h. Nothing about reading.
    await repo.saveWeekLog({
      id: 'ignored-1',
      weekId: weekPlanId,
      dateISO: dateIso,
      taskHours: {
        [sleepTaskId]: 16,
        [focusTaskId]: 4,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Sanity: cloud has both rows.
    let rows = await admin
      .from('hours_logged')
      .select('task_id, hours')
      .eq('user_id', userId)
      .eq('date_iso', dateIso);
    expect(rows.data?.length).toBe(2);

    // Save #2: reading = 1h ONLY. Sleep and focus are NOT in the map —
    // simulating the log UI where the form only carries the hours the
    // user just typed. Pre-fix, this would delete sleep+focus.
    await repo.saveWeekLog({
      id: 'ignored-2',
      weekId: weekPlanId,
      dateISO: dateIso,
      taskHours: {
        [readingTaskId]: 1,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Post-fix: all three tasks should have their hours preserved.
    rows = await admin
      .from('hours_logged')
      .select('task_id, hours')
      .eq('user_id', userId)
      .eq('date_iso', dateIso);
    expect(rows.data?.length).toBe(3);

    const byTask = new Map<string, number>();
    for (const row of rows.data ?? []) {
      byTask.set(row.task_id as string, Number(row.hours));
    }
    expect(byTask.get(sleepTaskId)).toBe(16);
    expect(byTask.get(focusTaskId)).toBe(4);
    expect(byTask.get(readingTaskId)).toBe(1);
  });

  test('re-saving the same task on the same date ADDS to the running total (additive semantics)', async () => {
    // Fresh date so it doesn't interfere with the previous test.
    const dateIso2 = '2026-09-09';
    const supabase = await clientAsUser(email);
    const repo = new CloudRepository(supabase);

    // First save: sleep = 8h.
    await repo.saveWeekLog({
      id: 'ignored-3',
      weekId: weekPlanId,
      dateISO: dateIso2,
      taskHours: { [sleepTaskId]: 8 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Second save: sleep = 4 (user logs an additional 4h). The
    // LogPanel input placeholder is "+0" and the total-so-far shows
    // next to it — users type how many hours to ADD, not the new
    // total.
    await repo.saveWeekLog({
      id: 'ignored-4',
      weekId: weekPlanId,
      dateISO: dateIso2,
      taskHours: { [sleepTaskId]: 4 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Still exactly one row (partial unique index prevents
    // duplicates) but hours = 8 + 4 = 12.
    const rows = await admin
      .from('hours_logged')
      .select('hours')
      .eq('user_id', userId)
      .eq('date_iso', dateIso2)
      .eq('task_id', sleepTaskId);
    expect(rows.data?.length).toBe(1);
    expect(Number(rows.data?.[0]?.hours)).toBe(12);
  });
});
