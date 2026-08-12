/**
 * Migration network-retry.
 *
 * What this proves:
 *   1. A network-shaped failure mid-migration surfaces the yellow
 *      "reconnecting" pill instead of the red error banner.
 *   2. Restoring the network (unblocking the intercepted routes)
 *      followed by an `online` event causes the migration to
 *      auto-retry and complete.
 *   3. Because the migrator only sets its idempotency marker on
 *      successful completion, retries pick up where the earlier
 *      attempt left off; cloud-wins skips whatever already landed.
 *
 * Simulates the failure via `context.route` returning a network
 * abort for Supabase REST — mirrors the "flaky connection" flavor of
 * mid-migration failure the wrapper is meant to swallow.
 *
 * Depends on:
 *   - Local Supabase (`supabase start`), Mailpit at 54324.
 *   - Dev server on port 3724.
 */

import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mailpitBase = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

if (!url || !anonKey || !serviceKey) {
  throw new Error('migration-network-retry test requires cloud env vars');
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
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  return data.user.id;
}

async function deleteUser(id: string) {
  await admin.auth.admin.deleteUser(id).catch(() => {});
}

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

// Seed Dexie with a realistic pre-cloud user via raw IndexedDB. Same
// approach as `tests/cloud/local-to-cloud-migration.spec.ts`.
async function seedDexie(
  page: Page,
  payload: {
    profileName: string;
    weekStartISO: string;
    weekEndISO: string;
    domainName: string;
    taskTitle: string;
    taskHours: number;
  },
): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  await page.evaluate(async (p) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('ikigai');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const put = <T,>(store: string, value: T) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

    const nowIso = new Date().toISOString();
    const domainId = crypto.randomUUID();
    const taskId = crypto.randomUUID();

    await put('profiles', {
      id: crypto.randomUUID(),
      name: p.profileName,
      reflections: [],
      goals: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    await put('settings', {
      id: 'singleton',
      sleepHoursPerDay: 8,
      maintenanceHoursPerDay: 1,
      weeklyCapacityHours: 40,
      weeklyCapacityHoursDerived: 40,
      bufferPercent: 20,
      weekStartDay: 'monday',
      weekTimeZone: 'America/Los_Angeles',
      preferredTone: 'calm_spacious',
      professionType: 'full_time_employee',
      professionOtherText: null,
      hasJob: true,
      jobHoursPerWeek: 40,
      isStudent: false,
      classHoursPerWeek: 0,
      strictness: 'structured',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    await put('weekPlans', {
      id: p.weekStartISO,
      weekStartISO: p.weekStartISO,
      weekEndISO: p.weekEndISO,
      weekStartDay: 'monday',
      weekTimeZone: 'America/Los_Angeles',
      createdAtISO: nowIso,
      isFrozen: false,
      domains: [
        {
          id: domainId,
          name: p.domainName,
          colorKey: 'blue',
          plannedHours: p.taskHours,
          principleId: 'contribution',
          tasks: [
            { id: taskId, title: p.taskTitle, plannedHours: p.taskHours },
          ],
        },
      ],
      goals: [],
    });

    db.close();
  }, payload);
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

test.describe('migration network-retry', () => {
  const email = `mig-retry-${Date.now()}-${process.pid}@ikigai.test`;
  let userId = '';
  const weekStartISO = '2026-05-04';
  const weekEndISO = '2026-05-10';

  test.beforeAll(async () => {
    userId = await createUser(email);
  });

  test.afterAll(async () => {
    await admin.from('week_plans').delete().eq('user_id', userId);
    await admin.from('week_notes').delete().eq('user_id', userId);
    await admin.from('profiles').delete().eq('user_id', userId);
    await admin.from('settings').delete().eq('user_id', userId);
    await deleteUser(userId);
  });

  test('network failure mid-migration shows reconnecting pill; retry completes on unblock', async ({
    browser,
  }) => {
    test.setTimeout(120_000);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[m4]')) {
        // eslint-disable-next-line no-console
        console.log(`  browser: ${text}`);
      }
    });

    await seedDexie(page, {
      profileName: 'Retry User',
      weekStartISO,
      weekEndISO,
      domainName: 'Deep Work',
      taskTitle: 'Ship the retry fix',
      taskHours: 5,
    });

    // Block ALL Supabase REST calls to guarantee a network failure
    // once the migrator starts writing. Auth (magic link + code
    // verify) is served from /auth/v1/, unaffected.
    const supabaseHost = new URL(url!).host;
    let restBlocked = true;
    await ctx.route(`**://${supabaseHost}/rest/v1/**`, (route) => {
      if (restBlocked) {
        route.abort('failed');
      } else {
        route.continue();
      }
    });

    // Sign in. Migration starts, first cloud write fails with
    // net::ERR_FAILED, wrapper detects network shape → state moves to
    // network-waiting.
    await signInViaCodeFlow(page, email);

    await page.waitForSelector(
      '[data-testid="cloud-migration-network-waiting"]',
      { timeout: 15_000 },
    );

    // Explicit assertion: red error banner did NOT show.
    const errorCount = await page
      .locator('[data-testid="cloud-migration-error"]')
      .count();
    expect(errorCount).toBe(0);

    // Unblock REST, fire an `online` event — the network-waiting
    // effect should register both a listener AND a 30s poll; the
    // listener path is the fast one for a test.
    restBlocked = false;
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
    });

    // Migration re-attempts and completes.
    await page.waitForSelector('[data-testid="cloud-migration-done"]', {
      state: 'attached',
      timeout: 20_000,
    });

    // Cloud has the seeded data.
    const { data: profile } = await admin
      .from('profiles')
      .select('name')
      .eq('user_id', userId)
      .maybeSingle();
    expect(profile?.name).toBe('Retry User');

    const { data: plans } = await admin
      .from('week_plans')
      .select('id')
      .eq('user_id', userId);
    expect(plans?.length).toBe(1);

    await ctx.close();
  });
});
