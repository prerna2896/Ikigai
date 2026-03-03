import { test, expect } from '@playwright/test';

test('planning redirects to onboarding if profile not set', async ({ page }) => {
  // Only valid if you have gating logic.
  await page.goto('/week/plan');
  await expect(page).toHaveURL(/onboarding|start/i);
});
