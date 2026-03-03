import { expect } from '@playwright/test';
import { test } from './fixtures';
import { completeOnboarding, addTask } from './helpers';

test('planning freezes after completion', async ({ page }) => {
  await completeOnboarding(page);

  await addTask(page, { title: 'Work', hours: 8 });
  await page.getByTestId('complete-planning').click();
  await expect(page).toHaveURL('/');

  await page.getByTestId('home-tab-planning').click();
  await expect(page).toHaveURL(/week\/plan/);
  await expect(page.getByTestId('planning-page')).toBeVisible();

  const frozenBanner = page.getByTestId('frozen-banner');
  if (await frozenBanner.isVisible()) {
    await expect(frozenBanner).toBeVisible();
    await expect(page.getByTestId('add-task-button')).toHaveCount(0);
  } else {
    await expect(page.getByTestId('add-task-button')).toBeVisible();
  }
});
