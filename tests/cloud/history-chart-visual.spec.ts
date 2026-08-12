/**
 * Visual regression: the "Weekly time series" chart's green "has logs"
 * band must not overflow its container.
 *
 * Reproduces the exact case that surfaced the bug (2-point series):
 * seed two consecutive weeks of plan data, one with logs, sign in,
 * open /history, capture a screenshot, and assert the SVG's bounding
 * box sits inside the surrounding chart container.
 *
 * Also produces artifacts/history-chart.png for eyeballing the
 * result outside CI.
 */

import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mailpitBase = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

if (!url || !anonKey || !serviceKey) {
  throw new Error('history chart visual spec requires cloud env vars');
}

const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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
        const detail = (await (
          await fetch(`${mailpitBase}/api/v1/message/${candidate.ID}`)
        ).json()) as { HTML?: string; Text?: string };
        const match = `${detail.HTML ?? ''}\n${detail.Text ?? ''}`.match(
          /\b(\d{6})\b/,
        );
        if (match) return match[1];
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for OTP email to ${to}`);
}

async function signInViaCodeFlow(page: Page, email: string): Promise<void> {
  const startedAt = Date.now();
  await page.goto('/login');
  await page.waitForSelector('[data-testid="login-page"]');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-send-link').click();
  await page.waitForSelector('[data-testid="login-sent"]', { timeout: 15_000 });
  const code = await waitForOtpCode(email, startedAt);
  await page.getByTestId('login-code-token').fill(code);
  await page.getByTestId('login-verify-code').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
    timeout: 15_000,
  });
}

async function createUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'history-chart-throwaway-1234',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  return data.user.id;
}

async function deleteUser(id: string) {
  await admin.auth.admin.deleteUser(id).catch(() => {});
}

test.describe('history — Weekly time series chart layout', () => {
  const email = `history-chart-${Date.now()}-${process.pid}@ikigai.test`;
  let userId = '';

  test.beforeAll(async () => {
    userId = await createUser(email);
    const nowIso = new Date().toISOString();

    // Two consecutive weeks so the chart renders exactly the 2-point
    // series that triggered the green-overflow bug.
    await admin.from('profiles').insert({
      user_id: userId,
      name: 'Chart Visual Test',
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

    const domainId = randomUUID();
    const taskId = randomUUID();
    for (const [planId, startIso, endIso] of [
      ['week-a', '2026-07-27', '2026-08-02'],
      ['week-b', '2026-08-03', '2026-08-09'],
    ]) {
      await admin.from('week_plans').insert({
        id: planId,
        user_id: userId,
        week_start_iso: startIso,
        week_end_iso: endIso,
        week_start_day: 'monday',
        week_time_zone: 'America/Los_Angeles',
        is_frozen: false,
        created_at: nowIso,
        updated_at: nowIso,
      });
      const dId = randomUUID();
      const tId = randomUUID();
      await admin.from('week_domains').insert({
        id: dId,
        user_id: userId,
        week_plan_id: planId,
        name: 'Deep Work',
        color_key: 'blue',
        principle_id: 'contribution',
        position: 0,
      });
      await admin.from('week_tasks').insert({
        id: tId,
        user_id: userId,
        week_plan_id: planId,
        week_domain_id: dId,
        title: 'Ship the fix',
        planned_hours: 8,
        position: 0,
      });
      // Only week-b gets logs, so `hasLogs` differs across the 2
      // points → the green band shows on the right-most column, the
      // exact spot where it used to overflow.
      if (planId === 'week-b') {
        await admin.from('hours_logged').insert({
          id: randomUUID(),
          user_id: userId,
          task_id: tId,
          week_plan_id: planId,
          date_iso: startIso,
          hours: 3,
        });
      }
    }
  });

  test.afterAll(async () => {
    await deleteUser(userId);
  });

  test('green "Has logs" band stays inside the chart container', async ({
    browser,
  }) => {
    test.setTimeout(60_000);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // Sign in via the same OTP-via-Mailpit path other specs use so
    // the cookie the middleware needs is set the normal way.
    await signInViaCodeFlow(page, email);
    await page.goto('/history');

    // The /history page loads plans + logs via cloud repo → wait for
    // the chart's outer container to render.
    const chartSvg = page.locator('svg[aria-label="Planned vs completed hours by week"]');
    await chartSvg.waitFor({ timeout: 15_000 });

    // Grab bounding boxes for the SVG and its immediate rounded-panel
    // container. Assert every child rect (including the green "has
    // logs" band) sits inside the SVG's own reported viewBox width.
    const svgBox = await chartSvg.boundingBox();
    const container = chartSvg.locator('..');
    const containerBox = await container.boundingBox();
    expect(svgBox).not.toBeNull();
    expect(containerBox).not.toBeNull();
    if (!svgBox || !containerBox) return;

    // The SVG itself must not extend past its container's right edge.
    expect(svgBox.x + svgBox.width).toBeLessThanOrEqual(
      containerBox.x + containerBox.width + 1, // 1px tolerance for anti-alias
    );

    // Screenshot for eyeball verification.
    await chartSvg.screenshot({ path: 'test-results/history-chart.png' });

    await ctx.close();
  });
});
