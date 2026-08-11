/**
 * M4.1 — Dexie offline write queue.
 *
 * What this proves:
 *   1. A signed-in user whose network drops still gets their write
 *      accepted — the mutation lands in Dexie's `pending_mutations`
 *      store and NOT in Supabase (verified out-of-band via admin
 *      client).
 *   2. When the network comes back the queue drainer replays the
 *      mutation to Supabase and prunes the Dexie row.
 *
 * The test enqueues via raw IDB rather than exercising a UI form,
 * because the point of this spec is the queue + drainer plumbing,
 * not the note editor. The rows written are exactly the shape
 * OfflineAwareCloudRepository writes — a change in either shape
 * without updating the other will fail this test.
 *
 * Depends on:
 *   - Local Supabase (`supabase start`), Mailpit at 54324.
 *   - Dev server on port 3724 (the offline-queue worktree port).
 */

import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mailpitBase = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

if (!url || !anonKey || !serviceKey) {
  throw new Error('M4.1 offline-queue test requires cloud env vars');
}

const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── OTP helpers (mirrors local-to-cloud-migration.spec.ts) ──────────────

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

// ─── Dexie helpers (raw IDB so we don't need to bundle Dexie) ────────────

// Read the pending_mutations rows currently in Dexie.
async function readPendingMutations(page: Page): Promise<
  Array<{ id: number; op: string; userId: string; retries: number }>
> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('ikigai');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const rows = await new Promise<
      Array<{ id: number; op: string; userId: string; retries: number }>
    >((resolve, reject) => {
      const tx = db.transaction('pending_mutations', 'readonly');
      const store = tx.objectStore('pending_mutations');
      const req = store.getAll();
      req.onsuccess = () =>
        resolve(
          (req.result as Array<{
            id: number;
            op: string;
            userId: string;
            retries: number;
          }>) ?? [],
        );
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows;
  });
}

// Simulate what OfflineAwareCloudRepository does when a saveWeekNote
// fails offline: mirror the note into Dexie's weekNotes store AND
// enqueue a pending_mutations row that queueDrain will later replay.
async function enqueueOfflineWeekNote(
  page: Page,
  payload: { userId: string; weekId: string; note: string },
): Promise<{ id: string }> {
  return page.evaluate(async (p) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('ikigai');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const nowIso = new Date().toISOString();
    const noteId = crypto.randomUUID();
    const noteRow = {
      id: noteId,
      weekId: p.weekId,
      note: p.note,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('weekNotes', 'readwrite');
      tx.objectStore('weekNotes').put(noteRow);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('pending_mutations', 'readwrite');
      tx.objectStore('pending_mutations').add({
        createdAt: nowIso,
        userId: p.userId,
        op: 'saveWeekNote',
        args: [noteRow],
        retries: 0,
        lastError: null,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    db.close();
    return { id: noteId };
  }, payload);
}

// ─── Test ────────────────────────────────────────────────────────────────

test.describe('M4.1 — Dexie offline queue', () => {
  const email = `m4-offline-${Date.now()}-${process.pid}@ikigai.test`;
  let userId = '';
  const weekStartISO = '2026-02-02';
  const noteBody = 'wrote this while offline';

  test.beforeAll(async () => {
    userId = await createUser(email);
  });

  test.afterAll(async () => {
    await admin.from('week_notes').delete().eq('user_id', userId);
    await admin.from('week_plans').delete().eq('user_id', userId);
    await admin.from('profiles').delete().eq('user_id', userId);
    await admin.from('settings').delete().eq('user_id', userId);
    await deleteUser(userId);
  });

  test('offline write enqueues in Dexie; back online drains to cloud', async ({
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
    // schema version — otherwise our raw IDB writes below would race
    // an upgrade transaction. We wait long enough for the drainer's
    // effect in RepositoryProvider to be mounted.
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    // Sign in — this triggers RepositoryProvider to (a) wrap cloud in
    // OfflineAwareCloudRepository and (b) start the queue drainer.
    await signInViaCodeFlow(page, email);
    await page
      .waitForSelector('[data-testid="cloud-migration-done"]', {
        state: 'attached',
        timeout: 15_000,
      })
      .catch(() => {
        // Migration marker only shows if there was local data to migrate.
        // For a brand-new user this can be absent — that's fine.
      });

    // Precondition: the week_notes FK expects a matching week_plan.
    // Insert one server-side so the drainer's replay can succeed.
    const { error: planErr } = await admin.from('week_plans').insert({
      id: weekStartISO,
      user_id: userId,
      week_start_iso: weekStartISO,
      week_end_iso: '2026-02-08',
      week_start_day: 'monday',
      week_time_zone: 'America/Los_Angeles',
      is_frozen: false,
    });
    if (planErr) throw planErr;

    // ─── Test A: go offline, enqueue a write ─────────────────────────────

    await ctx.setOffline(true);

    const { id: noteId } = await enqueueOfflineWeekNote(page, {
      userId,
      weekId: weekStartISO,
      note: noteBody,
    });

    const pending = await readPendingMutations(page);
    expect(pending.length).toBe(1);
    expect(pending[0].op).toBe('saveWeekNote');
    expect(pending[0].userId).toBe(userId);
    expect(pending[0].retries).toBe(0);

    // Cloud has NOT yet received it.
    const { data: cloudBefore } = await admin
      .from('week_notes')
      .select('id, note')
      .eq('user_id', userId);
    expect(cloudBefore?.some((row) => row.id === noteId)).toBe(false);

    // ─── Test B: come back online, verify drain ──────────────────────────

    await ctx.setOffline(false);
    // Nudge the drainer explicitly rather than waiting for the 30s
    // poll — the drainer listens for `online` too, so this is what
    // a real reconnect looks like.
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    const deadline = Date.now() + 10_000;
    let drained = false;
    while (Date.now() < deadline) {
      const rows = await readPendingMutations(page);
      if (rows.length === 0) {
        drained = true;
        break;
      }
      await page.waitForTimeout(300);
    }
    expect(drained).toBe(true);

    const { data: cloudAfter } = await admin
      .from('week_notes')
      .select('id, note')
      .eq('user_id', userId);
    expect(cloudAfter?.some((row) => row.id === noteId && row.note === noteBody)).toBe(
      true,
    );

    await ctx.close();
  });
});
