import { expect } from '@playwright/test';
import { test } from './fixtures';
import { completeOnboarding, addTask, getTaskRowByTitle } from './helpers';

test('planning: add tasks persists across refresh', async ({ page }) => {
  await completeOnboarding(page);

  await expect(page.getByTestId('planning-banner')).toBeVisible();

  await addTask(page, { title: 'Gym', hours: 2 });
  await expect(page.getByTestId('task-row')).toHaveCount(1);

  await page.reload();
  await expect(page.getByTestId('task-row')).toHaveCount(1);
  const gymRow = await getTaskRowByTitle(page, 'Gym');
  await expect(gymRow.getByTestId('task-row-title')).toHaveValue('Gym');
});
