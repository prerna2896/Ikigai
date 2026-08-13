/**
 * Regression: unrecognized emails hit the signup confirmation gate,
 * not a silent orphan-account creation.
 *
 * The pre-fix behavior: signInWithOtp defaulted to shouldCreateUser:
 * true. Typing a valid-looking but wrong email (like `alise@` when you
 * meant `alice@`) silently created an orphan auth.users row and sent
 * a code to the wrong address. User never got the code, gave up. The
 * orphan row sat forever.
 *
 * The fix: signInWithOtp is called with shouldCreateUser: false first.
 * If Supabase reports no account for that email, the UI transitions
 * to a "signup-confirm" state offering (a) create account and send
 * code, or (b) use a different email. Typo path stays cheap — nothing
 * is written server-side unless the user explicitly confirms.
 *
 * Uses local Supabase and admin API to verify no phantom rows land.
 */

import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  throw new Error('typo-email-signup-gate spec requires cloud env vars');
}

const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserByEmail(email: string) {
  const { data, error } = await admin.auth.admin.listUsers();
  if (error) throw error;
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
}

async function requestOtpFor(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.waitForSelector('[data-testid="login-page"]');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-send-link').click();
}

test.describe('login — unrecognized emails route through signup confirmation gate', () => {
  const typoEmail = `typo-${Date.now()}-${process.pid}@ikigai.test`;

  test.afterAll(async () => {
    // Clean up any user this spec might have created (typo email path
    // shouldn't, but confirmed-signup path does).
    const user = await findUserByEmail(typoEmail);
    if (user) await admin.auth.admin.deleteUser(user.id).catch(() => {});
  });

  test('typo email surfaces confirm-signup UI and does NOT create an auth.users row', async ({
    browser,
  }) => {
    test.setTimeout(30_000);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // Before the request: no user exists for this email.
    const before = await findUserByEmail(typoEmail);
    expect(before).toBeUndefined();

    await requestOtpFor(page, typoEmail);

    // Signup confirmation banner should appear — NOT the "sent"
    // confirmation and NOT the generic error banner.
    await page.waitForSelector('[data-testid="login-signup-confirm"]', {
      timeout: 10_000,
    });

    const sent = await page.locator('[data-testid="login-sent"]').count();
    expect(sent).toBe(0);
    const error = await page.locator('[data-testid="login-error"]').count();
    expect(error).toBe(0);

    // Critical: no phantom user was created. Give Supabase a moment
    // to settle any in-flight write and re-check.
    await page.waitForTimeout(500);
    const after = await findUserByEmail(typoEmail);
    expect(
      after,
      'typo email attempt must NOT create an auth.users row',
    ).toBeUndefined();

    await ctx.close();
  });

  test('clicking "Use a different email" from the confirm gate resets the form', async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await requestOtpFor(page, typoEmail);
    await page.waitForSelector('[data-testid="login-signup-confirm"]');

    await page.getByTestId('login-signup-use-different-email').click();

    // Banner is gone; email input is blank; user can start over.
    await expect(
      page.locator('[data-testid="login-signup-confirm"]'),
    ).toHaveCount(0);
    await expect(page.getByTestId('login-email')).toHaveValue('');

    await ctx.close();
  });

  test('clicking "Create account and send code" DOES create the user and send the code', async ({
    browser,
  }) => {
    test.setTimeout(30_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await requestOtpFor(page, typoEmail);
    await page.waitForSelector('[data-testid="login-signup-confirm"]');

    await page.getByTestId('login-confirm-signup').click();

    // Transitions to the "sent" state with the code-input form ready.
    await page.waitForSelector('[data-testid="login-sent"]', {
      timeout: 15_000,
    });

    // Now a user DOES exist for this email — because the user
    // explicitly opted in.
    await page.waitForTimeout(500);
    const user = await findUserByEmail(typoEmail);
    expect(user).toBeDefined();

    await ctx.close();
  });
});
