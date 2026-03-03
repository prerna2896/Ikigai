import { expect } from '@playwright/test';
import { test } from './fixtures';
import { completeOnboarding, addTask, selectPlotSegment, getTaskRowByTitle } from './helpers';

test('planning flow: add/edit tasks, plot interaction, persistence', async ({ page }) => {
  await completeOnboarding(page);

  await expect(page).toHaveURL(/week\/plan/);
  await expect(page.getByTestId('planning-page')).toBeVisible();

  await addTask(page, { title: 'Work', hours: 10 });
  await addTask(page, { title: 'Health', hours: 2 });
  await addTask(page, { title: 'Maintenance', hours: 5 });

  const taskRows = page.getByTestId('task-row');
  await expect(taskRows).toHaveCount(3);

  const workRow = await getTaskRowByTitle(page, 'Work');
  await workRow.getByTestId('task-row-hours').fill('12');
  await workRow.getByTestId('task-row-domain').click();
  const domainOptions = workRow.locator('[data-testid^="task-domain-option-"]');
  if (await domainOptions.count()) {
    await domainOptions.first().click();
  }

  await expect(page.getByTestId('week-plot')).toBeVisible();
  const segments = page.locator('[data-testid^="plot-segment-"]');
  expect(await segments.count()).toBeGreaterThan(0);
  await selectPlotSegment(page, 0);
  await expect(page.getByTestId('selected-segment-tasks')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('task-row')).toHaveCount(3);
  const reloadedWorkRow = await getTaskRowByTitle(page, 'Work');
  await expect(reloadedWorkRow.getByTestId('task-row-title')).toHaveValue('Work');

  await page.getByTestId('complete-planning').click();
  await expect(page).toHaveURL('/');
  await expect(page.getByTestId('latest-week')).toBeVisible();
});
