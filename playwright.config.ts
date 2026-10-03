import { defineConfig, devices } from '@playwright/test';

/**
 * Two suites with very different costs:
 *
 *  - `canvas-*` drive real pointer input against a bare harness page. They are
 *    fast, need no network, and are the regression net for the mobile drawing
 *    bug, so they run on three engines.
 *  - `app-*` drive the real app, which downloads MobileNet. One mobile Chromium
 *    run is enough to cover the workshop-critical paths, the admin panel
 *    included (its Node server is mocked at the network layer).
 *  - `app-create-*` is the same, but against a second Vite server started in
 *    Live mode, because `VITE_IMAGE_MODE` is a compile-time constant and the
 *    other suites are written against Demo mode.
 */
const CANVAS = /drawing-canvas\.spec\.ts/;
const APP = /(workshop|admin)\.spec\.ts/;
const CREATE = /create\.spec\.ts/;
const LIVE_URL = 'http://127.0.0.1:4174';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'on-first-retry' },
  projects: [
    { name: 'canvas-desktop-chromium', testMatch: CANVAS, use: { ...devices['Desktop Chrome'] } },
    { name: 'canvas-mobile-chromium', testMatch: CANVAS, use: { ...devices['Pixel 7'] } },
    { name: 'canvas-mobile-webkit', testMatch: CANVAS, use: { ...devices['iPhone 13'] } },
    { name: 'app-mobile-chromium', testMatch: APP, use: { ...devices['Pixel 7'] } },
    {
      name: 'app-create-mobile-chromium',
      testMatch: CREATE,
      use: { ...devices['Pixel 7'], baseURL: LIVE_URL },
    },
  ],
  webServer: [
    {
      command: 'npx vite --port 4173 --strictPort --host 127.0.0.1',
      url: 'http://127.0.0.1:4173/e2e/harness/index.html',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Live mode, with a relative endpoint so `page.route` can stand in for
      // the Node server and the share URL resolves against this origin.
      command: 'npx vite --port 4174 --strictPort --host 127.0.0.1',
      url: `${LIVE_URL}/e2e/harness/index.html`,
      env: { VITE_IMAGE_MODE: 'live', VITE_IMAGE_ENDPOINT: '/api/generate-image' },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
