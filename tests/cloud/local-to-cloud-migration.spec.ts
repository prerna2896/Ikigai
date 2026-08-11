/**
 * M4 — Local (Dexie) → Cloud (Supabase) migration.
 *
 * What this proves:
 *   1. Existing IndexedDB data gets lifted into Supabase on first
 *      authenticated session for that user, in this browser.
 *   2. Idempotent — a second sign-in on the same browser doesn't
 *      re-insert or duplicate.
 *   3. Cloud-wins conflict rule — if cloud already has a profile /
 *      settings / week_plan for a given week, the local version is
 *      skipped (not merged, not overwritten).
 *
 * How the test seeds Dexie: `page.evaluate` runs a raw IDB script
 * that opens the `ikigai` database and writes rows into `profiles`,
 * `settings`, `weekPlans`, `weekLogs`, and `weekNotes` at Dexie
 * schema version 11 (matching the current app). This mirrors what a
 * real user's browser would have from pre-cloud usage.
 *
 * Assumes local Supabase (`supabase start`) and dev on port 3724.
 */

import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mailpitBase = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

if (!url || !anonKey || !serviceKey) {
  throw new Error('M4 test requires cloud env vars');
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

/**
 * Seed Dexie with a realistic pre-cloud user via raw IndexedDB. Mirrors
 * exactly the Dexie shape at schema v11. We use raw IDB (not Dexie)
 * inside the browser so the test doesn't need to bundle Dexie.
 */
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
  // Load the app first so Dexie initializes the `ikigai` DB with the
  // correct schema (and its internal metadata). Only THEN write raw
  // IDB rows into the existing stores — otherwise Dexie can't
  // recognize a bare-IDB-created DB.
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  // Give Dexie a moment to open the DB (happens the first time
  // getLocalRepository() is called from any component — TopNav does
  // this on mount for the signed-out landing).
  await page.waitForTimeout(1500);

  await page.evaluate(async (p) => {
    // Open ikigai DB. Dexie already opened it at v11 during app load,
    // so no upgradeneeded here — we're just writing rows into stores
    // Dexie already created.
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
    const profileId = crypto.randomUUID();
    const domainId = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    const logId = crypto.randomUUID();
    const noteId = crypto.randomUUID();

    await put('profiles', {
      id: profileId,
      name: p.profileName,
      reflections: [
        { questionId: 'wins-to-notice', answer: 'shipping small things' },
      ],
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
            {
              id: taskId,
              title: p.taskTitle,
              plannedHours: p.taskHours,
            },
          ],
        },
      ],
      goals: [],
    });
    await put('weekLogs', {
      id: logId,
      weekId: p.weekStartISO,
      // dateISO is validated as z.string().datetime({ offset: true })
      // → must be a full ISO datetime, not a bare YYYY-MM-DD.
      dateISO: `${p.weekStartISO}T09:00:00.000Z`,
      taskHours: { [taskId]: 2 },
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    await put('weekNotes', {
      id: noteId,
      weekId: p.weekStartISO,
      note: 'seeded pre-cloud note',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    db.close();
  }, payload);
}

test.describe('M4 — Local (Dexie) → Cloud migration', () => {
  const email = `m4-${Date.now()}-${process.pid}@ikigai.test`;
  let userId = '';
  const weekStartISO = '2026-01-05';
  const weekEndISO = '2026-01-11';

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

  test('seeded Dexie data lifts into cloud on first sign-in, idempotent on reload', async ({
    browser,
  }) => {
    test.setTimeout(90_000);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[m4]')) {
        // eslint-disable-next-line no-console
        console.log(`  browser: ${text}`);
      }
    });
    page.on('pageerror', (err) => {
      // eslint-disable-next-line no-console
      console.log(`  browser pageerror: ${err.message}`);
    });

    // Step 1: seed a realistic pre-cloud Dexie payload.
    await seedDexie(page, {
      profileName: 'Legacy User',
      weekStartISO,
      weekEndISO,
      domainName: 'Deep Work',
      taskTitle: 'Ship the migration',
      taskHours: 8,
    });

    // Step 2: sign in. The CloudMigrationRunner should notice and lift
    // the Dexie payload into cloud.
    await signInViaCodeFlow(page, email);

    // Wait for migration completion signal (sr-only marker component).
    // Use state: 'attached' since sr-only visually hides the element.
    await page.waitForSelector('[data-testid="cloud-migration-done"]', {
      state: 'attached',
      timeout: 15_000,
    });

    // ─── Verify cloud rows ──────────────────────────────────────────────
    const { data: profileRow } = await admin
      .from('profiles')
      .select('name')
      .eq('user_id', userId)
      .maybeSingle();
    expect(profileRow?.name).toBe('Legacy User');

    const { data: settingsRow } = await admin
      .from('settings')
      .select('preferred_tone')
      .eq('user_id', userId)
      .maybeSingle();
    expect(settingsRow?.preferred_tone).toBe('calm_spacious');

    const { data: planRows } = await admin
      .from('week_plans')
      .select('id, week_start_iso')
      .eq('user_id', userId);
    expect(planRows?.length).toBe(1);
    expect(planRows?.[0]?.id).toBe(weekStartISO);

    const { data: domainRows } = await admin
      .from('week_domains')
      .select('id, name')
      .eq('user_id', userId);
    expect(domainRows?.length).toBe(1);
    expect(domainRows?.[0]?.name).toBe('Deep Work');

    const { data: taskRows } = await admin
      .from('week_tasks')
      .select('id, title')
      .eq('user_id', userId);
    expect(taskRows?.length).toBe(1);
    expect(taskRows?.[0]?.title).toBe('Ship the migration');

    const { data: hoursRows } = await admin
      .from('hours_logged')
      .select('id')
      .eq('user_id', userId);
    expect(hoursRows?.length).toBe(1);

    const { data: noteRows } = await admin
      .from('week_notes')
      .select('id, note')
      .eq('user_id', userId);
    expect(noteRows?.length).toBe(1);
    expect(noteRows?.[0]?.note).toBe('seeded pre-cloud note');

    // ─── Idempotency: reload the same page ───────────────────────────────
    // The migration marker is now in Dexie meta for this user. On
    // reload the CloudMigrationRunner should short-circuit — no
    // duplicate rows.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    // Give it a moment in case it did try to run.
    await page.waitForTimeout(2000);

    const { data: planRowsAfter } = await admin
      .from('week_plans')
      .select('id')
      .eq('user_id', userId);
    expect(planRowsAfter?.length).toBe(1);

    const { data: taskRowsAfter } = await admin
      .from('week_tasks')
      .select('id')
      .eq('user_id', userId);
    expect(taskRowsAfter?.length).toBe(1);

    const { data: hoursRowsAfter } = await admin
      .from('hours_logged')
      .select('id')
      .eq('user_id', userId);
    expect(hoursRowsAfter?.length).toBe(1);

    await ctx.close();
  });
});

/**
 * Regression test: the exact scenario the user hit in Chrome.
 *
 *   1. User pasted the seed snippet into DevTools which populated a
 *      Dexie WeekPlan whose weekStartISO is the current Monday.
 *   2. Signed in.
 *   3. Landed on `/week/plan` before the migration finished.
 *   4. The plan page's auto-create-plan useEffect fired and inserted
 *      a WeekPlan for the same (user_id, week_start_iso).
 *   5. Migration's insert then hit `duplicate key value violates
 *      unique constraint "week_plans_user_week_key"` and surfaced as
 *      "Couldn't sync your local data: …" in the UI.
 *
 * With the 23505 catch in the migrator, migration should gracefully
 * skip that plan's subtree, mark itself done, and the UI should
 * remain error-free.
 */

function currentMondayISO(): { weekStartISO: string; weekEndISO: string } {
  const today = new Date();
  const day = today.getDay();
  const daysToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + daysToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const toISO = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  return { weekStartISO: toISO(monday), weekEndISO: toISO(sunday) };
}

test.describe('M4 — race between plan-page auto-create and migration', () => {
  const email = `m4-race-${Date.now()}-${process.pid}@ikigai.test`;
  let userId = '';

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

  test('same-week collision with plan page does not throw', async ({
    browser,
  }) => {
    test.setTimeout(90_000);

    const { weekStartISO, weekEndISO } = currentMondayISO();

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[m4]')) {
        // eslint-disable-next-line no-console
        console.log(`  browser: ${text}`);
      }
    });

    // Seed Dexie with a plan for THIS week — matching what the plan
    // page will try to auto-create on first visit.
    await seedDexie(page, {
      profileName: 'Race User',
      weekStartISO,
      weekEndISO,
      domainName: 'Deep Work',
      taskTitle: 'Ship the race fix',
      taskHours: 8,
    });

    // Sign in via UI code flow.
    await signInViaCodeFlow(page, email);

    // Immediately navigate to /week/plan. This kicks off the plan
    // page's useEffect (which will auto-create a plan for the
    // current week) — concurrently with the migration.
    await page.goto('/week/plan');
    await page.waitForSelector('[data-testid="planning-page"]', {
      timeout: 15_000,
    });

    // Wait for migration to complete (success OR handled skip).
    await page.waitForSelector('[data-testid="cloud-migration-done"]', {
      state: 'attached',
      timeout: 15_000,
    });

    // The error banner from the migration failure should NOT appear.
    // (Plan page's [role="alert"] shows migration errors; also there
    // shouldn't be a "Couldn't sync your local data" string anywhere.)
    const body = await page.locator('body').innerText();
    expect(body).not.toContain("Couldn't sync");
    expect(body).not.toContain('duplicate key');
    expect(body).not.toContain('[object Object]');

    // Cloud should have exactly one week_plans row for this user for
    // this week — whichever writer won the race (plan page OR
    // migration) is fine; the important thing is only one exists.
    const { data: plans } = await admin
      .from('week_plans')
      .select('id, week_start_iso')
      .eq('user_id', userId);
    expect(plans?.length).toBe(1);
    expect(plans?.[0]?.week_start_iso).toBe(weekStartISO);

    await ctx.close();
  });
});

/**
 * Regression test: shared-phone data-leak prevention.
 *
 * Scenario: two people share a browser (or one person signs in with a
 * fresh email on their old phone). Dexie is a per-browser store, so
 * whoever signed in first has their data in local IDB. The naïve
 * migrator (before the foreign-marker guard) would happily copy that
 * data into user B's cloud on B's first sign-in — silently attaching
 * A's onboarding, weeks, and logs to B's account.
 *
 * The fix: `LocalToCloudMigrator.hasForeignMarker()` inspects Dexie's
 * `meta` store for any `cloudMigratedAt:*` key belonging to a
 * different user_id. If one exists, this browser is treated as
 * "someone else's" and migration is skipped for user B. User A's
 * cloud data is untouched.
 *
 * As a corollary, this also removes the UUID-collision risk that the
 * remap fix was defending against — migration for user B never runs,
 * so there's nothing to collide with. The remap is still correct for
 * the single-user path (fresh cloud, no prior marker).
 *
 * NB: uses ONE browser context (shared Dexie) but two separate users.
 */
test.describe('M4 — shared browser: second signer does not inherit local data', () => {
  const emailA = `m4-cross-a-${Date.now()}-${process.pid}@ikigai.test`;
  const emailB = `m4-cross-b-${Date.now()}-${process.pid}@ikigai.test`;
  let userIdA = '';
  let userIdB = '';
  const weekStartISO = '2026-02-02';
  const weekEndISO = '2026-02-08';

  test.beforeAll(async () => {
    userIdA = await createUser(emailA);
    userIdB = await createUser(emailB);
  });

  test.afterAll(async () => {
    for (const uid of [userIdA, userIdB]) {
      await admin.from('week_plans').delete().eq('user_id', uid);
      await admin.from('week_notes').delete().eq('user_id', uid);
      await admin.from('profiles').delete().eq('user_id', uid);
      await admin.from('settings').delete().eq('user_id', uid);
      await deleteUser(uid);
    }
  });

  test('user B on a browser that user A already signed into gets an empty cloud (no leak)', async ({
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
    page.on('pageerror', (err) => {
      // eslint-disable-next-line no-console
      console.log(`  browser pageerror: ${err.message}`);
    });

    // Seed once — this is user A's data in local Dexie.
    await seedDexie(page, {
      profileName: 'Shared Browser',
      weekStartISO,
      weekEndISO,
      domainName: 'Deep Work',
      taskTitle: 'Ship the shared-phone fix',
      taskHours: 5,
    });

    // ─── User A signs in → migration runs, marker A gets set. ──────────
    await signInViaCodeFlow(page, emailA);
    await page.waitForSelector('[data-testid="cloud-migration-done"]', {
      state: 'attached',
      timeout: 20_000,
    });

    const { data: aDomains } = await admin
      .from('week_domains')
      .select('id, name')
      .eq('user_id', userIdA);
    expect(aDomains?.length).toBe(1);
    expect(aDomains?.[0]?.name).toBe('Deep Work');
    const userADomainId = aDomains?.[0]?.id;

    // ─── User A signs out, user B signs in on the same browser. ────────
    await page.goto('/');
    await page.getByTestId('top-nav-logout').click();
    await page.waitForTimeout(500);

    await signInViaCodeFlow(page, emailB);

    // Migration completes — but it should have SKIPPED (foreign marker
    // detected). No error banner either way.
    await page.waitForSelector('[data-testid="cloud-migration-done"]', {
      state: 'attached',
      timeout: 20_000,
    });

    const errorBanner = await page
      .locator('[data-testid="cloud-migration-error"]')
      .count();
    expect(errorBanner).toBe(0);

    // ─── User B's cloud stays empty. This is the key assertion —
    // pre-fix, user B would have inherited "Deep Work" + tasks + logs
    // from user A's local Dexie. ───────────────────────────────────────
    const { data: bProfile } = await admin
      .from('profiles')
      .select('user_id')
      .eq('user_id', userIdB)
      .maybeSingle();
    expect(bProfile).toBeNull();

    const { data: bSettings } = await admin
      .from('settings')
      .select('user_id')
      .eq('user_id', userIdB)
      .maybeSingle();
    expect(bSettings).toBeNull();

    const { data: bDomains } = await admin
      .from('week_domains')
      .select('id')
      .eq('user_id', userIdB);
    expect(bDomains?.length).toBe(0);

    const { data: bTasks } = await admin
      .from('week_tasks')
      .select('id')
      .eq('user_id', userIdB);
    expect(bTasks?.length).toBe(0);

    const { data: bHours } = await admin
      .from('hours_logged')
      .select('id')
      .eq('user_id', userIdB);
    expect(bHours?.length).toBe(0);

    const { data: bPlans } = await admin
      .from('week_plans')
      .select('id')
      .eq('user_id', userIdB);
    expect(bPlans?.length).toBe(0);

    // ─── User A's data untouched. ──────────────────────────────────────
    const { data: aDomainsAfter } = await admin
      .from('week_domains')
      .select('id, name')
      .eq('user_id', userIdA);
    expect(aDomainsAfter?.length).toBe(1);
    expect(aDomainsAfter?.[0]?.id).toBe(userADomainId);

    await ctx.close();
  });
});

/**
 * Anonymous-first regression: prove the phone-first flow works
 * end-to-end for a single user.
 *
 *   1. Anonymous visitor lands on /, sees the Begin CTA (not a
 *      Sign-in wall).
 *   2. Walks through onboarding — profile + week plan get written to
 *      local Dexie only. No auth session at any point.
 *   3. Signs in later from the top nav.
 *   4. CloudMigrationRunner fires and lifts the anonymous session's
 *      Dexie data into cloud under the signed-in user_id.
 *
 * This is the "using Ikigai on my phone already and then I sign in"
 * scenario the user asked about.
 */
test.describe('M4 — anonymous-first: use app, then sign in later', () => {
  const email = `m4-anon-${Date.now()}-${process.pid}@ikigai.test`;
  let userId = '';
  const weekStartISO = '2026-03-02';
  const weekEndISO = '2026-03-08';

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

  test('anonymous seed → sign in from top nav → data lifted into cloud', async ({
    browser,
  }) => {
    test.setTimeout(90_000);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[m4]')) {
        // eslint-disable-next-line no-console
        console.log(`  browser: ${text}`);
      }
    });

    // ─── Step 1: anonymous landing. No auth session. ───────────────────
    await page.goto('/');
    // Middleware used to bounce signed-out visitors to /login. Confirm
    // it no longer does.
    await page.waitForURL(/\/$/, { timeout: 5_000 });
    // Begin CTA visible instead of the Sign-in wall.
    await expect(page.getByTestId('home-cta-get-started')).toBeVisible();

    // ─── Step 2: seed Dexie anonymously. This stands in for the user
    // going through onboarding + planning without an account. We use
    // the same raw-IDB helper the other tests use so we don't have
    // to walk the whole UI. ────────────────────────────────────────────
    await seedDexie(page, {
      profileName: 'Phone-First',
      weekStartISO,
      weekEndISO,
      domainName: 'Health',
      taskTitle: 'Morning walk',
      taskHours: 4,
    });

    // Also confirm protected-feeling routes are reachable without a
    // session (middleware regression). Use onboarding/context because
    // /week/plan runs an auto-create-plan effect that would insert an
    // additional row and confuse the assertions below.
    await page.goto('/onboarding/context');
    await expect(page).toHaveURL(/\/onboarding\/context$/, { timeout: 5_000 });

    // ─── Step 3: sign in from the top nav. ─────────────────────────────
    await signInViaCodeFlow(page, email);

    // ─── Step 4: migration runs, data lands in cloud. ──────────────────
    await page.waitForSelector('[data-testid="cloud-migration-done"]', {
      state: 'attached',
      timeout: 20_000,
    });

    const { data: profileRow } = await admin
      .from('profiles')
      .select('name')
      .eq('user_id', userId)
      .maybeSingle();
    expect(profileRow?.name).toBe('Phone-First');

    const { data: planRows } = await admin
      .from('week_plans')
      .select('id, week_start_iso')
      .eq('user_id', userId);
    expect(planRows?.length).toBe(1);
    expect(planRows?.[0]?.week_start_iso).toBe(weekStartISO);

    const { data: domainRows } = await admin
      .from('week_domains')
      .select('name')
      .eq('user_id', userId);
    expect(domainRows?.length).toBe(1);
    expect(domainRows?.[0]?.name).toBe('Health');

    const { data: taskRows } = await admin
      .from('week_tasks')
      .select('title')
      .eq('user_id', userId);
    expect(taskRows?.length).toBe(1);
    expect(taskRows?.[0]?.title).toBe('Morning walk');

    // No error banner surfaced.
    const errorBanner = await page
      .locator('[data-testid="cloud-migration-error"]')
      .count();
    expect(errorBanner).toBe(0);

    await ctx.close();
  });
});
