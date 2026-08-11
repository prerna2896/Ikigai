/**
 * Anonymous-first UX coverage.
 *
 * These tests exercise the middleware + RepositoryProvider changes
 * made for the "use the app on your phone before signing in" story.
 * They don't touch Supabase auth for the browsing/onboarding paths —
 * the whole point is that those paths work without a session — and
 * only involve auth for the mid-flow sign-in-return test.
 *
 * Assumes local Supabase and dev server on 3724 (same as the M4 specs).
 */

import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mailpitBase = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

if (!url || !anonKey || !serviceKey) {
  throw new Error('anonymous-flow tests require cloud env vars');
}

const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── shared helpers (copied minimally from local-to-cloud-migration.spec) ──
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

// Sign in via the login-page code flow, expecting to land on `expectedDest`
// (a substring match on the URL — supports both '/' and '/week/plan' etc).
async function signInAndExpectDest(
  page: Page,
  email: string,
  expectedDest: RegExp,
): Promise<void> {
  const startedAt = Date.now();
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-send-link').click();
  await page.waitForSelector('[data-testid="login-sent"]', {
    timeout: 15_000,
  });
  const code = await waitForOtpCode(email, startedAt);
  await page.getByTestId('login-code-token').fill(code);
  await page.getByTestId('login-verify-code').click();
  await page.waitForURL(expectedDest, { timeout: 15_000 });
}

// ─── 1. Anonymous walk-through of the real onboarding UI ─────────────────
test.describe('anonymous onboarding UI walk-through', () => {
  test('signed-out user walks through onboarding, lands on /week/plan, profile is in Dexie', async ({
    browser,
  }) => {
    test.setTimeout(60_000);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto('/');
    await expect(page.getByTestId('home-cta-get-started')).toBeVisible();
    await page.getByTestId('home-cta-get-started').click();

    // context step — provide a name
    await expect(page).toHaveURL(/onboarding\/context/);
    const nameInput = page.getByTestId('onboarding-name-input');
    if (await nameInput.isVisible()) {
      await nameInput.fill('Anon Walk');
    }
    await page.getByTestId('onboarding-next').click();

    // tone step
    await expect(page).toHaveURL(/onboarding\/tone/);
    await page.getByTestId('onboarding-next').click();

    // reflection step — click through until settings appears (page has
    // multiple sub-steps; existing golden-path caps at 10 clicks).
    await expect(page).toHaveURL(/onboarding\/reflection/);
    for (let step = 0; step < 10; step += 1) {
      await page.getByTestId('onboarding-next').click();
      if (page.url().includes('/onboarding/settings')) break;
    }
    // Goals is an optional intermediate step in some builds — skip
    // through if we land there.
    if (page.url().includes('/onboarding/goals')) {
      await page.getByTestId('onboarding-next').click();
    }

    // settings step — click through until Finish button appears, click it.
    await expect(page).toHaveURL(/onboarding\/settings/);
    for (let step = 0; step < 5; step += 1) {
      const finish = page.getByTestId('onboarding-finish');
      if (await finish.isVisible()) {
        await finish.click();
        break;
      }
      await page.getByTestId('onboarding-next').click();
    }

    // Lands on /week/plan.
    await expect(page).toHaveURL(/week\/plan/, { timeout: 10_000 });

    // Verify the profile actually made it into Dexie (i.e. the
    // repository-layer writes went through as expected for a signed-
    // out session).
    const profileName = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('ikigai');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const row = await new Promise<{ name?: string } | undefined>(
        (resolve, reject) => {
          const tx = db.transaction('profiles', 'readonly');
          const store = tx.objectStore('profiles');
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result?.[0]);
          req.onerror = () => reject(req.error);
        },
      );
      db.close();
      return row?.name ?? null;
    });
    expect(profileName).toBe('Anon Walk');

    await ctx.close();
  });
});

// ─── 2. Anonymous browsing of feature pages ──────────────────────────────
test.describe('anonymous feature-page browsing', () => {
  // Every route should render (testid visible) without a redirect to
  // /login. Pre-fix, middleware bounced all of these to /login.
  const routes: Array<{ path: string; testid: string }> = [
    { path: '/log', testid: 'log-page' },
    { path: '/history', testid: 'history-page' },
    { path: '/profile', testid: 'profile-page' },
    { path: '/reflect', testid: 'reflect-view-tabs' },
  ];

  for (const route of routes) {
    test(`anonymous visitor can load ${route.path} without being bounced to /login`, async ({
      page,
    }) => {
      await page.goto(route.path);
      // First: middleware did not redirect us.
      await expect(page).toHaveURL(new RegExp(`${route.path}$`), {
        timeout: 5_000,
      });
      // Second: the page actually rendered its root testid.
      await expect(page.getByTestId(route.testid)).toBeVisible({
        timeout: 10_000,
      });
    });
  }
});

// ─── 3. Mid-flow sign-in returns to originating route ────────────────────
test.describe('mid-flow sign-in preserves location', () => {
  const email = `anon-return-${Date.now()}-${process.pid}@ikigai.test`;
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

  test('anonymous user on /reflect clicks Sign in and lands back on /reflect', async ({
    browser,
  }) => {
    test.setTimeout(60_000);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // Land on /reflect anonymously.
    await page.goto('/reflect');
    await expect(page.getByTestId('reflect-view-tabs')).toBeVisible();

    // Click the top-nav Sign in button.
    await page.getByTestId('top-nav-login').click();

    // URL should carry ?next=%2Freflect (URL-encoded /reflect).
    await expect(page).toHaveURL(/\/login\?next=%2Freflect/, {
      timeout: 5_000,
    });

    // Complete sign-in via code flow and verify we land BACK on /reflect,
    // not on '/'.
    await signInAndExpectDest(page, email, /\/reflect$/);

    await ctx.close();
  });
});

// ─── 4. Malformed email is blocked at HTML5 validation ───────────────────
test.describe('login input validation', () => {
  test('malformed email does not transition the form to a sent state', async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto('/login');
    await page.getByTestId('login-email').fill('not-an-email');

    // Submit the form. HTML5 type=email + required should block the
    // submit event so signInWithOtp never runs.
    await page.getByTestId('login-send-link').click();

    // Give the form a moment to (fail to) transition.
    await page.waitForTimeout(500);

    // Assert the "sent" confirmation panel never appeared.
    await expect(page.getByTestId('login-sent')).toHaveCount(0);

    await ctx.close();
  });
});
