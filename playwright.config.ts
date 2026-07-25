import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      threshold: 0.1,
    },
  },
  snapshotPathTemplate: 'tests/e2e/snapshots/{testFilePath}/{arg}{ext}',
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm dev',
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
