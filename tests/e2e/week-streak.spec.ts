import { expect } from '@playwright/test';
import { test } from './fixtures';
import { completeOnboarding, addTask } from './helpers';

// Streak is fully derived from existing WeekPlan/WeekLogEntry data (see
// lib/useWeekStreak.ts) — works identically for local/signed-out users,
// same as the rest of AI Insights, so no cloud/auth setup needed here.
// Lives in TopNav (every page), not a specific route — tests check it
// shows up consistently across pages, not just one.

test('weekly streak badge appears after logging hours, absent before, and shows on every page', async ({
  page,
}) => {
  await completeOnboarding(page);
  await addTask(page, { title: 'Work', hours: 10 });
  await page.getByTestId('complete-planning').click();
  await expect(page).toHaveURL('/');

  await expect(page.getByTestId('week-streak-badge')).toHaveCount(0);

  await page.goto('/log');
  await expect(page.getByTestId('log-panel')).toBeVisible();
  await page.getByLabel('Hours for Work').fill('2');
  await page.getByRole('button', { name: 'Save log' }).click();
  await expect(page.getByRole('button', { name: 'Save log' })).toBeEnabled();

  // Visible right away on /log itself (TopNav, not an /insights-only feature).
  await expect(page.getByTestId('week-streak-badge')).toBeVisible();
  await expect(page.getByTestId('week-streak-count')).toHaveText('1');

  // And still visible after navigating elsewhere.
  await page.goto('/insights');
  await expect(page.getByTestId('week-streak-badge')).toBeVisible();
  await page.goto('/history');
  await expect(page.getByTestId('week-streak-badge')).toBeVisible();
});

test('clicking the streak badge opens details with recent-weeks history', async ({ page }) => {
  await completeOnboarding(page);
  await addTask(page, { title: 'Work', hours: 10 });
  await page.getByTestId('complete-planning').click();
  await expect(page).toHaveURL('/');

  await page.goto('/log');
  await page.getByLabel('Hours for Work').fill('2');
  await page.getByRole('button', { name: 'Save log' }).click();
  await expect(page.getByRole('button', { name: 'Save log' })).toBeEnabled();

  await expect(page.getByTestId('week-streak-badge')).toBeVisible();
  await page.getByTestId('week-streak-badge').click();

  await expect(page.getByTestId('week-streak-popover')).toBeVisible();
  await expect(page.getByTestId('week-streak-popover')).toContainText('1 week streak');
  await expect(page.getByTestId('week-streak-popover')).toContainText('Longest streak');
  await expect(page.getByTestId('week-streak-history')).toBeVisible();

  // Closes on outside click.
  await page.mouse.click(10, 10);
  await expect(page.getByTestId('week-streak-popover')).toHaveCount(0);
});
