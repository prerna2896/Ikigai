/**
 * M2.2 + M2.3 verification — cloud sync end-to-end.
 *
 * What this proves:
 *   1. A signed-in user with a cloud profile can hit /week/plan and
 *      the app auto-creates a WeekPlan into week_plans + week_domains
 *      without erroring out. This is the exact bug M2.3 tripped on
 *      when week_plans.id was uuid but the app supplied weekStartISO
 *      as text.
 *   2. Signing in as the same user in a *fresh* browser context
 *      surfaces the profile + settings + week plan from cloud
 *      (cross-device sync works — no dependency on the first context's
 *      Dexie or cookies).
 *   3. Error messages don't leak "[object Object]" through the UI.
 *
 * Setup shortcut: we seed the user's profile + settings via admin API
 * rather than driving the onboarding UI. That flow is exercised by
 * separate onboarding tests. Here we focus on the M2.3 delta.
 *
 * Auth is driven through the real /login UI (email + 6-digit code
 * pulled from the local Mailpit inbox).
 *
 * Assumes local Supabase (`supabase start`) and dev on port 3724.
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mailpitBase = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

if (!url || !anonKey || !serviceKey) {
  throw new Error(
    'Cloud tests require NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY',
  );
}

const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function createUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password: `random-${crypto.randomUUID()}`,
  });
  if (error || !data.user) {
    throw new Error(`createUser: ${error?.message}`);
  }
  return data.user.id;
}

async function deleteUser(id: string) {
  await admin.auth.admin.deleteUser(id).catch(() => {});
}

async function seedProfileAndSettings(userId: string, name: string) {
  const now = new Date().toISOString();
  const { error: pErr } = await admin.from('profiles').upsert(
    { user_id: userId, name, created_at: now, updated_at: now },
    { onConflict: 'user_id' },
  );
  if (pErr) throw pErr;

  const { error: sErr } = await admin.from('settings').upsert(
    {
      user_id: userId,
      sleep_hours_per_day: 8,
      maintenance_hours_per_day: 1,
      weekly_capacity_hours: 40,
      weekly_capacity_hours_derived: 40,
      buffer_percent: 20,
      week_start_day: 'monday',
      week_time_zone: 'America/Los_Angeles',
      preferred_tone: 'calm_spacious',
      profession_type: 'full_time_employee',
      has_job: true,
      job_hours_per_week: 40,
      is_student: false,
      class_hours_per_week: 0,
      strictness: 'structured',
      created_at: now,
      updated_at: now,
    },
    { onConflict: 'user_id' },
  );
  if (sErr) throw sErr;
}

/**
 * Poll Mailpit until an email addressed to `to` arrives that was sent
 * after `since`. Extract the 6-digit token from its body.
 */
async function waitForOtpCode(
  to: string,
  since: number,
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${mailpitBase}/api/v1/messages`);
    if (res.ok) {
      const list = (await res.json()) as {
        messages?: Array<{
          ID: string;
          To?: Array<{ Address?: string }>;
          Created?: string;
        }>;
      };
      const candidate = (list.messages ?? []).find((m) => {
        const created = m.Created ? Date.parse(m.Created) : 0;
        return (
          created >= since &&
          (m.To ?? []).some(
            (t) => t.Address?.toLowerCase() === to.toLowerCase(),
          )
        );
      });
      if (candidate) {
        const detailRes = await fetch(
          `${mailpitBase}/api/v1/message/${candidate.ID}`,
        );
        if (detailRes.ok) {
          const detail = (await detailRes.json()) as {
            HTML?: string;
            Text?: string;
          };
          const body = `${detail.HTML ?? ''}\n${detail.Text ?? ''}`;
          const match = body.match(/\b(\d{6})\b/);
          if (match) return match[1];
        }
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for OTP email to ${to}`);
}

async function signInViaCodeFlow(
  page: Page,
  email: string,
): Promise<void> {
  const startedAt = Date.now();
  await page.goto('/login');
  await page.waitForSelector('[data-testid="login-page"]');

  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-send-link').click();

  await page.waitForSelector('[data-testid="login-sent"]', {
    timeout: 15_000,
  });

  const code = await waitForOtpCode(email, startedAt);
  await page.getByTestId('login-code-token').fill(code);
  await page.getByTestId('login-verify-code').click();

  await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
    timeout: 15_000,
  });
}

test.describe('cloud sync — planner + cross-device', () => {
  const email = `cloud-e2e-${Date.now()}-${process.pid}@ikigai.test`;
  const displayName = 'Cloud E2E User';
  let userId = '';

  test.beforeAll(async () => {
    userId = await createUser(email);
    await seedProfileAndSettings(userId, displayName);
  });

  test.afterAll(async () => {
    await admin.from('week_plans').delete().eq('user_id', userId);
    await admin.from('week_notes').delete().eq('user_id', userId);
    await admin.from('profiles').delete().eq('user_id', userId);
    await admin.from('settings').delete().eq('user_id', userId);
    await deleteUser(userId);
  });

  test('signed-in user lands on planner, plan persists to cloud, second context sees it', async ({
    browser,
  }) => {
    test.setTimeout(90_000);

    // ─── Browser A: navigate to planner, force a plan create ───────────
    const ctxA: BrowserContext = await browser.newContext();
    const pageA = await ctxA.newPage();
    await signInViaCodeFlow(pageA, email);

    await pageA.goto('/week/plan');
    await pageA.waitForSelector('[data-testid="planning-page"]', {
      timeout: 15_000,
    });
    // The task-list rendering only fires after weekPlan state is
    // populated, which is after the auto-create save resolves. Wait
    // for that so the cloud query below doesn't race the save.
    await pageA.waitForSelector('[data-testid="plan-empty-state"], [data-testid="week-plot"]', {
      timeout: 15_000,
    });

    // No [object Object] error banner. This asserts the M2.3 bug is
    // fixed (week_plans.id text vs uuid mismatch used to surface here).
    const bodyTextA = await pageA.locator('body').innerText();
    expect(bodyTextA).not.toContain('[object Object]');

    // ─── Assert the plan landed in cloud ────────────────────────────────
    // Poll briefly: even after the empty-state renders, the persistPlan
    // completion may still be flushing. Give it up to 5s.
    let planRows: Array<{ id: string; user_id: string; week_start_iso: string }> | null = null;
    for (let i = 0; i < 25; i += 1) {
      const res = await admin
        .from('week_plans')
        .select('id, user_id, week_start_iso')
        .eq('user_id', userId);
      if ((res.data?.length ?? 0) > 0) {
        planRows = res.data as typeof planRows;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    // Second, definitive check for the assertion machinery.
    const { data: planRowsFinal, error: planErr } = await admin
      .from('week_plans')
      .select('id, user_id, week_start_iso')
      .eq('user_id', userId);
    planRows = planRowsFinal ?? planRows;
    expect(planErr).toBeNull();
    expect(planRows?.length ?? 0).toBeGreaterThan(0);
    const plan = planRows![0];
    // plan.id is the weekStartISO (text column, not uuid).
    expect(plan.id).toBe(plan.week_start_iso);

    const { data: domainRows, error: domErr } = await admin
      .from('week_domains')
      .select('id, name')
      .eq('user_id', userId);
    expect(domErr).toBeNull();
    // createDefaultWeekPlan seeds 7 default domains.
    expect(domainRows?.length).toBe(7);

    // ─── Browser B: fresh context, same email, sees the plan ─────────────
    const ctxB: BrowserContext = await browser.newContext();
    const pageB = await ctxB.newPage();
    await signInViaCodeFlow(pageB, email);

    await pageB.goto('/');
    await pageB.waitForSelector('[data-testid="home-page"]');

    // Home page greeting includes the seeded name from cloud. The app
    // uses only the first word of the profile name in the greeting.
    const firstName = displayName.split(' ')[0];
    await expect(pageB.locator('h1').first()).toContainText(firstName);

    await pageB.goto('/week/plan');
    await pageB.waitForSelector('[data-testid="planning-page"]', {
      timeout: 15_000,
    });

    // No [object Object] on the second context either.
    const bodyTextB = await pageB.locator('body').innerText();
    expect(bodyTextB).not.toContain('[object Object]');

    // Cloud state: still exactly one plan (Browser B didn't duplicate
    // it — the middleware auto-loaded the existing one instead).
    const { data: planRowsAfter } = await admin
      .from('week_plans')
      .select('id')
      .eq('user_id', userId);
    expect(planRowsAfter?.length).toBe(1);

    await ctxA.close();
    await ctxB.close();
  });
});
