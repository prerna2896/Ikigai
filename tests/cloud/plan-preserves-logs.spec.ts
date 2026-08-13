/**
 * Regression: CloudRepository.saveWeekPlan must NOT wipe hours_logged
 * for unchanged tasks.
 *
 * The bug:
 *   saveWeekPlan used to DELETE FROM week_domains WHERE week_plan_id = X
 *   and let the FK cascade sweep week_tasks. But hours_logged.task_id
 *   has ON DELETE CASCADE to week_tasks, so wiping the domains also
 *   destroyed every logged hour under that plan.
 *
 *   Real-world symptom users hit: log 16h of sleep + 1h of some other
 *   task, then add an unplanned task via the log UI (which persists a
 *   new task via saveWeekPlan) → every previously-logged hour resets
 *   to zero.
 *
 * The fix (this spec verifies):
 *   saveWeekPlan upserts child rows (domains, tasks, goals) on `id`
 *   and only DELETEs rows whose ids are missing from the incoming
 *   plan. Existing task rows survive → their hours_logged rows are
 *   never cascade-deleted.
 *
 * Depends on: local Supabase, dev server on 3724.
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
  throw new Error('plan-preserves-logs spec requires cloud env vars');
}

const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function createUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'plan-preserves-throwaway-1234',
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
    password: 'plan-preserves-throwaway-1234',
  });
  if (error || !data.session)
    throw new Error(`signIn: ${error?.message}`);
  return client;
}

test.describe('CloudRepository.saveWeekPlan — preserves hours_logged for unchanged tasks', () => {
  const email = `plan-logs-${Date.now()}-${process.pid}@ikigai.test`;
  let userId = '';
  const weekPlanId = '2026-10-05';
  const weekStartIso = '2026-10-05';
  const weekEndIso = '2026-10-11';
  const dateIso = '2026-10-06';
  const domainId = randomUUID();
  const sleepTaskId = randomUUID();
  const focusTaskId = randomUUID();

  const initialPlan: WeekPlan = {
    id: weekPlanId,
    weekStartISO: weekStartIso,
    weekEndISO: weekEndIso,
    weekStartDay: 'monday',
    weekTimeZone: 'America/Los_Angeles',
    createdAtISO: new Date().toISOString(),
    isFrozen: false,
    domains: [
      {
        id: domainId,
        name: 'Foundations',
        colorKey: 'blue',
        plannedHours: 12,
        principleId: 'contribution',
        tasks: [
          { id: sleepTaskId, title: 'Sleep', plannedHours: 8 },
          { id: focusTaskId, title: 'Focus', plannedHours: 4 },
        ],
      },
    ],
    goals: [],
  };

  test.beforeAll(async () => {
    userId = await createUser(email);
    const nowIso = new Date().toISOString();
    await admin.from('profiles').insert({
      user_id: userId,
      name: 'Plan Preserves Logs Test',
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

  test('adding a new task to the plan does NOT wipe existing hours_logged rows', async () => {
    const supabase = await clientAsUser(email);
    const repo = new CloudRepository(supabase);

    // Step 1: create the plan with two tasks (sleep, focus).
    await repo.saveWeekPlan(initialPlan);

    // Step 2: log hours against both tasks.
    await repo.saveWeekLog({
      id: 'ignored-1',
      weekId: weekPlanId,
      dateISO: dateIso,
      taskHours: {
        [sleepTaskId]: 16,
        [focusTaskId]: 2,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Sanity: two hours_logged rows exist.
    let logRows = await admin
      .from('hours_logged')
      .select('task_id, hours')
      .eq('user_id', userId)
      .eq('week_plan_id', weekPlanId);
    expect(logRows.data?.length).toBe(2);

    // Step 3: mutate the plan — add an unplanned task via the same
    // pattern LogPanel uses (add a new task under the existing domain
    // and saveWeekPlan). This is the exact call sequence that used to
    // wipe every log via the cascade chain.
    const newTaskId = randomUUID();
    const mutatedPlan: WeekPlan = {
      ...initialPlan,
      domains: [
        {
          ...initialPlan.domains[0],
          tasks: [
            ...initialPlan.domains[0].tasks,
            { id: newTaskId, title: 'Unplanned: walk', plannedHours: 0 },
          ],
        },
      ],
    };
    await repo.saveWeekPlan(mutatedPlan);

    // ─── The critical assertion ─────────────────────────────────────
    // Both original log rows must survive the plan save. Pre-fix,
    // this would return 0 rows because the domain-delete cascade
    // wiped week_tasks which cascaded to hours_logged.
    logRows = await admin
      .from('hours_logged')
      .select('task_id, hours')
      .eq('user_id', userId)
      .eq('week_plan_id', weekPlanId);
    expect(logRows.data?.length).toBe(2);

    const byTask = new Map<string, number>();
    for (const row of logRows.data ?? []) {
      byTask.set(row.task_id as string, Number(row.hours));
    }
    expect(byTask.get(sleepTaskId)).toBe(16);
    expect(byTask.get(focusTaskId)).toBe(2);

    // The new task exists in week_tasks (proves upsert path fired).
    const taskRow = await admin
      .from('week_tasks')
      .select('title')
      .eq('id', newTaskId)
      .maybeSingle();
    expect(taskRow.data?.title).toBe('Unplanned: walk');
  });

  test('removing a task from the plan DOES purge its hours_logged (via cascade on delete-missing)', async () => {
    // Use a fresh plan to avoid interference. Same domain, one task.
    const secondPlanId = '2026-10-12';
    const domain2Id = randomUUID();
    const taskAId = randomUUID();
    const taskBId = randomUUID();
    const supabase = await clientAsUser(email);
    const repo = new CloudRepository(supabase);

    const planWithTwo: WeekPlan = {
      id: secondPlanId,
      weekStartISO: '2026-10-12',
      weekEndISO: '2026-10-18',
      weekStartDay: 'monday',
      weekTimeZone: 'America/Los_Angeles',
      createdAtISO: new Date().toISOString(),
      isFrozen: false,
      domains: [
        {
          id: domain2Id,
          name: 'Foundations',
          colorKey: 'blue',
          plannedHours: 5,
          principleId: 'contribution',
          tasks: [
            { id: taskAId, title: 'Kept task', plannedHours: 3 },
            { id: taskBId, title: 'Removed task', plannedHours: 2 },
          ],
        },
      ],
      goals: [],
    };
    await repo.saveWeekPlan(planWithTwo);

    // Log against both.
    await repo.saveWeekLog({
      id: 'ignored-2',
      weekId: secondPlanId,
      dateISO: '2026-10-12',
      taskHours: { [taskAId]: 1, [taskBId]: 1 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Now save a plan without taskB — user removed it from the plan.
    const planWithOne: WeekPlan = {
      ...planWithTwo,
      domains: [
        {
          ...planWithTwo.domains[0],
          tasks: planWithTwo.domains[0].tasks.filter((t) => t.id !== taskBId),
        },
      ],
    };
    await repo.saveWeekPlan(planWithOne);

    // taskA's log survives (unchanged task).
    const remaining = await admin
      .from('hours_logged')
      .select('task_id')
      .eq('user_id', userId)
      .eq('week_plan_id', secondPlanId);
    const ids = remaining.data?.map((r) => r.task_id as string) ?? [];
    expect(ids).toContain(taskAId);
    // taskB's log is gone (correct behavior — the task itself was
    // deleted, so its hours_logged rows should cascade).
    expect(ids).not.toContain(taskBId);
  });
});
