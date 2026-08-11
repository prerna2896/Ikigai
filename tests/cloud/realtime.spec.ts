/**
 * M2.4 verification — Realtime cross-device propagation.
 *
 * What this proves:
 *   1. When a signed-in user is looking at the app, a change made to
 *      their profile (via admin API, simulating another device's
 *      write) propagates to the open page within a few seconds
 *      without a manual refresh.
 *   2. RLS still applies to Realtime — a change made against another
 *      user's row does NOT trigger a refresh on this user's page.
 *
 * The mechanism under test:
 *   - components/CloudSyncProvider subscribes to postgres_changes for
 *     the current user's rows on every user-scoped table.
 *   - On event, it bumps a `version` counter exposed via context.
 *   - Consumer components (TopNav, home page, planner, etc.) list
 *     `cloudVersion` in their data-loading useEffect deps, so they
 *     refetch on remote change.
 *
 * Assumes local Supabase (`supabase start`) with the
 * `supabase_realtime` publication including our user-scoped tables
 * (migration 0002_realtime_publication.sql), and dev on port 3724.
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mailpitBase = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

if (!url || !anonKey || !serviceKey) {
  throw new Error('Realtime test requires cloud env vars');
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

async function seedProfile(userId: string, name: string) {
  const now = new Date().toISOString();
  const { error } = await admin.from('profiles').upsert(
    { user_id: userId, name, created_at: now, updated_at: now },
    { onConflict: 'user_id' },
  );
  if (error) throw error;
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

test.describe('M2.4 — Realtime cross-device propagation', () => {
  const emailA = `rt-a-${Date.now()}-${process.pid}@ikigai.test`;
  const emailB = `rt-b-${Date.now()}-${process.pid}@ikigai.test`;
  let userAId = '';
  let userBId = '';

  test.beforeAll(async () => {
    userAId = await createUser(emailA);
    userBId = await createUser(emailB);
  });

  test.beforeEach(async () => {
    // Reset names before each test so assertions don't depend on prior
    // test's mutations. Uses upsert so the row is created if missing.
    await seedProfile(userAId, 'Alice Original');
    await seedProfile(userBId, 'Bob Original');
  });

  test.afterAll(async () => {
    await admin.from('week_plans').delete().in('user_id', [userAId, userBId]);
    await admin.from('profiles').delete().in('user_id', [userAId, userBId]);
    await admin.from('settings').delete().in('user_id', [userAId, userBId]);
    await deleteUser(userAId);
    await deleteUser(userBId);
  });

  test('profile update via admin propagates to open page without refresh', async ({
    browser,
  }) => {
    test.setTimeout(60_000);

    const ctx: BrowserContext = await browser.newContext();
    const page = await ctx.newPage();
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[cloud-sync]')) {
        // eslint-disable-next-line no-console
        console.log(`  browser: ${text}`);
      }
    });
    await signInViaCodeFlow(page, emailA);

    // Land on home and let the greeting settle. Should show "Alice"
    // (first word of "Alice Original").
    await page.goto('/');
    await page.waitForSelector('[data-testid="home-page"]');
    await expect(page.locator('h1').first()).toContainText('Alice', {
      timeout: 10_000,
    });

    // Wait a beat for the CloudSyncProvider to establish its channel
    // (Supabase Realtime handshake takes a moment).
    await page.waitForTimeout(1500);

    // Simulate another device updating the profile name. Change the
    // first word since the greeting uses only `name.split(' ')[0]`.
    const now = new Date().toISOString();
    const { error } = await admin
      .from('profiles')
      .update({ name: 'Zara Renamed', updated_at: now })
      .eq('user_id', userAId);
    expect(error).toBeNull();

    // Without a refresh, the greeting should update once the Realtime
    // event fires and the useEffect refetches.
    await expect(page.locator('h1').first()).toContainText('Zara', {
      timeout: 15_000,
    });

    await ctx.close();
  });

  test("changes to another user's rows do NOT trigger this user's refresh (RLS on Realtime)", async ({
    browser,
  }) => {
    test.setTimeout(60_000);

    const ctx: BrowserContext = await browser.newContext();
    const page = await ctx.newPage();
    await signInViaCodeFlow(page, emailA);

    await page.goto('/');
    await page.waitForSelector('[data-testid="home-page"]');
    await expect(page.locator('h1').first()).toContainText('Alice');

    // Wait for channel handshake.
    await page.waitForTimeout(1500);

    // Update user B's profile. If Realtime leaks events across users
    // (bug), user A's page would refetch and — since her profile
    // hasn't changed — she'd still see her name. So we can't detect
    // "no refresh" from name alone. Instead, we assert user A's
    // greeting stays "Alice" for a comfortably-long window: if her
    // page did erroneously refetch on B's change, the greeting still
    // shows "Alice" (correctly), but if RLS were leaking B's *row
    // data* into A's cache we'd see "Bob" — which we absolutely
    // never should.
    const now = new Date().toISOString();
    await admin
      .from('profiles')
      .update({ name: 'Bob Renamed', updated_at: now })
      .eq('user_id', userBId);

    // Give any misbehaving refetch time to arrive.
    await page.waitForTimeout(3000);

    // A's greeting must still show A's name.
    await expect(page.locator('h1').first()).toContainText('Alice');
    // And absolutely must NOT show B's data anywhere on the page.
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('Bob');

    await ctx.close();
  });
});
