import { expect } from '@playwright/test';
import { test } from './fixtures';
import { addTask, completeOnboarding } from './helpers';

test.describe('IkigaiPrinciplesPlot', () => {
  test('renders four principle wedges and shows hover/click legend with domain breakdown', async ({
    page,
  }) => {
    await completeOnboarding(page);

    // Add tasks that route to two different principles. "Deep work" →
    // Work / Study domain → growth principle (via "study" keyword);
    // "Run" → Health domain → energy principle.
    await addTask(page, { title: 'Deep work', hours: 10 });
    await addTask(page, { title: 'Run', hours: 4 });

    // Switch to the Ikigai roll-up.
    await page.getByRole('button', { name: 'Ikigai' }).click();

    // No principle pinned yet — legend prompts the user.
    await expect(page.getByTestId('principle-legend-idle')).toBeVisible();

    // The radar always has 4 wedges (one per principle), regardless of
    // which ones currently have hours.
    const segments = page.locator('[data-testid^="plot-segment-"]');
    await expect(segments).toHaveCount(4);

    // Hover the wedge for "growth" — Work / Study rolls up here.
    const growth = page.locator(
      '[data-testid^="plot-segment-"][data-principle-id="growth"]',
    );
    await growth.hover();
    const legend = page.getByTestId('principle-legend');
    await expect(legend).toBeVisible();
    await expect(page.getByTestId('principle-legend-name')).toHaveText(
      'Growth',
    );
    await expect(page.getByTestId('principle-legend-stats')).toContainText(
      /\d+(\.\d+)?h planned \(\d+%\)/,
    );
    await expect(page.getByTestId('principle-legend-domains')).toContainText(
      /Work\s*\/\s*Study \d+(\.\d+)?h/,
    );

    // Click the wedge — sidebar panel opens for the principle. A
    // single click must pin reliably (no "moving target" — the
    // visible triangles transition fill-opacity but the hit-zone
    // stays put).
    await growth.click();
    await expect(page.getByTestId('selected-segment-panel')).toBeVisible();
    // The legend's pin hint disappears once the principle is pinned.
    await expect(page.getByTestId('principle-legend')).not.toContainText(
      'Click to pin this principle.',
    );
  });

  test('clicking each visible quadrant selects the principle whose triangle owns it', async ({
    page,
  }) => {
    // Regression: hit-zones used to be centred on each principle's
    // own axis (±45°), so clicking on the lower half of the visible
    // "energy" triangle (a bottom-right wedge between right and
    // bottom axes) actually fell into the "growth" hit-zone, even
    // though the user was clearly pointing at the energy triangle.
    await completeOnboarding(page);
    await addTask(page, { title: 'Deep work', hours: 8 });
    await addTask(page, { title: 'Run', hours: 4 });
    await page.getByRole('button', { name: 'Ikigai' }).click();

    const svg = page.getByTestId('week-plot').locator('svg').first();

    // Each cardinal click lands squarely inside one quadrant.
    const cases: Array<{
      angle: number;
      principle: string;
      label: string;
    }> = [
      { angle: -Math.PI / 4, principle: 'alignment', label: 'top-right' },
      { angle: Math.PI / 4, principle: 'energy', label: 'bottom-right' },
      { angle: (3 * Math.PI) / 4, principle: 'growth', label: 'bottom-left' },
      { angle: (-3 * Math.PI) / 4, principle: 'contribution', label: 'top-left' },
    ];

    for (const c of cases) {
      // Re-fetch the bounding box every iteration: pinning a principle
      // auto-scrolls the side panel into view, which moves the chart's
      // viewport coordinates relative to where they were before.
      await svg.scrollIntoViewIfNeeded();
      const box = await svg.boundingBox();
      if (!box) throw new Error('No svg bounding box');
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const r = Math.min(box.width, box.height) * 0.18;
      const x = cx + Math.cos(c.angle) * r;
      const y = cy + Math.sin(c.angle) * r;
      await page.mouse.click(x, y);
      await expect(
        page.getByTestId('principle-legend'),
        `clicking the ${c.label} quadrant should pin "${c.principle}"`,
      ).toHaveAttribute('data-principle-id', c.principle);
      // Click outside the chart wrapper to clear the pinned principle
      // before the next iteration. Clicking the chart's centre would
      // hit one of the hit-zones (they all include the origin), so
      // we use the planning banner well above the plot instead.
      await page.getByTestId('planning-banner').click({ position: { x: 5, y: 5 } });
      await expect(page.getByTestId('principle-legend-idle')).toBeVisible();
    }
  });

  test('shows the empty-state legend when no domain has planned hours', async ({
    page,
  }) => {
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'Ikigai' }).click();
    await expect(page.getByTestId('principle-legend-empty')).toBeVisible();
    // Wedges still render so the diamond reads as a chart, just at zero
    // radius — but we don't make any visual assertion about that here.
  });

  test('inner completion triangle only renders for principles with logged hours', async ({
    page,
  }) => {
    await completeOnboarding(page);
    // Work / Study → growth principle (matches "study" first).
    await addTask(page, { title: 'Deep work', hours: 10 });
    await page.getByRole('button', { name: 'Ikigai' }).click();

    // Without any logs, no principle has logged hours: every wedge
    // reports data-has-completion="false" and the diamond is just the
    // washed-out planned outline.
    const segments = page.locator('[data-testid^="plot-segment-"]');
    await expect(segments).toHaveCount(4);
    const before = await segments.evaluateAll((nodes) =>
      nodes.map((n) => (n as HTMLElement).dataset.hasCompletion),
    );
    expect(before.every((v) => v === 'false')).toBe(true);

    // Seed a WeekLog for the only task so growth's completion is non-zero.
    const seed = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('ikigai');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const plan = await new Promise<{
        id: string;
        domains: { id: string; tasks: { id: string }[] }[];
      } | null>((resolve, reject) => {
        const tx = db.transaction('weekPlans', 'readonly');
        const req = tx.objectStore('weekPlans').getAll();
        req.onsuccess = () => {
          const plans = req.result as Array<{
            id: string;
            weekStartISO: string;
            domains: { id: string; tasks: { id: string }[] }[];
          }>;
          const sorted = plans.sort((a, b) =>
            a.weekStartISO < b.weekStartISO ? 1 : -1,
          );
          resolve(sorted[0] ?? null);
        };
        req.onerror = () => reject(req.error);
      });
      if (!plan) throw new Error('No week plan');
      const taskId = plan.domains.flatMap((d) => d.tasks)[0]?.id;
      if (!taskId) throw new Error('No task');
      const now = new Date().toISOString();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('weekLogs', 'readwrite');
        tx.objectStore('weekLogs').put({
          id: crypto.randomUUID(),
          weekId: plan.id,
          dateISO: now,
          taskHours: { [taskId]: 7 },
          createdAt: now,
          updatedAt: now,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      return { taskId };
    });
    expect(seed.taskId).toBeTruthy();

    await page.reload();
    await page.getByRole('button', { name: 'Ikigai' }).click();

    // Growth now has logged hours → its hit-zone reports completion;
    // every other principle stays at zero so they remain unfilled.
    const growth = page.locator(
      '[data-testid^="plot-segment-"][data-principle-id="growth"]',
    );
    await expect(growth).toHaveAttribute('data-has-completion', 'true');
    await expect(growth).toHaveAttribute('data-completed-hours', '7');

    const others = page.locator(
      '[data-testid^="plot-segment-"]:not([data-principle-id="growth"])',
    );
    const otherFlags = await others.evaluateAll((nodes) =>
      nodes.map((n) => (n as HTMLElement).dataset.hasCompletion),
    );
    expect(otherFlags.every((v) => v === 'false')).toBe(true);

    // Hover Growth and verify the legend uses the completion format.
    await growth.hover();
    const stats = page.getByTestId('principle-legend-stats');
    await expect(stats).toContainText('7 of 10h planned');
    await expect(stats).toContainText('70% complete');
    await expect(page.getByTestId('principle-legend-domains')).toContainText(
      /Work\s*\/\s*Study 7\/10h/,
    );
  });
});
