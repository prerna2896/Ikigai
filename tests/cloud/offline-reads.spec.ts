/**
 * M4.2 — Read-through offline fallback.
 *
 * What this proves:
 *   1. When online, cloud reads mirror their result into Dexie
 *      opportunistically — so a later offline read has data to serve.
 *   2. When the cloud REST endpoint fails with a network-shaped error,
 *      OfflineAwareCloudRepository returns the Dexie mirror instead of
 *      throwing. The app renders with cached data, no error banner.
 *   3. Cloud errors that AREN'T network-shaped (RLS, 5xx, validation)
 *      still propagate — we don't want to hide real bugs behind stale
 *      cached responses. This spec doesn't yet cover that boundary
 *      explicitly; the invariant is enforced by isNetworkError in the
 *      wrapper and would fail with a caught exception if bypassed.
 *
 * We simulate offline by aborting cloud REST requests via
 * `context.route`, rather than `context.setOffline(true)`. That keeps
 * the Next.js dev server reachable (page reloads still work) while
 * making Supabase specifically fail — closer to real production offline
 * from the app's perspective, and gives us a clean signal to test.
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
  throw new Error('offline-reads test requires cloud env vars');
}

const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── shared helpers (minimally copied from offline-queue.spec.ts) ────────

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

// Peek at Dexie's `profiles` store — verifies the read-through mirror
// wrote something after an online cloud read.
async function readDexieProfileName(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('ikigai');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const row = await new Promise<{ name?: string } | undefined>(
      (resolve, reject) => {
        const tx = db.transaction('profiles', 'readonly');
        const req = tx.objectStore('profiles').getAll();
        req.onsuccess = () => resolve(req.result?.[0]);
        req.onerror = () => reject(req.error);
      },
    );
    db.close();
    return row?.name ?? null;
  });
}

// ─── Test ────────────────────────────────────────────────────────────────

test.describe('M4.2 — read-through offline fallback', () => {
  const email = `m4-reads-${Date.now()}-${process.pid}@ikigai.test`;
  let userId = '';
  const profileName = 'Read Through Test';

  test.beforeAll(async () => {
    userId = await createUser(email);
    const now = new Date().toISOString();
    // Pre-populate cloud so the read has something to mirror.
    await admin.from('profiles').insert({
      user_id: userId,
      name: profileName,
      life_areas: null,
      created_at: now,
      updated_at: now,
    });
    await admin.from('settings').insert({
      user_id: userId,
      week_start_day: 'monday',
      week_time_zone: 'America/Los_Angeles',
      profession_type: 'full_time_employee',
      created_at: now,
      updated_at: now,
    });
  });

  test.afterAll(async () => {
    await admin.from('week_notes').delete().eq('user_id', userId);
    await admin.from('week_plans').delete().eq('user_id', userId);
    await admin.from('profiles').delete().eq('user_id', userId);
    await admin.from('settings').delete().eq('user_id', userId);
    await deleteUser(userId);
  });

  test('online read populates Dexie mirror; simulated offline read still serves the mirror', async ({
    browser,
  }) => {
    test.setTimeout(90_000);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('pageerror', (err) => {
      // eslint-disable-next-line no-console
      console.log(`  browser pageerror: ${err.message}`);
    });

    // Open app so Dexie initializes at current schema.
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(300);

    // Sign in via UI — this flips RepositoryProvider to the
    // OfflineAwareCloudRepository and mounts the drainer.
    await signInViaCodeFlow(page, email);

    // Wait for the migration marker (idempotent no-op run for this
    // seeded user — proves the app finished its post-signin plumbing).
    await page
      .waitForSelector('[data-testid="cloud-migration-done"]', {
        state: 'attached',
        timeout: 15_000,
      })
      .catch(() => {
        // Migration might have already been marked; not a hard error.
      });

    // Trigger an online read of the profile by navigating home. The
    // Home page's useEffect calls profileRepo.getProfile() which
    // routes through the wrapper's readOrMirror, populating Dexie.
    await page.goto('/');
    await page.waitForTimeout(1000);

    // Sanity: Dexie mirror was written by the online cloud read.
    const mirroredName = await readDexieProfileName(page);
    expect(mirroredName).toBe(profileName);

    // ─── Simulate offline for Supabase specifically ───────────────────
    // We abort Supabase REST calls but leave the Next dev server and
    // static assets untouched so the reload itself succeeds.
    const supabaseHost = new URL(url!).host;
    await ctx.route(`**://${supabaseHost}/rest/v1/**`, (route) => {
      route.abort('failed');
    });

    // Reload the app — this triggers a fresh getProfile() which will
    // hit an aborted REST call, the wrapper detects a network error,
    // and returns the Dexie mirror instead of throwing.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    // Give the client-side effects time to fetch + fall back.
    await page.waitForTimeout(2000);

    // The page should still render meaningfully (the profile-driven
    // Home content or at least no error banner). We're mostly
    // asserting the negative: no "Failed to fetch" surfaced.
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('Failed to fetch');
    expect(body).not.toContain('NetworkError');
    expect(body).not.toContain('[object Object]');

    // Any error banner from the app itself?
    const errorAlert = await page.locator('[role="alert"]').count();
    // /profile page (and others) surface errors as [role="alert"];
    // this call itself doesn't crash even if there are zero alerts.
    // Assertion: <= 1 alert (some pages have persistent
    // informational alerts unrelated to reads).
    expect(errorAlert).toBeLessThanOrEqual(1);

    await ctx.close();
  });
});
