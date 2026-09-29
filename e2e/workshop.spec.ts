/**
 * The workshop-critical paths, end to end against the real app.
 *
 * These load MobileNet for real, so they are slower than the canvas suite and
 * need network on a cold cache. Everything here is something a child does in
 * the first ten minutes of the workshop.
 */
import { expect, test, type Page } from '@playwright/test';
import { Touch, canvasGeometry, ink, installInkProbe, mouseStroke } from './support/canvas';

const MODEL_TIMEOUT = 180_000;

/** The stepper buttons read "1 Teach", "2 Challenge", "3 Learn". */
const stage = (page: Page, label: string) => page.locator('.stepper button', { hasText: label });

test.describe.configure({ mode: 'serial' });

async function openApp(page: Page) {
  await installInkProbe(page);
  await page.goto('/');
  // Stage-based loader: it must report progress, then get out of the way.
  await expect(page.getByRole('progressbar', { name: 'Setup progress' })).toBeVisible();
  await expect(page.getByText(/Step \d of 4/)).toBeVisible();
  await expect(page.getByText('Your AI is ready!')).toBeVisible({ timeout: MODEL_TIMEOUT });
  await expect(page.locator('.loaderOverlay')).toHaveCount(0, { timeout: 10_000 });
}

/** Draws something the classifier can tell apart, using the mouse. */
async function scribble(page: Page, seed: number) {
  const g = await canvasGeometry(page);
  for (let i = 0; i < 3; i++) {
    const y = g.row(0.2 + ((i + seed) % 3) * 0.3);
    await mouseStroke(page, { x: g.left, y }, { x: g.right, y: y + (seed % 2 ? 40 : -40) });
  }
}

test('startup, ten mobile strokes, undo, clear and draw again', async ({ page, browserName }) => {
  test.setTimeout(MODEL_TIMEOUT + 60_000);
  const failures: string[] = [];
  page.on('pageerror', (e) => failures.push(e.message));

  await openApp(page);
  await expect(stage(page, 'Teach')).toHaveAttribute('aria-current', 'step');

  const g = await canvasGeometry(page);
  const deltas: number[] = [];
  let previous = await ink(page);

  if (browserName === 'chromium') {
    const touch = new Touch(await page.context().newCDPSession(page));
    for (let i = 0; i < 10; i++) {
      const y = g.row(i / 10);
      await touch.stroke({ x: g.left, y, id: 500 + i }, { x: g.right, y });
      const now = await ink(page);
      deltas.push(now - previous);
      previous = now;
    }
  } else {
    for (let i = 0; i < 10; i++) {
      const y = g.row(i / 10);
      await mouseStroke(page, { x: g.left, y }, { x: g.right, y });
      const now = await ink(page);
      deltas.push(now - previous);
      previous = now;
    }
  }
  expect(deltas.every((d) => d > 3000)).toBe(true);

  const beforeUndo = await ink(page);
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await ink(page)).toBeLessThan(beforeUndo);

  await page.getByRole('button', { name: 'Clear' }).click();
  expect(await ink(page)).toBe(0);

  // The canvas must still be alive after a clear.
  const y = g.row(0.5);
  await mouseStroke(page, { x: g.left, y }, { x: g.right, y });
  expect(await ink(page)).toBeGreaterThan(3000);

  expect(failures).toEqual([]);
});

test('teaching examples, persistence across reload, and reset', async ({ page }) => {
  test.setTimeout(MODEL_TIMEOUT + 90_000);
  await openApp(page);

  // Teach three examples of the first category.
  const teachButton = page.getByRole('button', { name: /^Teach AI this / });
  for (let i = 0; i < 3; i++) {
    await scribble(page, i);
    await teachButton.click();
    await expect(page.getByText(/Learned! Your AI now has/)).toBeVisible({ timeout: 30_000 });
    // Teaching resets the workspace itself, ready for the next drawing.
    await expect.poll(() => ink(page)).toBe(0);
  }
  await expect(page.locator('.classCount').first()).toHaveText('3 examples');

  // Reload: IndexedDB must bring the dataset back and rebuild the classifier.
  await page.reload();
  await expect(page.getByText('Your AI is ready!')).toBeVisible({ timeout: MODEL_TIMEOUT });
  await expect(page.locator('.loaderOverlay')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('.classCount').first()).toHaveText('3 examples');

  // Reset wipes it, and the wipe survives a reload too.
  await page.getByRole('button', { name: 'Reset AI' }).click();
  await page.getByRole('button', { name: 'Yes, reset everything' }).click();
  await expect(page.locator('.classCount').first()).toHaveText('0 examples');
  await page.reload();
  await expect(page.getByText('Your AI is ready!')).toBeVisible({ timeout: MODEL_TIMEOUT });
  await expect(page.locator('.loaderOverlay')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('.classCount').first()).toHaveText('0 examples');
});

test('the You Draw challenge asks, guesses and takes feedback', async ({ page }) => {
  test.setTimeout(MODEL_TIMEOUT + 120_000);
  await openApp(page);

  // Two categories need examples before the challenge unlocks.
  const cards = page.locator('.classCard');
  const teachButton = page.getByRole('button', { name: /^Teach AI this / });
  for (let c = 0; c < 2; c++) {
    if (c > 0) await cards.nth(c).locator('.classCardBody').click();
    for (let i = 0; i < 3; i++) {
      await scribble(page, c * 5 + i);
      await teachButton.click();
      await expect(page.getByText(/Learned! Your AI now has/)).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => ink(page)).toBe(0);
    }
  }

  await stage(page, 'Challenge').click();
  await scribble(page, 1);
  await page.getByRole('button', { name: /Ask AI/ }).click();
  await expect(page.getByRole('button', { name: /Yes/ }).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Yes/ }).first().click();
  await expect(page.getByRole('button', { name: /Try another|Draw another/i }).first()).toBeVisible();
});

// DrawingCanvas is reused in three places; the pointer fix has to hold in all
// of them, not just the Teach stage.
test('every canvas in the app draws multiple separate strokes', async ({ page }) => {
  test.setTimeout(MODEL_TIMEOUT + 120_000);
  const failures: string[] = [];
  page.on('pageerror', (e) => failures.push(e.message));
  await openApp(page);

  const strokes = async (where: string) => {
    const g = await canvasGeometry(page);
    let previous = await ink(page);
    const touch = new Touch(await page.context().newCDPSession(page));
    for (let i = 0; i < 3; i++) {
      const y = g.row(i / 3);
      await touch.stroke({ x: g.left, y, id: 700 + i }, { x: g.right, y });
      const now = await ink(page);
      expect(now - previous, `${where}: stroke ${i + 1} did not land`).toBeGreaterThan(2000);
      previous = now;
    }
  };

  // 1. Teach
  await strokes('Teach');

  // The challenge needs two taught categories before its canvas appears.
  const teachButton = page.getByRole('button', { name: /^Teach AI this / });
  for (let c = 0; c < 2; c++) {
    if (c > 0) await page.locator('.classCard').nth(c).locator('.classCardBody').click();
    for (let i = 0; i < 3; i++) {
      await scribble(page, c * 4 + i);
      await teachButton.click();
      await expect(page.getByText(/Learned! Your AI now has/)).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => ink(page)).toBe(0);
    }
  }

  // 2. You Draw challenge
  await stage(page, 'Challenge').click();
  await strokes('You Draw challenge');

  // 3. Learn -> draw something new
  await stage(page, 'Learn').click();
  await page.getByRole('button', { name: /draw something new/i }).click();
  await strokes('Learn, draw something new');

  expect(failures).toEqual([]);
});

test('Learn and every challenge tab open cleanly, including by keyboard', async ({ page }) => {
  test.setTimeout(MODEL_TIMEOUT + 60_000);
  const failures: string[] = [];
  page.on('pageerror', (e) => failures.push(e.message));
  await openApp(page);

  await stage(page, 'Learn').click();
  await expect(page.getByRole('heading', { level: 2 })).toBeVisible();

  await stage(page, 'Challenge').click();
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(3);
  await tabs.filter({ hasText: 'Memory' }).click();
  await expect(page.getByRole('heading', { name: /remember what the AI learned/ })).toBeVisible();
  await tabs.filter({ hasText: 'AI draws' }).click();
  await expect(page.getByRole('heading', { name: /guess the AI/ })).toBeVisible();

  // The tablist must be driveable from the keyboard.
  await page.getByRole('tab', { selected: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { selected: true })).toHaveText(/Memory/);
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { selected: true })).toHaveText(/AI draws/);

  await stage(page, 'Teach').click();
  await expect(page.getByRole('button', { name: /^Teach AI this / })).toBeVisible();

  expect(failures).toEqual([]);
});
