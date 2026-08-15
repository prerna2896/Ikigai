/**
 * Regression: CloudRepository.saveWeekLog bumps
 * profiles.last_activity_at to now.
 *
 * The bug: only LocalRepository (Dexie) called bumpProfileActivity
 * after saveWeekLog. Cloud saveWeekLog wrote hours_logged rows and
 * moved on. Signed-in users logging daily saw the home-page greeting
 * ("It's been N days") drift ever-more-misleading because the field
 * powering it never got updated. Report: "It's been 3 days — a soft
 * restart" after logging every day for 4 weeks.
 *
 * The fix: fire an update on profiles.last_activity_at after the
 * hours_logged writes commit. Awaited (not fire-and-forget) — Supabase's
 * PostgrestBuilder only sends the request when its .then() fires, so a
 * discarded builder never hits the network.
 */

import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { CloudRepository } from '@ikigai/cloud-storage';
import { randomUUID } from 'node:crypto';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  throw new Error('log-bumps-activity spec requires cloud env vars');
}

const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function createUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'activity-bump-throwaway-1234',
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
    password: 'activity-bump-throwaway-1234',
  });
  if (error || !data.session) throw new Error(`signIn: ${error?.message}`);
  return client;
}

test.describe('saveWeekLog → profiles.last_activity_at bumped', () => {
  const email = `activity-${Date.now()}-${process.pid}@ikigai.test`;
  let userId = '';
  const planId = '2026-11-16';
  const domainId = randomUUID();
  const taskId = randomUUID();

  test.beforeAll(async () => {
    userId = await createUser(email);
    const staleIso = '2026-08-10T00:00:00.000Z';
    await admin.from('profiles').insert({
      user_id: userId,
      name: 'Activity Bump Test',
      // Deliberately old — proves the bump moved the field, not just
      // wrote the row.
      last_activity_at: staleIso,
      created_at: staleIso,
      updated_at: staleIso,
    });
    await admin.from('settings').insert({
      user_id: userId,
      week_start_day: 'monday',
      week_time_zone: 'America/Los_Angeles',
      profession_type: 'full_time_employee',
    });
    await admin.from('week_plans').insert({
      id: planId,
      user_id: userId,
      week_start_iso: '2026-11-16',
      week_end_iso: '2026-11-22',
      week_start_day: 'monday',
      week_time_zone: 'America/Los_Angeles',
      is_frozen: false,
    });
    await admin.from('week_domains').insert({
      id: domainId,
      user_id: userId,
      week_plan_id: planId,
      name: 'Sleep',
      color_key: 'blue',
      principle_id: 'contribution',
      position: 0,
    });
    await admin.from('week_tasks').insert({
      id: taskId,
      user_id: userId,
      week_plan_id: planId,
      week_domain_id: domainId,
      title: 'Sleep',
      planned_hours: 8,
      position: 0,
    });
  });

  test.afterAll(async () => {
    await deleteUser(userId);
  });

  test('logging hours advances last_activity_at to within seconds of now', async () => {
    const supabase = await clientAsUser(email);
    const repo = new CloudRepository(supabase);

    const beforeRow = await admin
      .from('profiles')
      .select('last_activity_at')
      .eq('user_id', userId)
      .single();
    const before = beforeRow.data?.last_activity_at as string;
    expect(before).toContain('2026-08-10');

    await repo.saveWeekLog({
      id: 'ignored',
      weekId: planId,
      dateISO: '2026-11-17',
      taskHours: { [taskId]: 8 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const afterRow = await admin
      .from('profiles')
      .select('last_activity_at')
      .eq('user_id', userId)
      .single();
    const after = new Date(
      afterRow.data?.last_activity_at as string,
    ).getTime();
    const now = Date.now();
    // Within 5s of "now" — accommodates network jitter but rules out
    // the pre-fix behavior (the stale 2026-08-10 timestamp would be
    // ~3 months from now).
    expect(Math.abs(now - after)).toBeLessThan(5_000);
  });

  test('logging all-zero hours still advances last_activity_at', async () => {
    // Regression for a gap in the first fix: saveWeekLog filters
    // taskHours down to entries with hours > 0 before doing any
    // hours_logged writes, and used to `return` early when that
    // filtered set was empty — which happens on a legitimate
    // end-week save where every task is logged as 0h (see README:
    // "End-week: log hours for all tasks, including zero"). The
    // early return skipped the activity bump below it too, so a
    // signed-in user whose habit includes 0h days never got credit
    // for showing up. The bump must run whenever saveWeekLog is
    // called with a non-empty taskHours, regardless of whether any
    // individual value is positive.
    const supabase = await clientAsUser(email);
    const repo = new CloudRepository(supabase);

    const staleIso = '2026-08-11T00:00:00.000Z';
    await admin
      .from('profiles')
      .update({ last_activity_at: staleIso })
      .eq('user_id', userId);

    const beforeRow = await admin
      .from('profiles')
      .select('last_activity_at')
      .eq('user_id', userId)
      .single();
    expect(beforeRow.data?.last_activity_at as string).toContain(
      '2026-08-11',
    );

    await repo.saveWeekLog({
      id: 'ignored',
      weekId: planId,
      dateISO: '2026-11-18',
      taskHours: { [taskId]: 0 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const afterRow = await admin
      .from('profiles')
      .select('last_activity_at')
      .eq('user_id', userId)
      .single();
    const after = new Date(
      afterRow.data?.last_activity_at as string,
    ).getTime();
    const now = Date.now();
    expect(Math.abs(now - after)).toBeLessThan(5_000);
  });
});
