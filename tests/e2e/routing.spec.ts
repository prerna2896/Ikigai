import { expect } from '@playwright/test';
import { test } from './fixtures';

test('planning redirects to onboarding if profile not set', async ({ page }) => {
  await page.goto('/week/plan');
  await expect(page).toHaveURL(/onboarding\/context/);
});
