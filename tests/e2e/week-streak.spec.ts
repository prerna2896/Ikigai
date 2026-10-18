import { expect } from '@playwright/test';
import { test } from './fixtures';
import { completeOnboarding, addTask } from './helpers';

// Streak is fully derived from existing WeekPlan/WeekLogEntry data (see
// lib/useWeekStreak.ts) — works identically for local/signed-out users,
// same as the rest of AI Insights, so no cloud/auth setup needed here.

test('weekly streak badge appears after logging hours, absent before', async ({ page }) => {
  await completeOnboarding(page);
  await addTask(page, { title: 'Work', hours: 10 });
  await page.getByTestId('complete-planning').click();
  await expect(page).toHaveURL('/');

  await page.goto('/insights');
  await expect(page.getByTestId('insights-page')).toBeVisible();
  await expect(page.getByTestId('week-streak-badge')).toHaveCount(0);

  await page.goto('/log');
  await expect(page.getByTestId('log-panel')).toBeVisible();
  await page.getByLabel('Hours for Work').fill('2');
  await page.getByRole('button', { name: 'Save log' }).click();
  await expect(page.getByRole('button', { name: 'Save log' })).toBeEnabled();

  await page.goto('/insights');
  await expect(page.getByTestId('week-streak-badge')).toBeVisible();
  await expect(page.getByTestId('week-streak-count')).toHaveText('1 week streak');
});
