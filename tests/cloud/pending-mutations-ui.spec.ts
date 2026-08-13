/**
 * M4.2 — Pending-mutations UI escape hatch.
 *
 * What this proves:
 *   1. A poisoned pending_mutations row (retries >= MAX_RETRIES) shows
 *      up in /dev/sync-status with the "poisoned mutations" header and
 *      the row's lastError surfaced.
 *   2. The per-row Discard button removes the entry from Dexie, so
 *      users have a way to clear a stuck row without opening DevTools.
 *   3. The per-row Retry button resets retries to 0 and clears
 *      lastError, so the queue drainer will pick it up again on its
 *      next tick.
 *
 * We seed Dexie via raw IDB (mirrors offline-queue.spec.ts) instead of
 * driving a real network failure — the goal here is to test the UI +
 * repository plumbing, not queueDrain's retry loop.
 *
 * Depends on:
 *   - Local Supabase (`supabase start`), Mailpit at 54324.
 *   - Dev server on port 3726 (this worktree's assigned port).
 */

import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mailpitBase = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

if (!url || !anonKey || !serviceKey) {
  throw new Error('M4.2 pending-mutations-ui test requires cloud env vars');
}

const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── OTP helpers (mirrors offline-queue.spec.ts) ─────────────────────────

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

// ─── Dexie helpers (raw IDB so we don't bundle Dexie into the test) ─────

type SeedInput = {
  userId: string;
  op: string;
  retries: number;
  lastError: string | null;
  // args intentionally unstructured — the drainer will complain about
  // unknown ops but the UI only cares about op / retries / lastError.
  // Keeping args off the type surface here also means the seed helper
  // stays reusable when we grow more op shapes.
  args?: unknown;
};

async function seedPendingMutation(
  page: Page,
  input: SeedInput,
): Promise<number> {
  return page.evaluate(async (p) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('ikigai');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const id = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction('pending_mutations', 'readwrite');
      const store = tx.objectStore('pending_mutations');
      const req = store.add({
        createdAt: new Date().toISOString(),
        userId: p.userId,
        op: p.op,
        args: p.args ?? [],
        retries: p.retries,
        lastError: p.lastError,
      });
      req.onsuccess = () => resolve(req.result as number);
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return id;
  }, input);
}

async function readPendingMutations(page: Page): Promise<
  Array<{ id: number; op: string; retries: number; lastError: string | null }>
> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('ikigai');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const rows = await new Promise<
      Array<{
        id: number;
        op: string;
        retries: number;
        lastError: string | null;
      }>
    >((resolve, reject) => {
      const tx = db.transaction('pending_mutations', 'readonly');
      const req = tx.objectStore('pending_mutations').getAll();
      req.onsuccess = () =>
        resolve(
          (req.result as Array<{
            id: number;
            op: string;
            retries: number;
            lastError: string | null;
          }>) ?? [],
        );
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows;
  });
}

// ─── Test ────────────────────────────────────────────────────────────────

test.describe('M4.2 — Pending-mutations UI escape hatch', () => {
  const email = `m4-poison-${Date.now()}-${process.pid}@ikigai.test`;
  let userId = '';
  const poisonError = 'PGRST301: JWT expired at replay';

  test.beforeAll(async () => {
    userId = await createUser(email);
  });

  test.afterAll(async () => {
    // No app-side inserts to clean up — the seeded rows live only in
    // Dexie inside the ephemeral browser context. Still tear down the
    // Supabase user so we don't accumulate orphans.
    await admin.from('profiles').delete().eq('user_id', userId);
    await admin.from('settings').delete().eq('user_id', userId);
    await deleteUser(userId);
  });

  test('poisoned rows surface with Retry / Discard actions', async ({
    browser,
  }) => {
    test.setTimeout(90_000);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('pageerror', (err) => {
      // eslint-disable-next-line no-console
      console.log(`  browser pageerror: ${err.message}`);
    });

    // Land on the app first so Dexie opens `ikigai` at the current
    // schema version — same reason as offline-queue.spec.ts.
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    await signInViaCodeFlow(page, email);
    await page
      .waitForSelector('[data-testid="cloud-migration-done"]', {
        state: 'attached',
        timeout: 15_000,
      })
      .catch(() => {
        // No-op for brand-new users with nothing to migrate.
      });

    // ─── Seed a poisoned entry ───────────────────────────────────────────

    const seededId = await seedPendingMutation(page, {
      userId,
      op: 'saveWeekNote',
      retries: 5,
      lastError: poisonError,
      args: [{ id: 'note-poison', weekId: '2026-02-02', note: 'stuck' }],
    });

    // Navigate to the inspector before dropping the network, so the
    // page + its bundle actually load. THEN go offline so the drainer
    // can't race us and prune the seeded row before we assert. The
    // drainer would otherwise treat retries=5 as MAX_RETRIES-skipped
    // and leave the row alone, but a background drainer tick could
    // still mutate the row between now and our first assertion — the
    // offline flip is cheap insurance.
    await page.goto('/dev/sync-status');
    await page.waitForLoadState('domcontentloaded');
    await ctx.setOffline(true);

    // Header callout is the primary signal that something's wrong.
    const header = page.getByTestId('poisoned-mutations-header');
    await expect(header).toBeVisible({ timeout: 10_000 });
    await expect(header).toContainText('1 poisoned');

    // Row shows op + error message.
    const row = page.getByTestId('pending-mutation-row').first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('saveWeekNote');
    await expect(page.getByTestId('pending-mutation-error')).toContainText(
      poisonError,
    );

    // ─── Discard clears the row ──────────────────────────────────────────

    // Discard uses window.confirm. Auto-accept it.
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('pending-mutation-discard').click();

    // Row gone from the page.
    await expect(page.getByTestId('pending-mutation-row')).toHaveCount(0);
    // Row gone from Dexie.
    const afterDiscard = await readPendingMutations(page);
    expect(afterDiscard.find((r) => r.id === seededId)).toBeUndefined();
    expect(afterDiscard.length).toBe(0);

    // ─── Seed another, use Retry ─────────────────────────────────────────

    const secondId = await seedPendingMutation(page, {
      userId,
      op: 'saveWeekNote',
      retries: 5,
      lastError: poisonError,
      args: [{ id: 'note-retry', weekId: '2026-02-02', note: 'try me' }],
    });

    // Come back online just long enough to reload the page (goto
    // requires the network), then flip back offline so the drainer
    // can't consume the row before we click Retry.
    await ctx.setOffline(false);
    await page.goto('/dev/sync-status');
    await page.waitForLoadState('domcontentloaded');
    await ctx.setOffline(true);
    await expect(page.getByTestId('pending-mutation-row')).toHaveCount(1);

    await page.getByTestId('pending-mutation-retry').click();

    // Retry does NOT remove the row — it resets its counters. The row
    // stays visible (drainer will try again in the background) but
    // shouldn't be poisoned any more.
    const afterRetry = await readPendingMutations(page);
    const retried = afterRetry.find((r) => r.id === secondId);
    expect(retried).toBeDefined();
    expect(retried?.retries).toBe(0);
    expect(retried?.lastError).toBeNull();

    // Poisoned header should be gone (or, if the drainer already
    // pruned the row, no rows at all).
    await expect(page.getByTestId('poisoned-mutations-header')).toHaveCount(0);

    await ctx.close();
  });
});
