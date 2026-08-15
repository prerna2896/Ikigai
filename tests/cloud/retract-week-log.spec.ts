/**
 * Regression: CloudRepository.retractWeekLog must undo exactly the
 * hours it's given — subtracting from the (task, date) row rather
 * than deleting it outright — and must leave hours other saves added
 * to the same row alone.
 *
 * Backs the LogPanel "unselect a mistaken done-tap" fix: marking a
 * task done auto-fills its remaining hours via saveWeekLog; unmarking
 * calls retractWeekLog with that exact same entry to undo it. This
 * spec verifies the storage-layer half of that round trip.
 *
 * Depends on: local Supabase.
 */

import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { CloudRepository } from '@ikigai/cloud-storage';
import { randomUUID } from 'node:crypto';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  throw new Error('retract-week-log spec requires cloud env vars');
}

const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function createUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'retract-log-throwaway-1234',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  return data.user.id;
}

async function deleteUser(id: string) {
  await admin.auth.admin.deleteUser(id).catch(() => {});
}

async function clientAsUser(email: string): Promise<SupabaseClient> {
  const client = createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: 'retract-log-throwaway-1234',
  });
  if (error || !data.session) throw new Error(`signIn: ${error?.message}`);
  return client;
}

test.describe('CloudRepository.retractWeekLog', () => {
  const email = `retract-log-${Date.now()}-${process.pid}@ikigai.test`;
  let userId = '';
  const weekPlanId = '2026-10-05';
  const weekStartIso = '2026-10-05';
  const weekEndIso = '2026-10-11';
  const domainId = randomUUID();
  const yogaTaskId = randomUUID();
  const readingTaskId = randomUUID();

  test.beforeAll(async () => {
    userId = await createUser(email);
    const nowIso = new Date().toISOString();
    await admin.from('profiles').insert({
      user_id: userId,
      name: 'Retract Log Test',
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
      name: 'Health',
      color_key: 'green',
      principle_id: 'contribution',
      position: 0,
    });
    await admin.from('week_tasks').insert([
      { id: yogaTaskId, user_id: userId, week_plan_id: weekPlanId, week_domain_id: domainId, title: 'Yoga', planned_hours: 4, position: 0 },
      { id: readingTaskId, user_id: userId, week_plan_id: weekPlanId, week_domain_id: domainId, title: 'Reading', planned_hours: 1, position: 1 },
    ]);
  });

  test.afterAll(async () => {
    await deleteUser(userId);
  });

  test('retracting an auto-fill entry removes the row it created and leaves other tasks alone', async () => {
    const dateIso = '2026-10-06';
    const supabase = await clientAsUser(email);
    const repo = new CloudRepository(supabase);

    // Simulates: user taps "done" on Yoga (4h planned, 0 logged) and
    // Reading (1h planned, 0 logged) is untouched.
    const fillEntry = {
      id: randomUUID(),
      weekId: weekPlanId,
      dateISO: dateIso,
      taskHours: { [yogaTaskId]: 4 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await repo.saveWeekLog(fillEntry);
    await repo.saveWeekLog({
      id: randomUUID(),
      weekId: weekPlanId,
      dateISO: dateIso,
      taskHours: { [readingTaskId]: 1 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    let rows = await admin
      .from('hours_logged')
      .select('task_id, hours')
      .eq('user_id', userId)
      .eq('date_iso', dateIso);
    expect(rows.data?.length).toBe(2);

    // User taps "done" again by mistake — undo exactly the fill entry.
    await repo.retractWeekLog(fillEntry);

    rows = await admin
      .from('hours_logged')
      .select('task_id, hours')
      .eq('user_id', userId)
      .eq('date_iso', dateIso);
    expect(rows.data?.length).toBe(1);
    expect(rows.data?.[0]?.task_id).toBe(readingTaskId);
    expect(Number(rows.data?.[0]?.hours)).toBe(1);
  });

  test('retracting only subtracts its own amount when other saves added to the same row', async () => {
    const dateIso = '2026-10-07';
    const supabase = await clientAsUser(email);
    const repo = new CloudRepository(supabase);

    // Auto-fill adds 4h for Yoga...
    const fillEntry = {
      id: randomUUID(),
      weekId: weekPlanId,
      dateISO: dateIso,
      taskHours: { [yogaTaskId]: 4 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await repo.saveWeekLog(fillEntry);

    // ...then the user separately logs 2 more hours of Yoga manually
    // before noticing the done-tap was a mistake.
    await repo.saveWeekLog({
      id: randomUUID(),
      weekId: weekPlanId,
      dateISO: dateIso,
      taskHours: { [yogaTaskId]: 2 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Retracting the fill only removes its own 4h, leaving the 2h the
    // user typed themselves — never deletes the row outright when
    // other hours remain.
    await repo.retractWeekLog(fillEntry);

    const rows = await admin
      .from('hours_logged')
      .select('hours')
      .eq('user_id', userId)
      .eq('date_iso', dateIso)
      .eq('task_id', yogaTaskId);
    expect(rows.data?.length).toBe(1);
    expect(Number(rows.data?.[0]?.hours)).toBe(2);
  });
});
