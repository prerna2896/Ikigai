import { expect, type Locator, type Page } from '@playwright/test';
import { test } from './fixtures';
import { addTask, completeOnboarding, getTaskRowByTitle } from './helpers';

// Compute the viewport coordinates of a wedge's middle and dispatch
// a click there. The chart no longer relies on per-path SVG hit-
// testing — the math-based hit-disc dispatches via cursor angle —
// so tests must hit the disc at the wedge's mid-angle rather than
// calling `.hover()` / `.click()` directly on the now-pointer-events-
// none `<g>`.
const pointAtWedgeMid = async (page: Page, wedge: Locator) => {
  const midAngle = Number(await wedge.getAttribute('data-mid-angle-rad'));
  const svg = page.getByTestId('week-plot').locator('svg').first();
  await svg.scrollIntoViewIfNeeded();
  const box = await svg.boundingBox();
  if (!box) throw new Error('No svg bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // Half-way between innerR and maxR is safely inside the wedge.
  const r = Math.min(box.width, box.height) * 0.22;
  return { x: cx + Math.cos(midAngle) * r, y: cy + Math.sin(midAngle) * r };
};

test.describe('CrystalIkigai chart', () => {
  test('renders only domains with planned tasks and shows hover/click legend', async ({
    page,
  }) => {
    await completeOnboarding(page);
    await expect(page).toHaveURL(/week\/plan/);

    // Empty state before any tasks: no segments, empty-legend prompt
    // visible (every default domain has 0 planned hours so all are
    // filtered out of the chart).
    await expect(page.getByTestId('crystal-legend-empty')).toBeVisible();
    await expect(page.locator('[data-testid^="plot-segment-"]')).toHaveCount(0);

    // Add two tasks routed to two distinct default domains.
    await addTask(page, { title: 'Deep work block', hours: 10 });
    await addTask(page, { title: 'Run', hours: 4 });

    // Confirm the chart has rendered with the planned domains.
    await expect(page.getByTestId('week-plot')).toBeVisible();
    const segments = page.locator('[data-testid^="plot-segment-"]');
    const segmentCount = await segments.count();
    expect(segmentCount).toBeGreaterThanOrEqual(2);

    // The SVG must claim a generous on-screen width. We've been bitten
    // by the wrapper sizing to its own content (circular flex sizing)
    // and rendering ~300px wide. Guard against that by requiring at
    // least 600px of rendered width on the test viewport.
    const svgBox = await page
      .getByTestId('week-plot')
      .locator('svg')
      .first()
      .boundingBox();
    expect(svgBox).toBeTruthy();
    expect(svgBox!.width).toBeGreaterThan(600);

    // Empty domains (target === 0) must not render as segments — every
    // visible segment has a unique domain id.
    const segmentDomainIds = await segments.evaluateAll((nodes) =>
      nodes.map((n) => (n as HTMLElement).dataset.domainId).filter(Boolean),
    );
    expect(new Set(segmentDomainIds).size).toBe(segmentCount);

    // No domain is auto-selected — the legend should show its idle prompt.
    await expect(page.getByTestId('crystal-legend-idle')).toBeVisible();

    // Hover the first segment — legend populates with that domain's
    // name, planned-hours summary, and the pin hint.
    const target = segments.first();
    const targetPoint = await pointAtWedgeMid(page, target);
    await page.mouse.move(targetPoint.x, targetPoint.y);
    const legend = page.getByTestId('crystal-legend');
    await expect(legend).toBeVisible();
    await expect(page.getByTestId('crystal-legend-name')).not.toHaveText('');
    await expect(page.getByTestId('crystal-legend-stats')).toContainText(
      /\d+(\.\d+)?h planned/,
    );
    await expect(legend).toContainText('Click to pin this domain.');

    // Click the segment — panel opens, legend stays visible, and the
    // pin hint disappears because the domain is now pinned.
    await page.mouse.click(targetPoint.x, targetPoint.y);
    await expect(page.getByTestId('selected-segment-panel')).toBeVisible();
    await expect(page.getByTestId('crystal-legend')).toBeVisible();
    await expect(page.getByTestId('crystal-legend')).not.toContainText(
      'Click to pin this domain.',
    );

    // Clicking outside the chart wrapper deselects: legend reverts to
    // idle and the side panel closes.
    await page.getByTestId('planning-banner').click();
    await expect(page.getByTestId('crystal-legend-idle')).toBeVisible();
    await expect(page.getByTestId('selected-segment-panel')).toHaveCount(0);
  });

  test('wedge angles reflect domain target hours with a minimum floor', async ({
    page,
  }) => {
    await completeOnboarding(page);

    // Two tasks routed to two distinct default domains, with a 3:1
    // ratio of planned hours. Sizing is non-linear (sqrt-weighted) so
    // the bigger domain still gets the bigger wedge but the smaller
    // one keeps a legible footprint instead of collapsing.
    await addTask(page, { title: 'Deep work', hours: 9 });
    await addTask(page, { title: 'Run', hours: 3 });

    const segments = page.locator('[data-testid^="plot-segment-"]');
    await expect(segments).toHaveCount(2);

    const spans = await segments.evaluateAll((nodes) =>
      nodes
        .map((n) => Number((n as HTMLElement).dataset.spanDeg))
        .sort((a, b) => b - a),
    );
    expect(spans[0] + spans[1]).toBeGreaterThanOrEqual(359);
    expect(spans[0] + spans[1]).toBeLessThanOrEqual(361);
    // Bigger domain gets the bigger wedge.
    expect(spans[0]).toBeGreaterThan(spans[1]);
    // Smaller domain still claims at least the floor (~28°).
    expect(spans[1]).toBeGreaterThanOrEqual(28);
  });

  test('tiny domains stay above the wedge minimum size', async ({ page }) => {
    await completeOnboarding(page);

    // 50:1 ratio. Pure linear sizing would render the 1h wedge as a
    // ~7° sliver; the floor should keep it usable.
    await addTask(page, { title: 'Deep work', hours: 50 });
    await addTask(page, { title: 'Run', hours: 1 });

    const segments = page.locator('[data-testid^="plot-segment-"]');
    await expect(segments).toHaveCount(2);

    const spans = await segments.evaluateAll((nodes) =>
      nodes
        .map((n) => Number((n as HTMLElement).dataset.spanDeg))
        .sort((a, b) => a - b),
    );
    expect(spans[0]).toBeGreaterThanOrEqual(28);
  });

  test('legend shows planned-hours format while logged hours are zero', async ({
    page,
  }) => {
    await completeOnboarding(page);

    await addTask(page, { title: 'Deep work', hours: 8 });
    const row = await getTaskRowByTitle(page, 'Deep work');
    await expect(row).toBeVisible();

    const segments = page.locator('[data-testid^="plot-segment-"]');
    const point = await pointAtWedgeMid(page, segments.first());
    await page.mouse.move(point.x, point.y);

    // Plan view passes completed = 0, so the legend should use the
    // "{N}h planned" format rather than "{X} of {Y}h · {Z}% complete".
    const stats = page.getByTestId('crystal-legend-stats');
    await expect(stats).toBeVisible();
    await expect(stats).toContainText(/h planned$/);
    await expect(stats).not.toContainText('% complete');
  });

  test('hovering does not lift the wedge so clicks always register', async ({
    page,
  }) => {
    // Regression: lifting wedges on hover used to translate the path
    // mid-click, so a quick click would land on the SVG background
    // (mouseup after mousedown but the wedge had moved). The SVG
    // background click handler then cleared the selection.
    await completeOnboarding(page);
    await addTask(page, { title: 'Deep work', hours: 8 });
    await addTask(page, { title: 'Run', hours: 3 });

    const segments = page.locator('[data-testid^="plot-segment-"]');
    const target = segments.first();
    const point = await pointAtWedgeMid(page, target);

    // Hover should NOT lift the wedge — only the pinned state does.
    await page.mouse.move(point.x, point.y);
    await expect(target).toHaveAttribute('data-active', 'true');
    await expect(target).toHaveAttribute('data-pinned', 'false');

    // A single click — even right after the hover starts — must open
    // the side panel and pin the wedge.
    await page.mouse.click(point.x, point.y);
    await expect(page.getByTestId('selected-segment-panel')).toBeVisible();
    await expect(target).toHaveAttribute('data-pinned', 'true');

    // And the legend reflects the pin state (no pin hint shown).
    await expect(page.getByTestId('crystal-legend')).not.toContainText(
      'Click to pin this domain.',
    );
  });

  test('clicking on the boundary between two wedges always pins one of them', async ({
    page,
  }) => {
    // Regression: two adjacent wedges share a radial boundary line.
    // Sub-pixel anti-aliasing could leave a thin gap between them,
    // and the SVG-level "clear on background click" handler would
    // catch that miss and unpin the selection. The fix removes the
    // background-click handler and overlaps the wedges by ~0.3° so
    // the boundary is always covered by some wedge's fill.
    await completeOnboarding(page);
    await addTask(page, { title: 'Deep work', hours: 10 });
    await addTask(page, { title: 'Run', hours: 6 });

    const segments = page.locator('[data-testid^="plot-segment-"]');
    await expect(segments).toHaveCount(2);

    // Read each segment's data-span-deg to figure out where the
    // boundary between them sits, then click on that boundary.
    const spans = await segments.evaluateAll((nodes) =>
      nodes.map((n) => Number((n as HTMLElement).dataset.spanDeg)),
    );
    const firstSpanDeg = spans[0] ?? 0;
    // First wedge starts at 12 o'clock and sweeps clockwise. Boundary
    // angle (relative to the SVG centre, with +y down) is therefore
    // -π/2 + firstSpan.
    const boundaryAngle = -Math.PI / 2 + (firstSpanDeg * Math.PI) / 180;

    const svg = page.getByTestId('week-plot').locator('svg').first();
    await svg.scrollIntoViewIfNeeded();
    const box = await svg.boundingBox();
    if (!box) throw new Error('No svg bounding box');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // Pick a radius safely between innerR (~46) and maxR (~194) in
    // viewBox units — at 60% of half the rendered SVG, we're within
    // the wedge's fill area regardless of theme.
    const r = Math.min(box.width, box.height) * 0.25;
    const x = cx + Math.cos(boundaryAngle) * r;
    const y = cy + Math.sin(boundaryAngle) * r;

    await page.mouse.click(x, y);
    // Some wedge must end up pinned — the click must not silently
    // fall through to the SVG background.
    await expect(page.getByTestId('crystal-legend')).toBeVisible();
    const pinnedCount = await segments.evaluateAll((nodes) =>
      nodes.filter((n) => (n as HTMLElement).dataset.pinned === 'true').length,
    );
    expect(pinnedCount).toBe(1);
  });

  test('clicks near the outer ring and on labels still dispatch to the right wedge', async ({
    page,
  }) => {
    // Regression: previous attempts at fixing boundary-click flakiness
    // assumed users click in the middle of a wedge. In practice they
    // aim at the *visible* outer edge of the colored wedge (which
    // sits right next to or under the label text), and a 1-pixel
    // miss past maxR — or a click that lands on a `<text>` glyph —
    // would silently do nothing. The hit-disc now spans the entire
    // viewBox and labels are pointer-events: none, so any click
    // anywhere outside the inner cap dispatches by angle math.
    await completeOnboarding(page);
    await addTask(page, { title: 'Deep work', hours: 10 });
    await addTask(page, { title: 'Run', hours: 6 });

    const segments = page.locator('[data-testid^="plot-segment-"]');
    await expect(segments).toHaveCount(2);

    const svg = page.getByTestId('week-plot').locator('svg').first();
    await svg.scrollIntoViewIfNeeded();
    const box = await svg.boundingBox();
    if (!box) throw new Error('No svg bounding box');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const minDim = Math.min(box.width, box.height);

    const firstMidAngle = Number(
      await segments.first().getAttribute('data-mid-angle-rad'),
    );
    const firstDomainId = await segments
      .first()
      .getAttribute('data-domain-id');

    // Click at a generous radius — past the wedge's outer ring,
    // roughly where the label sits. This used to land on the label
    // (visiblePainted text) or in dead space, doing nothing. Stays
    // inside the chart's outer threshold (maxR + 50 in viewBox
    // units, ~0.40 of minDim) so it still dispatches rather than
    // being treated as a far-outside-clear.
    const farR = minDim * 0.38;
    await page.mouse.click(
      cx + Math.cos(firstMidAngle) * farR,
      cy + Math.sin(firstMidAngle) * farR,
    );
    await expect(segments.first()).toHaveAttribute('data-pinned', 'true');
    await expect(page.getByTestId('crystal-legend')).toHaveAttribute(
      'data-domain-id',
      firstDomainId ?? '',
    );

    // And clicking just inside the inner cap should NOT clear or
    // dispatch — that area is genuinely the chart's centre.
    await page.getByTestId('planning-banner').click({ position: { x: 5, y: 5 } });
    await expect(page.getByTestId('crystal-legend-idle')).toBeVisible();
    await page.mouse.click(cx, cy);
    await expect(page.getByTestId('crystal-legend-idle')).toBeVisible();
  });

  test('clicking the empty space far outside the chart deselects the pinned domain', async ({
    page,
  }) => {
    // Regression: with the hit-rect covering the whole viewBox and
    // findWedgeAt removing its r > maxR cap, clicks in the SVG's
    // far corners (visually empty white space) used to dispatch to
    // a wedge by angle instead of clearing. Anything well past the
    // outer ring should feel like "clicked the background".
    await completeOnboarding(page);
    await addTask(page, { title: 'Deep work', hours: 10 });

    const segments = page.locator('[data-testid^="plot-segment-"]');
    const target = segments.first();
    const point = await pointAtWedgeMid(page, target);
    await page.mouse.click(point.x, point.y);
    await expect(target).toHaveAttribute('data-pinned', 'true');

    // Now click in the SVG corner — well outside the chart's outer
    // ring but still inside the SVG. Should clear, not re-pin.
    const svg = page.getByTestId('week-plot').locator('svg').first();
    const box = await svg.boundingBox();
    if (!box) throw new Error('No svg bounding box');
    await page.mouse.click(box.x + 10, box.y + 10);
    await expect(target).toHaveAttribute('data-pinned', 'false');
    await expect(page.getByTestId('crystal-legend-idle')).toBeVisible();
  });

  test('wedge colour is bound to original domain order, not filtered position', async ({
    page,
  }) => {
    // Regression: when a middle default domain (e.g. Personal
    // Growth, palette index 4) had zero planned hours and got
    // filtered out, every later domain shifted up one slot in the
    // palette — so Rest & Recharge ended up wearing Personal
    // Growth's yellow instead of its own purple. Colours need to
    // follow each domain's position in the *unfiltered* list.
    // Pin to the 'current' palette so the asserted hex values stay
    // stable regardless of which theme is the app default.
    await page.addInitScript(() => {
      window.localStorage.setItem('ikigai-theme', 'current');
    });
    await page.goto('/');
    await completeOnboarding(page);
    await addTask(page, { title: 'Deep work', hours: 8 });
    await addTask(page, { title: 'Rest', hours: 14 });

    const segments = page.locator('[data-testid^="plot-segment-"]');
    await expect(segments).toHaveCount(2);

    // Map domain id → name + color so we can assert by name.
    const wedges = await segments.evaluateAll((nodes) =>
      nodes.map((n) => ({
        domainId: (n as HTMLElement).dataset.domainId,
        color: (n as HTMLElement).dataset.color,
      })),
    );
    // Pull domain names via the legend-on-hover paths would be slow;
    // read the names straight from the planning task rows instead.
    // The first-added task lives in Work / Study; the second in
    // Rest & Recharge. So one wedge must be sage-green (#7fb6a1,
    // palette index 0) and the other muted purple (#b89ad6, palette
    // index 5). If the bug regressed, Rest & Recharge would be
    // yellow (#e0c068).
    const colors = wedges.map((w) => w.color);
    expect(colors).toContain('#7fb6a1');
    expect(colors).toContain('#b89ad6');
    expect(colors).not.toContain('#e0c068');
  });

  test('wedge inner fill is omitted while no hours are logged', async ({
    page,
  }) => {
    await completeOnboarding(page);
    await addTask(page, { title: 'Deep work', hours: 8 });

    const segments = page.locator('[data-testid^="plot-segment-"]');
    await expect(segments).toHaveCount(1);
    // No completion → no inner fill rendered. Only the washed-out
    // outer ring should show the planned-hours target.
    await expect(segments.first()).toHaveAttribute('data-has-fill', 'false');
  });

  test('legend shows completion percentage when log entries exist', async ({
    page,
  }) => {
    await completeOnboarding(page);
    await addTask(page, { title: 'Deep work', hours: 10 });

    // Pull the current week's plan + first task id straight from
    // IndexedDB so we can write a matching WeekLog without driving
    // the entire /log UI.
    const seed = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('ikigai');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const plan = await new Promise<{
        id: string;
        weekStartISO: string;
        domains: { id: string; tasks: { id: string }[] }[];
      } | null>((resolve, reject) => {
        const tx = db.transaction('weekPlans', 'readonly');
        const store = tx.objectStore('weekPlans');
        const req = store.getAll();
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
      if (!plan) throw new Error('No week plan found');
      const taskId = plan.domains.flatMap((d) => d.tasks)[0]?.id;
      if (!taskId) throw new Error('No task found');
      const now = new Date().toISOString();
      const entry = {
        id: crypto.randomUUID(),
        weekId: plan.id,
        dateISO: now,
        taskHours: { [taskId]: 7 },
        createdAt: now,
        updatedAt: now,
      };
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('weekLogs', 'readwrite');
        tx.objectStore('weekLogs').put(entry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      return { taskId };
    });
    expect(seed.taskId).toBeTruthy();

    // Reload so the plan page picks up the seeded log.
    await page.reload();
    await expect(page.getByTestId('planning-page')).toBeVisible();

    const segments = page.locator('[data-testid^="plot-segment-"]');
    // Inner fill is now rendered because the seeded log brings
    // completed > 0.
    await expect(segments.first()).toHaveAttribute('data-has-fill', 'true');
    const point = await pointAtWedgeMid(page, segments.first());
    await page.mouse.move(point.x, point.y);

    const stats = page.getByTestId('crystal-legend-stats');
    await expect(stats).toBeVisible();
    // 7 hours logged against a 10-hour planned task = 70% complete.
    await expect(stats).toContainText('7.0 of 10.0h');
    await expect(stats).toContainText('70% complete');
  });
});
