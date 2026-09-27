import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:18080',
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(process.env.PLI_CHROME ? { launchOptions: { executablePath: process.env.PLI_CHROME } } : {}),
  },
  webServer: {
    command: 'node tests/fixture.mjs',
    url: 'http://127.0.0.1:18080/healthz',
    timeout: 30_000,
    reuseExistingServer: false,
  },
});
