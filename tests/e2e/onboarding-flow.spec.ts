import { expect } from '@playwright/test';
import { test } from './fixtures';

test('onboarding flow follows required navigation rules', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('home-tab-get-started').click();

  await expect(page).toHaveURL(/onboarding\/context/);
  await expect(page.getByTestId('onboarding-home')).toBeVisible();
  await expect(page.getByTestId('onboarding-next')).toBeVisible();
  await expect(page.getByTestId('onboarding-back')).toHaveCount(0);

  const nameInput = page.getByTestId('onboarding-name-input');
  if (await nameInput.isVisible()) {
    await nameInput.fill('Test User');
  }
  await page.getByTestId('onboarding-next').click();

  await expect(page).toHaveURL(/onboarding\/tone/);
  await expect(page.getByTestId('onboarding-home')).toBeVisible();
  await expect(page.getByTestId('onboarding-back')).toBeVisible();
  await expect(page.getByTestId('onboarding-next')).toBeVisible();
  await page.getByTestId('onboarding-next').click();

  await expect(page).toHaveURL(/onboarding\/reflection/);
  await expect(page.getByTestId('onboarding-home')).toBeVisible();
  await expect(page.getByTestId('onboarding-back')).toBeVisible();
  await expect(page.getByTestId('onboarding-next')).toBeVisible();
  await page.getByTestId('onboarding-next').click();

  await expect(page).toHaveURL(/onboarding\/settings/);
  await expect(page.getByTestId('onboarding-home')).toBeVisible();
  await expect(page.getByTestId('onboarding-back')).toBeVisible();
  await expect(page.getByTestId('onboarding-settings-step')).toBeVisible();

  for (let step = 0; step < 5; step += 1) {
    const finish = page.getByTestId('onboarding-finish');
    if (await finish.isVisible()) {
      await expect(finish).toHaveText('Finish setup');
      await finish.click();
      break;
    }
    await page.getByTestId('onboarding-next').click();
  }

  await expect(page).toHaveURL(/week\/plan/);
});
