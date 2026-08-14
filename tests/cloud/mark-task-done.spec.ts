/**
 * Regression: mark task done from the log form.
 *
 * Two invariants:
 *   - Toggling the ✓ checkbox writes `week_tasks.completed_at` to
 *     the current timestamp (or null when unchecking) and does NOT
 *     insert an hours_logged row. Completion and time-tracking are
 *     independent.
 *   - Saving a plan carries the field through — a re-fetch returns
 *     the same completedAt.
 */

import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { CloudRepository } from '@ikigai/cloud-storage';
import type { WeekPlan } from '@ikigai/core';
import { randomUUID } from 'node:crypto';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  throw new Error('mark-task-done spec requires cloud env vars');
}

const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function createUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'mark-done-throwaway-1234',
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
    password: 'mark-done-throwaway-1234',
  });
  if (error || !data.session) throw new Error(`signIn: ${error?.message}`);
  return client;
}

test.describe('week_tasks.completed_at — round-trips through saveWeekPlan', () => {
  const email = `mark-done-${Date.now()}-${process.pid}@ikigai.test`;
  let userId = '';
  const planId = '2026-11-02';
  const domainId = randomUUID();
  const taskId = randomUUID();

  const basePlan: WeekPlan = {
    id: planId,
    weekStartISO: '2026-11-02',
    weekEndISO: '2026-11-08',
    weekStartDay: 'monday',
    weekTimeZone: 'America/Los_Angeles',
    createdAtISO: new Date().toISOString(),
    isFrozen: false,
    domains: [
      {
        id: domainId,
        name: 'Health',
        colorKey: 'green',
        plannedHours: 4,
        principleId: 'contribution',
        tasks: [{ id: taskId, title: 'Yoga', plannedHours: 4 }],
      },
    ],
    goals: [],
  };

  test.beforeAll(async () => {
    userId = await createUser(email);
    const nowIso = new Date().toISOString();
    await admin.from('profiles').insert({
      user_id: userId,
      name: 'Mark Done Test',
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
  });

  test.afterAll(async () => {
    await deleteUser(userId);
  });

  test('saveWeekPlan writes completedAt and re-fetch returns it', async () => {
    const supabase = await clientAsUser(email);
    const repo = new CloudRepository(supabase);

    // Initial save — completedAt undefined.
    await repo.saveWeekPlan(basePlan);
    let row = await admin
      .from('week_tasks')
      .select('completed_at')
      .eq('id', taskId)
      .single();
    expect(row.data?.completed_at).toBeNull();

    // Mark done.
    const doneIso = new Date().toISOString();
    await repo.saveWeekPlan({
      ...basePlan,
      domains: [
        {
          ...basePlan.domains[0],
          tasks: [{ ...basePlan.domains[0].tasks[0], completedAt: doneIso }],
        },
      ],
    });
    row = await admin
      .from('week_tasks')
      .select('completed_at')
      .eq('id', taskId)
      .single();
    // Postgres normalizes tz — assert the field is set + within 1s of doneIso.
    expect(row.data?.completed_at).toBeTruthy();
    const stored = new Date(row.data?.completed_at as string).getTime();
    expect(Math.abs(stored - new Date(doneIso).getTime())).toBeLessThan(1000);

    // Re-fetch through the repo — task carries completedAt back.
    const fetched = await repo.getWeekPlan(basePlan.weekStartISO);
    expect(fetched?.domains[0].tasks[0].completedAt).toBeTruthy();

    // Un-mark: set completedAt = null.
    await repo.saveWeekPlan({
      ...basePlan,
      domains: [
        {
          ...basePlan.domains[0],
          tasks: [{ ...basePlan.domains[0].tasks[0], completedAt: null }],
        },
      ],
    });
    row = await admin
      .from('week_tasks')
      .select('completed_at')
      .eq('id', taskId)
      .single();
    expect(row.data?.completed_at).toBeNull();
  });

  test('marking done does NOT create an hours_logged row', async () => {
    // Sanity: after all the round-tripping above, no hours have been
    // logged. Independence of completion from time-tracking is the
    // whole point of a separate column.
    const rows = await admin
      .from('hours_logged')
      .select('id')
      .eq('user_id', userId)
      .eq('task_id', taskId);
    expect(rows.data?.length).toBe(0);
  });
});
