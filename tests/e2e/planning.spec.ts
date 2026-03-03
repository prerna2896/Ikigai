import { test, expect } from '@playwright/test';

test('planning: add tasks persists across refresh', async ({ page }) => {
  await page.goto('/week/plan');

  // Neutral banner exists
  await expect(page.getByTestId('planning-banner')).toBeVisible();

  // Add a task
  await page.getByTestId('task-title-input').fill('Gym');
  await page.getByTestId('task-hours-input').fill('2');
  await page.getByTestId('add-task').click();

  await expect(page.getByTestId('task-row')).toHaveCount(1);
  await expect(page.getByText('Gym')).toBeVisible();

  // Refresh
  await page.reload();
  await expect(page.getByText('Gym')).toBeVisible();
});