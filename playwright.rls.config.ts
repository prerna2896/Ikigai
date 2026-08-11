import { defineConfig } from '@playwright/test';

// Separate Playwright config for RLS tests. These don't launch a browser
// or the Next.js dev server — they exercise Supabase directly via
// @supabase/supabase-js. Using Playwright only for its test runner +
// assertion library (already installed for e2e).
//
// Run: pnpm test:rls
export default defineConfig({
  testDir: './tests/rls',
  timeout: 30_000,
  retries: 0,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
});
