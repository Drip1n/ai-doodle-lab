import type { CDPSession, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const HARNESS = '/e2e/harness/index.html';

export interface Contact {
  x: number;
  y: number;
  id: number;
}

/** Counts dark pixels, i.e. how much ink is actually on the canvas. */
export async function installInkProbe(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __ink: () => number }).__ink = () => {
      const canvas = document.querySelector('canvas.canvas') as HTMLCanvasElement | null;
      if (!canvas) return -1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let dark = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] < 200) dark++;
      return dark;
    };
  });
}

export const ink = (page: Page) =>
  page.evaluate(() => (window as unknown as { __ink: () => number }).__ink());

/**
 * Real touch input. Playwright's own touchscreen only taps, so multi-point
 * drags go through CDP, which drives the same input pipeline a finger does.
 * `touchEnd` takes the contacts being lifted, not the ones left behind.
 */
export class Touch {
  private readonly cdp: CDPSession;

  constructor(cdp: CDPSession) {
    this.cdp = cdp;
  }

  private send(type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', points: Contact[]) {
    return this.cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p) => ({ ...p, radiusX: 8, radiusY: 8, force: 1 })),
    });
  }

  start(...points: Contact[]) {
    return this.send('touchStart', points);
  }
  move(...points: Contact[]) {
    return this.send('touchMove', points);
  }
  end(...points: Contact[]) {
    return this.send('touchEnd', points);
  }
  cancel() {
    return this.send('touchCancel', []);
  }

  /** One finger dragging in a straight line, start to finish. */
  async stroke(from: Contact, to: { x: number; y: number }, steps = 12) {
    await this.start(from);
    for (let s = 1; s <= steps; s++) {
      await this.move({
        id: from.id,
        x: from.x + ((to.x - from.x) * s) / steps,
        y: from.y + ((to.y - from.y) * s) / steps,
      });
    }
    await this.end({ ...to, id: from.id });
  }
}

export async function mouseStroke(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

export async function canvasGeometry(page: Page) {
  const canvas = page.locator('canvas.canvas');
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const pad = 18;
  return {
    box,
    left: box.x + pad,
    right: box.x + box.width - pad,
    /** A y inside the canvas, `fraction` of the way down. */
    row: (fraction: number) => box.y + pad + fraction * (box.height - pad * 2),
    corner: { x: box.x + box.width - 6, y: box.y + box.height - 6 },
  };
}
