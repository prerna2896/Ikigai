import { expect } from '@playwright/test';
import { test } from './fixtures';

test('app loads and homepage renders', async ({ page }) => {
  await page.goto('/');

  // Replace this with something specific from your UI
  await expect(page).toHaveTitle(/Ikigai|Plan|Wheel/i);
});
