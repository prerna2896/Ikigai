import { expect } from '@playwright/test';
import { test } from './fixtures';
import { completeOnboarding } from './helpers';

test('onboarding completes and persists', async ({ page }) => {
  await completeOnboarding(page);

  await page.goto('/profile');
  await expect(page.getByTestId('profile-page')).toBeVisible();
});
