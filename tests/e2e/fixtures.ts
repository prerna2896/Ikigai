import { test as base, type Page } from '@playwright/test';

const clearBrowserStorage = async (page: Page) => {
  await page.evaluate(async () => {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.clear();
    }
    if (!('indexedDB' in window)) {
      return;
    }
    const deleteDb = (name: string) =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      });
    if ('databases' in indexedDB) {
      const databases = await indexedDB.databases();
      await Promise.all(
        databases
          .map((db) => db.name)
          .filter((name): name is string => Boolean(name))
          .map((name) => deleteDb(name)),
      );
    } else {
      await deleteDb('ikigai');
    }
  });
};

export const test = base.extend({
  page: async ({ page, context, request }, use, testInfo) => {
    const baseURL =
      (testInfo.project.use.baseURL as string | undefined) ??
      'http://localhost:3000';

    await request.post(`${baseURL}/api/dev/reset`);

    await context.clearCookies();
    await page.goto(baseURL);
    await clearBrowserStorage(page);
    await page.goto(baseURL);

    await use(page);
  },
});
