/**
 * Kenji companion — auth gate, disclosure flow, message round trip,
 * and the crisis short-circuit.
 *
 * The crisis path is the one fully deterministic, model-free flow in
 * this whole feature — the returned reply is asserted byte-for-byte.
 * The non-crisis "message round trip" test only makes structural
 * assertions (role, linkage, non-empty content) since there's no
 * precedent in this repo for asserting generated prose, same as the
 * existing AI Insights routes.
 *
 * Depends on: local Supabase (`supabase start`), Mailpit at 54324, dev
 * server on port 3724, and a real OPENAI_API_KEY for the non-crisis
 * message test (the crisis test spends no model call).
 */

import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { CRISIS_RESOURCE_RESPONSE } from '@ikigai/companion';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mailpitBase = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

if (!url || !anonKey || !serviceKey) {
  throw new Error('companion tests require cloud env vars');
}

const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── shared helpers (copied per-spec, matching this test suite's own
// existing convention — see anonymous-flow.spec.ts / session-expired.spec.ts) ──
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

async function waitForOtpCode(to: string, since: number, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${mailpitBase}/api/v1/messages`);
    if (res.ok) {
      const list = (await res.json()) as {
        messages?: Array<{ ID: string; To?: Array<{ Address?: string }>; Created?: string }>;
      };
      const candidate = (list.messages ?? []).find((m) => {
        const created = m.Created ? Date.parse(m.Created) : 0;
        return (
          created >= since &&
          (m.To ?? []).some((t) => t.Address?.toLowerCase() === to.toLowerCase())
        );
      });
      if (candidate) {
        const detail = (await (
          await fetch(`${mailpitBase}/api/v1/message/${candidate.ID}`)
        ).json()) as { HTML?: string; Text?: string };
        const match = `${detail.HTML ?? ''}\n${detail.Text ?? ''}`.match(/\b(\d{6})\b/);
        if (match) return match[1];
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for OTP email to ${to}`);
}

async function signInAndExpectDest(page: Page, email: string, expectedDest: RegExp): Promise<void> {
  const startedAt = Date.now();
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-send-link').click();
  await page.waitForSelector('[data-testid="login-sent"]', { timeout: 15_000 });
  const code = await waitForOtpCode(email, startedAt);
  await page.getByTestId('login-code-token').fill(code);
  await page.getByTestId('login-verify-code').click();
  await page.waitForURL(expectedDest, { timeout: 15_000 });
}

// ─── 1. Signed-out access ────────────────────────────────────────────────
test.describe('companion — signed-out', () => {
  test('signed-out visitor sees a sign-in prompt, not the chat', async ({ page }) => {
    await page.goto('/companion');
    await expect(page.getByTestId('companion-signin')).toBeVisible();
    await expect(page.getByTestId('companion-input')).toHaveCount(0);
  });

  test('unauthenticated POST to /api/companion/message is rejected', async ({ request }) => {
    const res = await request.post('/api/companion/message', {
      data: { message: 'hello' },
    });
    expect(res.status()).toBe(401);
  });
});

// ─── 2. Signed-in flow ───────────────────────────────────────────────────
test.describe('companion — signed-in', () => {
  const email = `companion-${Date.now()}-${process.pid}@ikigai.test`;
  let userId = '';

  test.beforeAll(async () => {
    userId = await createUser(email);
  });

  test.afterAll(async () => {
    // companion_messages/companion_context cascade-delete with the auth
    // user (ON DELETE CASCADE), matching how week_plans etc. are left
    // to the same cascade elsewhere in this suite.
    await admin.from('settings').delete().eq('user_id', userId);
    await deleteUser(userId);
  });

  test('disclosure modal shows once, then persists past reload', async ({ browser }) => {
    test.setTimeout(60_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto('/login');
    await signInAndExpectDest(page, email, /\/$/);
    await page.goto('/companion');

    await expect(page.getByTestId('companion-disclosure-modal')).toBeVisible();
    await page.getByTestId('companion-disclosure-accept').click();
    await expect(page.getByTestId('companion-disclosure-modal')).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId('companion-disclosure-modal')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('companion-input')).toBeVisible();

    await ctx.close();
  });

  test('sending a message produces a user row and an assistant row sharing a conversation', async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto('/login');
    await signInAndExpectDest(page, email, /\/$/);
    await page.goto('/companion');

    // Wait for the page to settle past its initial "Loading…" state
    // before checking for the modal — checking immediately after
    // goto() can race the settings fetch and misread "not loaded yet"
    // as "already acknowledged." (Not a plain visibility race between
    // the two testids: the input element exists in the DOM, just
    // disabled, even while the modal overlay is up, so `.or()` on
    // visibility alone matched both and hit Playwright's strict mode.)
    // Disclosure was already acknowledged by an earlier test (same
    // user, same settings row) in the normal case; accept it
    // defensively if it still shows for some reason.
    await page.waitForTimeout(1500);
    if (await page.getByTestId('companion-disclosure-modal').isVisible().catch(() => false)) {
      await page.getByTestId('companion-disclosure-accept').click();
      await expect(page.getByTestId('companion-disclosure-modal')).toHaveCount(0, { timeout: 10_000 });
    }
    await expect(page.getByTestId('companion-input')).toBeEnabled({ timeout: 10_000 });

    const text = `test message ${Date.now()}`;
    await page.getByTestId('companion-input').fill(text);
    await page.getByTestId('companion-send').click();

    await expect(page.getByText(text)).toBeVisible();
    // The route only persists BOTH rows after the real model call
    // completes (see app/api/companion/message/route.ts) — wait for
    // the input to re-enable, which only happens once that fetch
    // resolves, rather than guessing at a fixed delay.
    await expect(page.getByTestId('companion-input')).toBeEnabled({ timeout: 30_000 });

    const { data: rows, error } = await admin
      .from('companion_messages')
      .select('role, content, conversation_id')
      .eq('user_id', userId)
      .eq('content', text);
    expect(error).toBeNull();
    expect(rows?.length).toBe(1);
    const conversationId = rows?.[0]?.conversation_id;

    const { data: assistantRows } = await admin
      .from('companion_messages')
      .select('role, content')
      .eq('user_id', userId)
      .eq('conversation_id', conversationId)
      .eq('role', 'assistant');
    expect(assistantRows?.length).toBeGreaterThan(0);
    expect(assistantRows?.[assistantRows.length - 1]?.content.length).toBeGreaterThan(0);

    await ctx.close();
  });

  test('a crisis-phrase message short-circuits to the fixed resource response', async ({ browser }) => {
    test.setTimeout(60_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto('/login');
    await signInAndExpectDest(page, email, /\/$/);
    await page.goto('/companion');
    await page.waitForTimeout(1500);
    if (await page.getByTestId('companion-disclosure-modal').isVisible().catch(() => false)) {
      await page.getByTestId('companion-disclosure-accept').click();
      await expect(page.getByTestId('companion-disclosure-modal')).toHaveCount(0, { timeout: 10_000 });
    }
    await expect(page.getByTestId('companion-input')).toBeEnabled({ timeout: 10_000 });

    const trigger = 'I want to kill myself';
    await page.getByTestId('companion-input').fill(trigger);
    await page.getByTestId('companion-send').click();

    await expect(page.getByText(CRISIS_RESOURCE_RESPONSE)).toBeVisible({ timeout: 15_000 });

    const { data: rows, error } = await admin
      .from('companion_messages')
      .select('role, content, crisis_flag')
      .eq('user_id', userId)
      .eq('content', trigger);
    expect(error).toBeNull();
    expect(rows?.length).toBe(1);
    expect(rows?.[0]?.crisis_flag).toBe(true);

    const { data: replyRows } = await admin
      .from('companion_messages')
      .select('content, crisis_flag')
      .eq('user_id', userId)
      .eq('content', CRISIS_RESOURCE_RESPONSE);
    expect(replyRows?.length).toBeGreaterThan(0);
    expect(replyRows?.every((r) => r.crisis_flag === true)).toBe(true);

    await ctx.close();
  });
});

// ─── 3. Persona recompute (turn 1) ──────────────────────────────────────
// A fresh user, not the shared "signed-in" describe block's user above —
// persona_source_message_count needs to start genuinely at 0 for this to
// actually exercise the first-ever-message case (see
// app/api/companion/message/route.ts's persona-recompute fix).
test.describe('companion — persona recompute (turn 1)', () => {
  const email = `companion-persona-${Date.now()}-${process.pid}@ikigai.test`;
  let userId = '';

  test.beforeAll(async () => {
    userId = await createUser(email);
  });

  test.afterAll(async () => {
    await admin.from('settings').delete().eq('user_id', userId);
    await deleteUser(userId);
  });

  test('first-ever message produces a non-generic persona summary, not "nothing to capture yet"', async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto('/login');
    await signInAndExpectDest(page, email, /\/$/);
    await page.goto('/companion');
    await page.waitForTimeout(1500);
    if (await page.getByTestId('companion-disclosure-modal').isVisible().catch(() => false)) {
      await page.getByTestId('companion-disclosure-accept').click();
      await expect(page.getByTestId('companion-disclosure-modal')).toHaveCount(0, { timeout: 10_000 });
    }
    await expect(page.getByTestId('companion-input')).toBeEnabled({ timeout: 10_000 });

    const text =
      'I have been really stressed about work lately, and I just want to protect my painting time — I was proud of the presentation I gave this week.';
    await page.getByTestId('companion-input').fill(text);
    await page.getByTestId('companion-send').click();
    await expect(page.getByTestId('companion-input')).toBeEnabled({ timeout: 30_000 });

    const { data: contextRow, error } = await admin
      .from('companion_context')
      .select('persona_summary, persona_source_message_count')
      .eq('user_id', userId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(contextRow?.persona_source_message_count).toBe(1);
    expect(contextRow?.persona_summary ?? '').not.toMatch(/no specific details to capture|first summary|nothing yet/i);
    expect((contextRow?.persona_summary ?? '').length).toBeGreaterThan(20);

    await ctx.close();
  });
});
