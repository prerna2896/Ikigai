import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    // CI builds once (see ci.yml) and serves that build — `next dev`
    // JIT-compiles each route on first visit, which is fine locally
    // but was blowing through this suite's 30s per-test timeout
    // inside a resource-constrained CI runner (measured ~20-80ms/route
    // against a production build vs. multi-second first-compiles in
    // dev mode, which is what turned a healthy local suite into
    // near-total CI failures/timeouts).
    command: process.env.CI ? 'pnpm start' : 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      PLAYWRIGHT: '1',
      NEXT_PUBLIC_PLAYWRIGHT: '1',
    },
  },
});
