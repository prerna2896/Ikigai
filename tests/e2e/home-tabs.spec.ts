import { expect } from '@playwright/test';
import { test } from './fixtures';

test('home tabs navigate to primary areas', async ({ page }) => {
  await page.goto('/');

  const tabs = page.getByTestId('home-tabs');
  await expect(tabs).toBeVisible();

  const getStarted = page.getByTestId('home-tab-get-started');
  const goPlanning = page.getByTestId('home-tab-planning');
  const openProfile = page.getByTestId('home-tab-profile');
  const viewHistory = page.getByTestId('home-tab-history');

  await expect(getStarted).toHaveText('Get started');
  await expect(goPlanning).toHaveText('Go to planning');
  await expect(openProfile).toHaveText('Open profile');
  await expect(viewHistory).toHaveText('View history');

  await getStarted.click();
  await expect(page).toHaveURL(/onboarding\/context/);

  await page.goto('/');
  await goPlanning.click();
  await expect(page).toHaveURL(/(week\/plan|onboarding\/context)/);

  await page.goto('/');
  await openProfile.click();
  await expect(page.getByTestId('profile-page')).toBeVisible();

  await page.goto('/');
  await viewHistory.click();
  await expect(page.getByTestId('history-page')).toBeVisible();
});
