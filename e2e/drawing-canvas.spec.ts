/**
 * Pointer-lifecycle regression tests for DrawingCanvas.
 *
 * These run against a bare harness page so they exercise real browser pointer
 * input without waiting for MobileNet. The touch cases need CDP, which is
 * Chromium-only; the mouse cases run everywhere, including WebKit.
 */
import { expect, test } from '@playwright/test';
import { HARNESS, Touch, canvasGeometry, ink, installInkProbe, mouseStroke } from './support/canvas';

/** A stroke right across the canvas leaves roughly this much ink. */
const FULL_STROKE = 6000;

test.beforeEach(async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await installInkProbe(page);
  await page.goto(HARNESS);
  await expect(page.locator('canvas.canvas')).toBeVisible();
  // Surfaced by the fixture teardown below.
  (page as unknown as { __failures: string[] }).__failures = failures;
});

test.afterEach(async ({ page }) => {
  expect((page as unknown as { __failures: string[] }).__failures).toEqual([]);
});

test.describe('touch', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'CDP touch injection is Chromium-only');

  test('ten separate strokes each land in full', async ({ page }) => {
    const touch = new Touch(await page.context().newCDPSession(page));
    const g = await canvasGeometry(page);
    let previous = await ink(page);
    const deltas: number[] = [];

    for (let i = 0; i < 10; i++) {
      const y = g.row(i / 10);
      await touch.stroke({ x: g.left, y, id: 100 + i }, { x: g.right, y });
      const now = await ink(page);
      deltas.push(now - previous);
      previous = now;
    }

    expect(deltas.every((d) => d > FULL_STROKE)).toBe(true);
  });

  test('a single tap leaves a dot', async ({ page }) => {
    const touch = new Touch(await page.context().newCDPSession(page));
    const g = await canvasGeometry(page);
    const point = { x: g.left + 40, y: g.row(0.5), id: 1 };
    await touch.start(point);
    await touch.end(point);
    expect(await ink(page)).toBeGreaterThan(50);
    await expect(page.getByTestId('dirty')).toHaveText('dirty');
  });

  // The workshop bug: a palm or stray finger touching down and lifting again
  // used to end the stroke the child was still drawing.
  test('a second contact does not corrupt or cut short the active stroke', async ({ page }) => {
    const touch = new Touch(await page.context().newCDPSession(page));
    const g = await canvasGeometry(page);

    const yRef = g.row(0.15);
    let previous = await ink(page);
    await touch.stroke({ x: g.left, y: yRef, id: 1 }, { x: g.right, y: yRef });
    const reference = (await ink(page)) - previous;

    const y = g.row(0.6);
    const finger = (s: number) => ({ id: 2, x: g.left + ((g.right - g.left) * s) / 12, y });
    const palm = { ...g.corner, id: 3 };
    previous = await ink(page);
    await touch.start(finger(0));
    for (let s = 1; s <= 5; s++) await touch.move(finger(s));
    await touch.start(finger(5), palm); // palm lands mid-stroke
    await touch.move(finger(6), { ...palm, x: palm.x - 4 }); // and even drags a little
    await touch.end(palm); // palm lifts, the drawing finger is still down
    for (let s = 7; s <= 12; s++) await touch.move(finger(s));
    await touch.end(finger(12));
    const withPalm = (await ink(page)) - previous;

    // The stroke must survive essentially intact, and the palm must add nothing.
    expect(withPalm).toBeGreaterThan(reference * 0.9);
    expect(withPalm).toBeLessThan(reference * 1.15);
  });

  // Ownership goes to whichever contact lands first and is handed back the
  // moment it lifts. A thumb already parked on the canvas therefore owns it --
  // it draws a visible mark the child can see and undo -- but the canvas is
  // never left stuck: lifting the thumb restores normal drawing immediately.
  test('the first contact owns the canvas and hands it back when it lifts', async ({ page }) => {
    const touch = new Touch(await page.context().newCDPSession(page));
    const g = await canvasGeometry(page);
    const resting = { ...g.corner, id: 7 };

    await touch.start(resting); // a thumb parked on the canvas
    const inkAfterThumb = await ink(page);

    // A second finger trying to draw is ignored rather than corrupting things.
    const y = g.row(0.4);
    await touch.stroke({ x: g.left, y, id: 8 }, { x: g.right, y });
    expect((await ink(page)) - inkAfterThumb).toBeLessThan(FULL_STROKE / 4);

    await touch.end(resting);

    // With the thumb gone the canvas behaves exactly as normal again.
    const before = await ink(page);
    const y2 = g.row(0.75);
    await touch.stroke({ x: g.left, y: y2, id: 9 }, { x: g.right, y: y2 });
    expect((await ink(page)) - before).toBeGreaterThan(FULL_STROKE);
  });

  test('a contact that lands after the stroke has ended adds no ink', async ({ page }) => {
    const touch = new Touch(await page.context().newCDPSession(page));
    const g = await canvasGeometry(page);
    const y = g.row(0.4);
    await touch.stroke({ x: g.left, y, id: 1 }, { x: g.right, y });

    // A finger that comes down, drags and lifts must start its own stroke --
    // never extend the one that just finished.
    const before = await ink(page);
    const y2 = g.row(0.8);
    await touch.stroke({ x: g.left, y: y2, id: 2 }, { x: g.right, y: y2 });
    const second = (await ink(page)) - before;
    expect(second).toBeGreaterThan(FULL_STROKE);
    // Two strokes, not one joined-up scribble: undo must take exactly one off.
    await page.getByRole('button', { name: 'Undo' }).click();
    expect(await ink(page)).toBe(before);
  });

  test('a new stroke starts after pointercancel', async ({ page }) => {
    const touch = new Touch(await page.context().newCDPSession(page));
    const g = await canvasGeometry(page);
    const y1 = g.row(0.3);
    await touch.start({ x: g.left, y: y1, id: 1 });
    await touch.move({ x: g.left + 60, y: y1, id: 1 });
    await touch.cancel();

    const before = await ink(page);
    const y2 = g.row(0.7);
    await touch.stroke({ x: g.left, y: y2, id: 2 }, { x: g.right, y: y2 });
    expect((await ink(page)) - before).toBeGreaterThan(FULL_STROKE);
  });

  test('a new stroke starts after the browser takes back pointer capture', async ({ page }) => {
    const touch = new Touch(await page.context().newCDPSession(page));
    const g = await canvasGeometry(page);
    const y1 = g.row(0.3);
    await touch.start({ x: g.left, y: y1, id: 1 });
    await touch.move({ x: g.left + 60, y: y1, id: 1 });
    // Exactly what a browser does when it decides the gesture belongs to it.
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas.canvas') as HTMLCanvasElement;
      canvas.dispatchEvent(
        new PointerEvent('lostpointercapture', { pointerId: 1, bubbles: true }),
      );
    });
    await touch.end({ x: g.left + 60, y: y1, id: 1 });

    const before = await ink(page);
    const y2 = g.row(0.7);
    await touch.stroke({ x: g.left, y: y2, id: 2 }, { x: g.right, y: y2 });
    expect((await ink(page)) - before).toBeGreaterThan(FULL_STROKE);
  });

  test('a finger dragged off the canvas keeps drawing and then releases cleanly', async ({ page }) => {
    const touch = new Touch(await page.context().newCDPSession(page));
    const g = await canvasGeometry(page);
    const y = g.row(0.5);
    await touch.start({ x: g.left, y, id: 1 });
    for (let s = 1; s <= 6; s++) await touch.move({ x: g.left + s * 25, y, id: 1 });
    await touch.move({ x: g.box.x + g.box.width + 60, y, id: 1 }); // past the edge
    await touch.end({ x: g.box.x + g.box.width + 60, y, id: 1 });

    const before = await ink(page);
    const y2 = g.row(0.85);
    await touch.stroke({ x: g.left, y: y2, id: 2 }, { x: g.right, y: y2 });
    expect((await ink(page)) - before).toBeGreaterThan(FULL_STROKE);
  });

  test('mouse after touch and touch after mouse both draw', async ({ page }) => {
    const touch = new Touch(await page.context().newCDPSession(page));
    const g = await canvasGeometry(page);

    let before = await ink(page);
    const y1 = g.row(0.2);
    await touch.stroke({ x: g.left, y: y1, id: 1 }, { x: g.right, y: y1 });
    expect((await ink(page)) - before).toBeGreaterThan(FULL_STROKE);

    before = await ink(page);
    const y2 = g.row(0.5);
    await mouseStroke(page, { x: g.left, y: y2 }, { x: g.right, y: y2 });
    expect((await ink(page)) - before).toBeGreaterThan(FULL_STROKE);

    before = await ink(page);
    const y3 = g.row(0.8);
    await touch.stroke({ x: g.left, y: y3, id: 2 }, { x: g.right, y: y3 });
    expect((await ink(page)) - before).toBeGreaterThan(FULL_STROKE);
  });

  test('Clear while a finger is still down does not break the canvas', async ({ page }) => {
    const touch = new Touch(await page.context().newCDPSession(page));
    const g = await canvasGeometry(page);
    const y = g.row(0.5);

    await touch.start({ x: g.left, y, id: 1 });
    for (let s = 1; s <= 5; s++) await touch.move({ x: g.left + s * 20, y, id: 1 });
    await page.getByRole('button', { name: 'Clear' }).click();
    // The finger keeps moving over a canvas whose strokes have just been wiped.
    for (let s = 6; s <= 12; s++) await touch.move({ x: g.left + s * 20, y, id: 1 });
    await touch.end({ x: g.left + 240, y, id: 1 });

    const before = await ink(page);
    const y2 = g.row(0.8);
    await touch.stroke({ x: g.left, y: y2, id: 2 }, { x: g.right, y: y2 });
    expect((await ink(page)) - before).toBeGreaterThan(FULL_STROKE);
  });
});

test.describe('pointer-agnostic', () => {
  test('undo removes only the last stroke, and drawing continues afterwards', async ({ page }) => {
    const g = await canvasGeometry(page);
    const y1 = g.row(0.25);
    const y2 = g.row(0.55);
    await mouseStroke(page, { x: g.left, y: y1 }, { x: g.right, y: y1 });
    const afterFirst = await ink(page);
    await mouseStroke(page, { x: g.left, y: y2 }, { x: g.right, y: y2 });
    expect(await ink(page)).toBeGreaterThan(afterFirst);

    await page.getByRole('button', { name: 'Undo' }).click();
    expect(await ink(page)).toBe(afterFirst);
    await expect(page.getByTestId('dirty')).toHaveText('dirty');

    const y3 = g.row(0.85);
    await mouseStroke(page, { x: g.left, y: y3 }, { x: g.right, y: y3 });
    expect(await ink(page)).toBeGreaterThan(afterFirst);
  });

  test('clear empties the canvas and drawing still works afterwards', async ({ page }) => {
    const g = await canvasGeometry(page);
    const y1 = g.row(0.3);
    await mouseStroke(page, { x: g.left, y: y1 }, { x: g.right, y: y1 });
    expect(await ink(page)).toBeGreaterThan(FULL_STROKE);

    await page.getByRole('button', { name: 'Clear' }).click();
    expect(await ink(page)).toBe(0);
    await expect(page.getByTestId('dirty')).toHaveText('clean');
    await expect(page.getByRole('button', { name: 'Clear' })).toBeDisabled();

    const y2 = g.row(0.7);
    await mouseStroke(page, { x: g.left, y: y2 }, { x: g.right, y: y2 });
    expect(await ink(page)).toBeGreaterThan(FULL_STROKE);
  });

  test('five separate mouse strokes each land', async ({ page }) => {
    const g = await canvasGeometry(page);
    let previous = await ink(page);
    for (let i = 0; i < 5; i++) {
      const y = g.row(i / 5);
      await mouseStroke(page, { x: g.left, y }, { x: g.right, y });
      const now = await ink(page);
      expect(now - previous).toBeGreaterThan(FULL_STROKE);
      previous = now;
    }
  });

  test('tapping the canvas via the touchscreen API works on every engine', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'touchscreen needs a touch-enabled context');
    const g = await canvasGeometry(page);
    await page.touchscreen.tap(g.left + 40, g.row(0.4));
    expect(await ink(page)).toBeGreaterThan(50);
    await page.touchscreen.tap(g.left + 90, g.row(0.6));
    expect(await ink(page)).toBeGreaterThan(100);
  });
});
