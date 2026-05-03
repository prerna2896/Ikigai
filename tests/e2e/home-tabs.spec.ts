import { expect } from '@playwright/test';
import { test } from './fixtures';

test('home tabs navigate to primary areas', async ({ page }) => {
  await page.goto('/');

  const tabs = page.getByTestId('home-tabs');
  await expect(tabs).toBeVisible();

  const goPlanning = page.getByTestId('home-tab-planning');
  const openProfile = page.getByTestId('home-tab-profile');
  const viewHistory = page.getByTestId('home-tab-history');

  await expect(goPlanning).toHaveText('Plan');
  await expect(openProfile).toHaveAccessibleName('Profile');
  await expect(viewHistory).toHaveText('History');

  await goPlanning.click();
  await expect(page).toHaveURL(/(week\/plan|onboarding\/context)/);

  await page.goto('/');
  await openProfile.click();
  await expect(page.getByTestId('profile-page')).toBeVisible();

  await page.goto('/');
  await viewHistory.click();
  await expect(page.getByTestId('history-page')).toBeVisible();
});
