/**
 * Visual regression audit — locks down layout, colour, typography across all
 * major routes at three viewport sizes.
 *
 * Workflow
 * --------
 * 1. Generate / refresh baselines (run once after intentional UI changes):
 *      pnpm test:e2e tests/e2e/visual-audit.spec.ts --update-snapshots
 *    Commit the generated PNG files in tests/e2e/snapshots/.
 *
 * 2. Catch regressions on every PR:
 *      pnpm test:e2e tests/e2e/visual-audit.spec.ts
 *    Playwright writes a side-by-side diff image to test-results/ on failure.
 *    Feed the *-diff.png to an AI with the prompt:
 *      "Red pixels mark an unintended UI shift. Is this a padding/alignment
 *       break, a colour contrast error, or a typography hierarchy issue?"
 */

import { test as base, expect, type Page } from '@playwright/test';
import { test as fixtureTest } from './fixtures';

// ─── Viewport matrix ──────────────────────────────────────────────────────────

const VIEWPORTS = [
  { width: 375, height: 812, name: 'mobile' },
  { width: 768, height: 1024, name: 'tablet' },
  { width: 1440, height: 900, name: 'desktop' },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Wait for React to hydrate and CSS transitions to settle.
 * Uses a visible-element check rather than 'networkidle' — Next.js dev mode
 * keeps an HMR SSE connection open, so networkidle never resolves.
 */
async function stabilise(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  // Wait for an h1 to appear — every page in this app renders one, and h1
  // is never display:none, unlike nav elements that are hidden on mobile.
  await page.waitForSelector('h1', { state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(600);
}

/**
 * Seed the minimum IndexedDB state required for post-onboarding app views.
 * Writing directly to IDB avoids running the full onboarding UI flow (which
 * is slow and is already covered by onboarding-flow.spec.ts).
 * The fixture has already cleared storage and loaded the page, so the Dexie
 * schema (ikigai v10) exists in the browser context before this runs.
 */
async function seedOnboardedState(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('ikigai');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IDB blocked'));
    });

    const put = (storeName: string, value: unknown): Promise<void> =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

    const now = new Date().toISOString();

    await put('settings', {
      id: 'singleton',
      sleepHoursPerDay: 8,
      maintenanceHoursPerDay: 1,
      weeklyCapacityHours: 40,
      weeklyCapacityHoursDerived: 40,
      bufferPercent: 20,
      weekStartDay: 'monday',
      weekTimeZone: 'America/Los_Angeles',
      preferredTone: 'calm_spacious',
      professionType: 'full_time_employee',
      professionOtherText: null,
      hasJob: true,
      jobHoursPerWeek: 40,
      isStudent: false,
      classHoursPerWeek: 0,
      strictness: 'structured',
      createdAt: now,
      updatedAt: now,
    });

    await put('profiles', {
      id: crypto.randomUUID(),
      name: 'Test User',
      reflections: [],
      goals: [],
      createdAt: now,
      updatedAt: now,
    });

    db.close();
  });

  // Reload so the app picks up the newly seeded data.
  await page.reload();
  await stabilise(page);
}

// ─── 1. Landing page (fresh browser context — no reset needed) ────────────────

base.describe('landing page', () => {
  for (const vp of VIEWPORTS) {
    base(`${vp.name}`, async ({ page }) => {
      await page.setViewportSize(vp);
      await page.goto('/');
      await stabilise(page);
      await expect(page).toHaveScreenshot(`landing-${vp.name}.png`);
    });
  }
});

// ─── 2. Onboarding flow (fresh browser context) ───────────────────────────────

base.describe('onboarding — context', () => {
  for (const vp of VIEWPORTS) {
    base(`${vp.name}`, async ({ page }) => {
      await page.setViewportSize(vp);
      await page.goto('/onboarding/context');
      await stabilise(page);
      await expect(page).toHaveScreenshot(`onboarding-context-${vp.name}.png`);
    });
  }
});

base.describe('onboarding — tone', () => {
  for (const vp of VIEWPORTS) {
    base(`${vp.name}`, async ({ page }) => {
      await page.setViewportSize(vp);
      await page.goto('/onboarding/tone');
      await stabilise(page);
      await expect(page).toHaveScreenshot(`onboarding-tone-${vp.name}.png`);
    });
  }
});

base.describe('onboarding — reflection', () => {
  for (const vp of VIEWPORTS) {
    base(`${vp.name}`, async ({ page }) => {
      await page.setViewportSize(vp);
      await page.goto('/onboarding/reflection');
      await stabilise(page);
      await expect(page).toHaveScreenshot(`onboarding-reflection-${vp.name}.png`);
    });
  }
});

base.describe('onboarding — goals', () => {
  for (const vp of VIEWPORTS) {
    base(`${vp.name}`, async ({ page }) => {
      await page.setViewportSize(vp);
      await page.goto('/onboarding/goals');
      await stabilise(page);
      await expect(page).toHaveScreenshot(`onboarding-goals-${vp.name}.png`);
    });
  }
});

base.describe('onboarding — settings', () => {
  for (const vp of VIEWPORTS) {
    base(`${vp.name}`, async ({ page }) => {
      await page.setViewportSize(vp);
      await page.goto('/onboarding/settings');
      await stabilise(page);
      await expect(page).toHaveScreenshot(`onboarding-settings-${vp.name}.png`);
    });
  }
});

// ─── 3. App views (seeded IndexedDB state, no full onboarding flow) ───────────
//
// Each describe group sets a viewport and seeds settings + profile directly
// into IndexedDB, then navigates to the target route. This avoids running the
// full onboarding UI flow per test (which is slow and already tested elsewhere).

for (const vp of VIEWPORTS) {
  fixtureTest.describe(`app — ${vp.name}`, () => {
    fixtureTest.use({ viewport: { width: vp.width, height: vp.height } });

    fixtureTest.beforeEach(async ({ page }) => {
      await seedOnboardedState(page);
    });

    fixtureTest('plan page', async ({ page }) => {
      await page.goto('/week/plan');
      await stabilise(page);
      await expect(page).toHaveScreenshot(`plan-${vp.name}.png`, {
        // Mask the banner — contains dynamic week date + AI-generated remark.
        mask: [page.getByTestId('planning-banner')],
      });
    });

    fixtureTest('reflect page', async ({ page }) => {
      await page.goto('/reflect');
      await stabilise(page);
      await expect(page).toHaveScreenshot(`reflect-${vp.name}.png`);
    });

    fixtureTest('history / overview page', async ({ page }) => {
      await page.goto('/history');
      await stabilise(page);
      // Mask SVG charts — data-driven and differ between runs.
      await expect(page).toHaveScreenshot(`history-${vp.name}.png`, {
        mask: [page.locator('svg')],
      });
    });

    fixtureTest('profile page', async ({ page }) => {
      await page.goto('/profile');
      await stabilise(page);
      await expect(page).toHaveScreenshot(`profile-${vp.name}.png`);
    });
  });
}
