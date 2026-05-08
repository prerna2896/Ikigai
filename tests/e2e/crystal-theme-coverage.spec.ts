import { expect } from '@playwright/test';
import { test } from './fixtures';
import { addTask, completeOnboarding } from './helpers';
import { CRYSTAL_THEMES } from '../../components/CrystalIkigai/types';

const themeIds = Object.keys(CRYSTAL_THEMES) as Array<
  keyof typeof CRYSTAL_THEMES
>;

// Parameterized over every theme in CRYSTAL_THEMES so adding a new
// theme to the record automatically gets covered: each entry must
// render the chart, expose its segments, and let the user hover one
// to populate the legend without errors.
for (const id of themeIds) {
  test(`theme \"${id}\" renders the chart end-to-end`, async ({ page }) => {
    await completeOnboarding(page);
    await addTask(page, { title: 'Deep work', hours: 8 });
    await addTask(page, { title: 'Run', hours: 3 });

    await page.getByTestId('theme-picker-toggle').click();
    await page.getByTestId(`theme-option-${id}`).click();

    // The theme is applied to the document root.
    await expect(page.locator('html')).toHaveAttribute('data-theme', id);

    const segments = page.locator('[data-testid^="plot-segment-"]');
    await expect(segments).toHaveCount(2);

    // Scroll the chart into view first — the boundingBox reads
    // viewport coordinates, and mouse.move outside the viewport
    // doesn't deliver events to the page.
    const svg = page.getByTestId('week-plot').locator('svg').first();
    await svg.scrollIntoViewIfNeeded();
    const svgBox = await svg.boundingBox();
    expect(svgBox).toBeTruthy();
    expect(svgBox!.width).toBeGreaterThan(600);

    // Hover populates the legend with the domain's planned-hours stat.
    // Crystal segments are pointer-events: none (a single math-based
    // hit-disc owns dispatch), so dispatch the hover at the wedge's
    // mid-angle in viewport coordinates.
    const midAngle = Number(
      await segments.first().getAttribute('data-mid-angle-rad'),
    );
    const cx = svgBox!.x + svgBox!.width / 2;
    const cy = svgBox!.y + svgBox!.height / 2;
    const r = Math.min(svgBox!.width, svgBox!.height) * 0.22;
    await page.mouse.move(
      cx + Math.cos(midAngle) * r,
      cy + Math.sin(midAngle) * r,
    );
    await expect(page.getByTestId('crystal-legend')).toBeVisible();
    await expect(page.getByTestId('crystal-legend-stats')).toContainText(
      /\d+(\.\d+)?h planned/,
    );
  });
}

test('theme metadata covers every variant id', () => {
  // Guards against an id being added to CrystalVariant without a
  // matching CRYSTAL_THEMES entry (the parameterized loop above only
  // walks ids that already have entries).
  for (const id of themeIds) {
    const meta = CRYSTAL_THEMES[id];
    expect(meta.id).toBe(id);
    expect(meta.palette.length).toBeGreaterThanOrEqual(7);
    expect(typeof meta.isDark).toBe('boolean');
    expect(meta.centerFill.length).toBeGreaterThan(0);
    expect(meta.centerStroke.length).toBeGreaterThan(0);
    expect(meta.ringColor.length).toBeGreaterThan(0);
  }
});
