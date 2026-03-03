import { test, expect } from '@playwright/test';

test('onboarding completes and persists', async ({ page }) => {
  await page.goto('/');

  // Click start onboarding
  await page.getByRole('button', { name: /start/i }).click();

  // Name
  await page.getByTestId('onboarding-name-input').fill('Prerna');
  await page.getByTestId('onboarding-next').click();

  // Questions page (example)
  await page.getByTestId('context-q1').click(); // if multiple choice
  await page.getByTestId('onboarding-next').click();

  // Settings save
  await page.getByTestId('settings-save').click();

  // Land on planning
  await expect(page).toHaveURL(/week\/plan/);

  // Refresh persists
  await page.reload();
  await expect(page.getByTestId('profile-name')).toContainText('Prerna');
});