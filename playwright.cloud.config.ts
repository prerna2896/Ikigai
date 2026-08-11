import { defineConfig } from '@playwright/test';

// M2.2/M2.3+ end-to-end tests. Drives the app UI + verifies Cloud
// (Supabase) rows out-of-band via the admin client. Assumes:
//   - Local Supabase is running (`supabase start`)
//   - Dev server is running on 3724 (the worktree's assigned port)
// Doesn't spin its own webServer — reuse whatever the developer already
// has up. Fail fast if it's not.
export default defineConfig({
  testDir: './tests/cloud',
  timeout: 60_000,
  retries: 0,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3724',
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
