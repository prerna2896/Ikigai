import { defineConfig } from '@playwright/test';

// Analytical query perf benchmarks. Same shape as playwright.rls.config.ts:
// no browser, no dev server, uses Playwright purely for the test runner
// and assertions. Timeouts are generous — the corpus seed alone can
// take a few seconds against local Supabase, and one bad query plan
// could balloon to seconds.
//
// Run: pnpm test:perf
export default defineConfig({
  testDir: './tests/perf',
  timeout: 120_000,
  retries: 0,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
});
