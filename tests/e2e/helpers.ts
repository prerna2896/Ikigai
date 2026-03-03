import { expect, type Locator, type Page } from '@playwright/test';

export const resetAppState = async (page: Page) => {
  const response = await page.request.post('/api/dev/reset');
  expect(response.ok()).toBeTruthy();
  await page.goto('/');
  await page.waitForFunction(
    () => (window as any).__IKIGAI_RESET_COMPLETE__ === true,
  );
};

export const completeOnboarding = async (page: Page) => {
  await page.goto('/');
  await page.getByTestId('home-tab-get-started').click();
  await expect(page).toHaveURL(/onboarding\/context/);

  const nameInput = page.getByTestId('onboarding-name-input');
  if (await nameInput.isVisible()) {
    await nameInput.fill('Test User');
  }
  await page.getByTestId('onboarding-next').click();

  await expect(page).toHaveURL(/onboarding\/tone/);
  await page.getByTestId('onboarding-next').click();

  await expect(page).toHaveURL(/onboarding\/reflection/);
  const firstText = page.locator('[data-testid^="reflection-input-"]').first();
  if (await firstText.isVisible()) {
    await firstText.fill('Noted.');
  }
  const firstOption = page.locator('[data-testid^="reflection-option-"]').first();
  if (await firstOption.isVisible()) {
    await firstOption.click();
  }
  await page.getByTestId('onboarding-next').click();

  await expect(page).toHaveURL(/onboarding\/settings/);
  for (let index = 0; index < 5; index += 1) {
    const finish = page.getByTestId('onboarding-finish');
    if (await finish.isVisible()) {
      await finish.click();
      break;
    }
    await page.getByTestId('onboarding-next').click();
  }

  await expect(page).toHaveURL(/week\/plan/);
};

export const getTaskRowByTitle = async (
  page: Page,
  title: string,
): Promise<Locator> => {
  const rows = page.getByTestId('task-row');
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const text = await row.getByTestId('task-row-title').inputValue();
    if (text.trim().toLowerCase() === title.trim().toLowerCase()) {
      return row;
    }
  }
  throw new Error(`Task row not found for title: ${title}`);
};

export const addTask = async (
  page: Page,
  task: { title: string; hours: number | string },
) => {
  await page.getByTestId('task-title-input').fill(task.title);
  await page.getByTestId('task-hours-input').fill(String(task.hours));
  const beforeCount = await page.getByTestId('task-row').count();
  await page.getByTestId('add-task-button').click();
  await expect(page.getByTestId('task-row')).toHaveCount(beforeCount + 1);
  const row = await getTaskRowByTitle(page, task.title);
  await expect(row.getByTestId('task-row-title')).toHaveValue(task.title);
};

export const selectPlotSegment = async (page: Page, index = 0) => {
  await page.getByTestId(`plot-segment-${index}`).click();
  await expect(page.getByTestId('selected-segment-panel')).toBeVisible();
};
