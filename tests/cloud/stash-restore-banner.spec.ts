/**
 * StashRestoreBanner UX — the "we saved a draft from earlier" prompt
 * that replaced the original silent auto-fill on all five form-stash
 * call sites (LogPanel, reflect page × 2, WeekGoals, onboarding
 * goals + context).
 *
 * This spec exercises the onboarding/context wiring because it's the
 * only anonymous, no-auth-required stash surface — enough to prove
 * the hook + banner contract end-to-end without dragging in Supabase
 * or Dexie plans. The hook itself is shared, so if this works the
 * other four call sites work the same way modulo their own wiring.
 *
 * Coverage:
 *   1. Type into a stashed input → reload → banner appears.
 *   2. Click Restore → input has the stashed value, banner is gone.
 *   3. Reload again → banner comes back (restore keeps the stash in
 *      place so the user isn't punished for a second reload).
 *   4. Click Discard → input stays empty, banner is gone.
 *   5. Reload once more → no banner (Discard cleared the stash).
 *
 * Runs against whichever dev server PLAYWRIGHT_BASE_URL points at
 * (defaults to 3724 in playwright.cloud.config.ts) — this test only
 * needs the anonymous /onboarding/context path.
 */

import { test, expect } from '@playwright/test';

const DRAFT = 'Test draft';

test.describe('stash restore banner', () => {
  test('restore + discard flow on the anonymous onboarding name input', async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // Land on the onboarding-context page anonymously. The profile
    // fetch there will resolve to `null` (no local profile) and keep
    // us on this page — that's what makes it a clean stash target.
    await page.goto('/onboarding/context');
    const nameInput = page.getByTestId('onboarding-name-input');
    await expect(nameInput).toBeVisible();

    // Type a draft. useStashedField's setValue stashes on every
    // change, so the value now lives in sessionStorage.
    await nameInput.fill(DRAFT);
    await expect(nameInput).toHaveValue(DRAFT);

    // Reload → hook mounts, sees stash != initialValue (''), exposes
    // pendingRestore → banner renders.
    await page.reload();
    await expect(page.getByTestId('onboarding-name-input')).toBeVisible();
    const banner = page.getByTestId('stash-restore-banner');
    await expect(banner).toBeVisible();
    // Value starts empty on reload — we don't auto-apply.
    await expect(page.getByTestId('onboarding-name-input')).toHaveValue('');

    // Restore accepts the draft.
    await page.getByTestId('stash-restore-accept').click();
    await expect(page.getByTestId('onboarding-name-input')).toHaveValue(DRAFT);
    await expect(page.getByTestId('stash-restore-banner')).toHaveCount(0);

    // Reload — restore left the stash intact on purpose (the user
    // hasn't actually saved yet), so the banner should re-appear.
    await page.reload();
    await expect(page.getByTestId('stash-restore-banner')).toBeVisible();
    await expect(page.getByTestId('onboarding-name-input')).toHaveValue('');

    // Discard clears the stash without applying it. Input stays empty.
    await page.getByTestId('stash-restore-discard').click();
    await expect(page.getByTestId('onboarding-name-input')).toHaveValue('');
    await expect(page.getByTestId('stash-restore-banner')).toHaveCount(0);

    // Final reload — stash was cleared by Discard, so no banner
    // should appear this time.
    await page.reload();
    await expect(page.getByTestId('onboarding-name-input')).toBeVisible();
    // Give the hook a beat to derive pendingRestore before asserting
    // absence — otherwise a race could mask a regression.
    await page.waitForTimeout(200);
    await expect(page.getByTestId('stash-restore-banner')).toHaveCount(0);
    await expect(page.getByTestId('onboarding-name-input')).toHaveValue('');

    await ctx.close();
  });
});
