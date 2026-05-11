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
  await page.getByTestId('home-cta-get-started').click();
  await expect(page).toHaveURL(/onboarding\/context/);

  const nameInput = page.getByTestId('onboarding-name-input');
  if (await nameInput.isVisible()) {
    await nameInput.fill('Test User');
  }
  await page.getByTestId('onboarding-next').click();

  await expect(page).toHaveURL(/onboarding\/tone/);
  await page.getByTestId('onboarding-next').click();

  await expect(page).toHaveURL(/onboarding\/reflection/);
  // Reflection is a single page with state-based question advancement
  // (counter goes "Question N of M"), so URL doesn't change between
  // questions — we wait on the counter text instead of networkidle.
  const counter = page.getByTestId('reflection-question-counter');
  for (let step = 0; step < 10; step += 1) {
    if (page.url().includes('/onboarding/settings')) break;
    const before = await counter.textContent().catch(() => null);
    const textInput = page.locator('[data-testid^="reflection-input-"]').first();
    if (await textInput.count()) {
      await textInput.fill('Noted.');
    } else {
      const firstOption = page
        .locator('[data-testid^="reflection-option-"]')
        .first();
      if (await firstOption.count()) {
        await firstOption.click();
      }
    }
    await page.getByTestId('onboarding-next').click();
    await Promise.race([
      page.waitForURL(/onboarding\/settings/, { timeout: 5_000 }),
      counter
        .filter({ hasNotText: before ?? '___never___' })
        .waitFor({ timeout: 5_000 }),
    ]).catch(() => undefined);
  }

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
  // The Crystal chart now delegates hit-testing to a single math-
  // based hit-disc rather than per-wedge SVG paths, so the wedge
  // <g> is pointer-events: none and Playwright can't click it
  // directly. If the segment exposes data-mid-angle-rad we dispatch
  // via the wedge's mid-point in viewport coordinates; otherwise
  // (Ikigai principles plot, IkigaiWheelPlot fallback) the testid
  // click still works.
  const segment = page.getByTestId(`plot-segment-${index}`);
  const midAngle = await segment.getAttribute('data-mid-angle-rad');
  if (midAngle !== null) {
    const svg = page.getByTestId('week-plot').locator('svg').first();
    await svg.scrollIntoViewIfNeeded();
    const box = await svg.boundingBox();
    if (!box) throw new Error('No svg bounding box');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const r = Math.min(box.width, box.height) * 0.22;
    const angle = Number(midAngle);
    await page.mouse.click(
      cx + Math.cos(angle) * r,
      cy + Math.sin(angle) * r,
    );
  } else {
    await segment.click();
  }
  await expect(page.getByTestId('selected-segment-panel')).toBeVisible();
};
