import { expect, type Page } from '@playwright/test';
import { installInkProbe } from './canvas';

/** The real app downloads MobileNet, which dominates these timeouts. */
export const MODEL_TIMEOUT = 180_000;

/** The stepper buttons read "1 Teach", "2 Challenge", "3 Learn". */
export const stage = (page: Page, label: string) => page.locator('.stepper button', { hasText: label });

export async function openApp(page: Page) {
  await installInkProbe(page);
  await page.goto('/');
  // Stage-based loader: it must report progress, then get out of the way.
  await expect(page.getByRole('progressbar', { name: 'Setup progress' })).toBeVisible();
  await expect(page.getByText(/Step \d of 4/)).toBeVisible();
  await waitForReady(page);
}

/**
 * The model host occasionally refuses a download. That is a real thing that
 * happens on workshop wifi, and the app's answer to it is the retry card, so
 * the suite takes that path rather than failing on someone else's CDN.
 */
export async function waitForReady(page: Page) {
  const ready = page.getByText('Your AI is ready!');
  const failed = page.getByText(/couldn.t finish loading/);
  for (let attempt = 0; attempt < 3; attempt++) {
    await expect(ready.or(failed)).toBeVisible({ timeout: MODEL_TIMEOUT });
    if (await ready.isVisible()) break;
    await page.getByRole('button', { name: 'Try again' }).click();
  }
  await expect(ready).toBeVisible({ timeout: MODEL_TIMEOUT });
  await expect(page.locator('.loaderOverlay')).toHaveCount(0, { timeout: 15_000 });
}
