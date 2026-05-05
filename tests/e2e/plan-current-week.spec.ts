import { expect } from '@playwright/test';
import { test } from './fixtures';
import { addTask, completeOnboarding } from './helpers';

const expectedCurrentWeekStartISO = (weekStartDay = 0): string => {
  const today = new Date();
  const diff = (today.getDay() - weekStartDay + 7) % 7;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  start.setDate(start.getDate() - diff);
  const year = start.getFullYear();
  const month = `${start.getMonth() + 1}`.padStart(2, '0');
  const day = `${start.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const readWeekPlans = (page: import('@playwright/test').Page) =>
  page.evaluate(
    () =>
      new Promise<Array<{ id: string; weekStartISO: string }>>(
        (resolve, reject) => {
          const open = indexedDB.open('ikigai');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction('weekPlans', 'readonly');
            const store = tx.objectStore('weekPlans');
            const all = store.getAll();
            all.onsuccess = () => {
              db.close();
              resolve(all.result as Array<{ id: string; weekStartISO: string }>);
            };
            all.onerror = () => reject(all.error);
          };
        },
      ),
  );

test('plan page shows the current week even when an older plan exists', async ({
  page,
}) => {
  await completeOnboarding(page);
  await expect(page).toHaveURL(/week\/plan/);

  // Replace the only existing plan in IndexedDB with a long-past plan that
  // has a different id (since plans are keyed by id = weekStartISO). After
  // reload the current week has no matching plan; the page must create a
  // fresh one for today instead of falling back to this stale entry.
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('ikigai');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('weekPlans', 'readwrite');
        const store = tx.objectStore('weekPlans');
        const all = store.getAll();
        all.onsuccess = () => {
          const records = (all.result as Array<Record<string, unknown>>) || [];
          for (const record of records) {
            store.delete(record.id as string);
          }
          const stale: Record<string, unknown> = {
            id: '2026-03-01',
            weekStartISO: '2026-03-01',
            weekEndISO: '2026-03-07',
            weekStartDay: 'sunday',
            weekTimeZone: 'UTC',
            createdAtISO: '2026-03-01T00:00:00.000Z',
            domains: [],
            isFrozen: false,
          };
          store.put(stale);
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });

  await page.goto('/week/plan');
  await expect(page.getByTestId('planning-banner')).toBeVisible();

  // The stale label should never appear in the banner.
  await expect(page.getByTestId('planning-banner')).not.toContainText('Mar 1');

  // After my fix, a fresh plan for the current week must exist in the DB
  // alongside the stale one — proof that the page didn't reuse the stale
  // plan for the current visit.
  const expectedISO = expectedCurrentWeekStartISO(0);
  await expect
    .poll(async () => (await readWeekPlans(page)).map((p) => p.weekStartISO))
    .toEqual(expect.arrayContaining(['2026-03-01', expectedISO]));
});

test('reset this week clears the plan and starts fresh', async ({ page }) => {
  await completeOnboarding(page);
  await expect(page).toHaveURL(/week\/plan/);

  await addTask(page, { title: 'reset-me', hours: 3 });
  await expect(page.getByTestId('task-row')).toHaveCount(1);

  page.once('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.getByTestId('reset-week').click();

  // Tasks are wiped after reset.
  await expect(page.getByTestId('task-row')).toHaveCount(0);

  // Status banner confirms the reset and the planning banner is still on the
  // current week.
  await expect(page.getByTestId('planning-banner')).toBeVisible();

  // Adding a new task after reset still works (proves the fresh plan saved).
  await addTask(page, { title: 'after-reset', hours: 2 });
  await expect(page.getByTestId('task-row')).toHaveCount(1);
});

test('reset this week is cancelable', async ({ page }) => {
  await completeOnboarding(page);
  await addTask(page, { title: 'keep-me', hours: 2 });
  await expect(page.getByTestId('task-row')).toHaveCount(1);

  page.once('dialog', (dialog) => {
    void dialog.dismiss();
  });
  await page.getByTestId('reset-week').click();

  // Dismissing the confirm dialog leaves the plan untouched.
  await expect(page.getByTestId('task-row')).toHaveCount(1);
});

test('onboarding lands on a plan for the current week, not next week', async ({
  page,
}) => {
  await completeOnboarding(page);
  await expect(page).toHaveURL(/week\/plan/);

  // Default settings.weekStartDay = 'sunday'.
  const expectedISO = expectedCurrentWeekStartISO(0);

  // Only one plan exists, and its weekStartISO matches the current week.
  // Previously this was next week because of the preferNextWeek shortcut.
  await expect
    .poll(async () => (await readWeekPlans(page)).map((p) => p.weekStartISO))
    .toEqual([expectedISO]);
});

test('plan page shows current week even when only a future-week plan exists', async ({
  page,
}) => {
  await completeOnboarding(page);
  await expect(page).toHaveURL(/week\/plan/);

  // Replace the only plan with one for a future week (different id since
  // plans are keyed by id = weekStartISO). Simulates the user having
  // started planning ahead and now coming back to plan the current week.
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('ikigai');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('weekPlans', 'readwrite');
        const store = tx.objectStore('weekPlans');
        const all = store.getAll();
        all.onsuccess = () => {
          const records = (all.result as Array<Record<string, unknown>>) || [];
          for (const record of records) {
            store.delete(record.id as string);
          }
          const future: Record<string, unknown> = {
            id: '2027-01-03',
            weekStartISO: '2027-01-03',
            weekEndISO: '2027-01-09',
            weekStartDay: 'sunday',
            weekTimeZone: 'UTC',
            createdAtISO: '2027-01-03T00:00:00.000Z',
            domains: [],
            isFrozen: false,
          };
          store.put(future);
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });

  // Visit home — current week is unplanned, so the plan CTA should appear.
  await page.goto('/');
  await expect(page.getByTestId('home-cta-plan')).toBeVisible();
  await page.getByTestId('home-cta-plan').click();
  await expect(page).toHaveURL(/week\/plan/);

  // The banner must show today's week, not the 2027 future-week plan.
  const expectedISO = expectedCurrentWeekStartISO(0);
  await expect
    .poll(async () => (await readWeekPlans(page)).map((p) => p.weekStartISO))
    .toEqual(expect.arrayContaining(['2027-01-03', expectedISO]));
  await expect(page.getByTestId('planning-banner')).not.toContainText('Jan');
});

test('week goals can be added on plan and checked off on /log', async ({
  page,
}) => {
  await completeOnboarding(page);
  await expect(page).toHaveURL(/week\/plan/);

  const goalInput = page.getByTestId('week-goal-input');
  await expect(goalInput).toBeVisible();
  await goalInput.fill('Ship the prototype');
  await page.getByTestId('week-goal-add').click();
  await expect(page.getByTestId('week-goal-row')).toHaveCount(1);
  await expect(page.getByTestId('week-goals-count')).toHaveText('0/1 done');

  // Visit /log — the goal should appear in the checklist.
  await page.goto('/log');
  const logGoals = page.getByTestId('week-goals');
  await expect(logGoals).toBeVisible();
  await expect(logGoals).toContainText('Ship the prototype');

  // Tick the goal off; the count updates and persists.
  await page.getByTestId('week-goal-toggle').click();
  await expect(page.getByTestId('week-goals-count')).toHaveText('1/1 done');

  await page.reload();
  await expect(page.getByTestId('week-goals-count')).toHaveText('1/1 done');
});

test('capacity card derives hours from the buffer and persists across reload', async ({
  page,
}) => {
  await completeOnboarding(page);
  await expect(page).toHaveURL(/week\/plan/);

  const card = page.getByTestId('capacity-card');
  await expect(card).toBeVisible();
  // Open the disclosure.
  await card.locator('summary').click();

  // Pick the strictest preset (no buffer) — hours snap to 168 and the
  // change is auto-saved (no Save button required).
  await page.getByTestId('capacity-strictness').selectOption('no_buffer');
  await expect(card).toContainText('168h');
  await expect(card).toContainText('0% buffer');

  // Persists across reload — the saved buffer drives the displayed hours.
  await page.reload();
  await expect(page.getByTestId('capacity-card')).toContainText('168h');
  await expect(page.getByTestId('capacity-card')).toContainText('0% buffer');
});
