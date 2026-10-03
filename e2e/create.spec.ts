/**
 * "Let AI create" in Live mode, in a real browser, with the Node server
 * mocked at the network layer.
 *
 * Mocking is deliberate: `server/http.test.mjs` drives the real routes, and a
 * real server here would need a provider key and would bill a generation.
 * What only a browser can show is the part this suite covers — the waiting
 * state a child actually sees, the QR code drawn in the page, and the fact
 * that a picture survives walking away from the panel and coming back.
 *
 * It runs against its own Vite server (port 4174) started with
 * `VITE_IMAGE_MODE=live`, so the demo-mode suites are untouched.
 */
import { expect, test, type Page } from '@playwright/test';
import { canvasGeometry, mouseStroke } from './support/canvas';
import { MODEL_TIMEOUT, openApp, stage } from './support/app';

test.describe.configure({ mode: 'serial' });

const CODE = 'FONTYS-A7K2M9PQ';
const TOKEN = 'A'.repeat(43);
const SHARE_PATH = `/api/shared-image/${TOKEN}`;
/** A real 8x8 PNG, so the browser can actually decode what the mock returns. */
const IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAD0lEQVR4nGOowgEYhpYEAMDVW4FI8agJAAAAAElFTkSuQmCC';

/** Stands in for the Node server. `delayMs` keeps the waiting state on screen. */
async function mockGeneration(page: Page, { delayMs = 0, share = true } = {}) {
  const seen: { code: string | undefined }[] = [];
  await page.route('**/api/generate-image', async (route) => {
    seen.push({ code: route.request().headers()['x-workshop-code'] });
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        image: IMAGE,
        ...(share ? { sharePath: SHARE_PATH, shareExpiresAt: Date.now() + 30 * 60 * 1000 } : {}),
      }),
    });
  });
  return seen;
}

/** One example is enough to unlock Let AI create for that category. */
async function teachOne(page: Page) {
  const geometry = await canvasGeometry(page);
  for (let index = 0; index < 3; index++) {
    const y = geometry.row(0.25 + index * 0.25);
    await mouseStroke(page, { x: geometry.left, y }, { x: geometry.right, y: y + 30 });
  }
  await page.getByRole('button', { name: /^Teach AI this / }).click();
  await expect(page.getByText(/Learned! Your AI now has/)).toBeVisible({ timeout: 30_000 });
}

/** Opens Let AI create with one taught category behind it. */
async function openCreate(page: Page) {
  await openApp(page);
  await teachOne(page);
  await stage(page, 'Challenge').click();
  await page.getByRole('tab').filter({ hasText: 'Let AI create' }).click();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Your drawings, a new adventure!');
}

/** Picks one option in each of the three groups. */
async function chooseEverything(page: Page) {
  for (const label of ['Rainbow', 'On the moon', 'Cartoon']) {
    await page.getByRole('button', { name: new RegExp(label, 'i') }).click();
  }
}

test('the workshop code can be shown and hidden again', async ({ page }) => {
  test.setTimeout(MODEL_TIMEOUT + 90_000);
  await openCreate(page);

  const field = page.getByLabel(/Workshop code/);
  await field.fill(CODE);
  // Dots by default: the code is a shared class secret on the board.
  await expect(field).toHaveAttribute('type', 'password');

  const show = page.getByRole('button', { name: 'Show the workshop code' });
  // Big enough for a child's finger.
  const box = (await show.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  await show.click();

  await expect(field).toHaveAttribute('type', 'text');
  await expect(field).toHaveValue(CODE);

  // And from the keyboard, which is how it hides again.
  const hide = page.getByRole('button', { name: 'Hide the workshop code' });
  await expect(hide).toHaveAttribute('aria-pressed', 'true');
  await hide.focus();
  await page.keyboard.press('Enter');
  await expect(field).toHaveAttribute('type', 'password');
  await expect(field).toHaveValue(CODE);
});

test('creating a picture shows an honest waiting state, a QR code, and keeps both', async ({ page }) => {
  test.setTimeout(MODEL_TIMEOUT + 120_000);
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));

  const requests = await mockGeneration(page, { delayMs: 2_500 });
  await openCreate(page);
  await chooseEverything(page);
  await page.getByLabel(/Workshop code/).fill(CODE);
  await page.getByRole('button', { name: /Create my picture/ }).click();

  // 1. The waiting state: obvious, animated, and honest about what it knows.
  const waiting = page.getByRole('status').filter({ hasText: 'Creating your picture…' });
  await expect(waiting).toBeVisible();
  await expect(page.locator('.createPaper')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.creatingSparkle')).toHaveCount(3);
  await expect(page.locator('.createResult')).not.toContainText(/\d+\s?%/);

  // 2. The picture arrives, and the QR code with it.
  const picture = page.getByRole('img', { name: /Create a picture of my/ });
  await expect(picture).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.createPaper')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('heading', { name: /Save it on your phone/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
  await expect(page.getByText(/Available for about 30 more minutes/)).toBeVisible();
  // The QR points at our own API origin, which here is this same site.
  await expect(page.getByRole('link', { name: /Open the picture link/ }))
    .toHaveAttribute('href', `http://127.0.0.1:4174${SHARE_PATH}`);

  // 3. The ordinary download still works, for the machine in front of them.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download my picture/ }).click();
  expect((await download).suggestedFilename()).toMatch(/^ai-doodle-[a-z0-9-]+\.png$/);
  await expect(page.getByRole('alert')).toHaveCount(0);

  // 4. Walking off to another challenge and back keeps the picture and the QR.
  await page.getByRole('tab').filter({ hasText: 'Memory' }).click();
  await expect(page.getByRole('img', { name: /QR code/ })).toHaveCount(0);
  await page.getByRole('tab').filter({ hasText: 'Let AI create' }).click();
  await expect(page.getByRole('img', { name: /Create a picture of my/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();

  // 5. So does leaving the Challenge stage entirely.
  await stage(page, 'Learn').click();
  await stage(page, 'Challenge').click();
  await page.getByRole('tab').filter({ hasText: 'Let AI create' }).click();
  await expect(page.getByRole('img', { name: /Create a picture of my/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();

  // One generation for all of that: coming back must never re-request.
  expect(requests).toHaveLength(1);
  expect(requests[0].code).toBe(CODE);
  expect(failures).toEqual([]);
});

test('a picture without a phone link still offers the download', async ({ page }) => {
  test.setTimeout(MODEL_TIMEOUT + 120_000);
  await mockGeneration(page, { share: false });
  await openCreate(page);
  await chooseEverything(page);
  await page.getByLabel(/Workshop code/).fill(CODE);
  await page.getByRole('button', { name: /Create my picture/ }).click();

  await expect(page.getByRole('img', { name: /Create a picture of my/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /Download my picture/ })).toBeEnabled();
  await expect(page.getByRole('img', { name: /QR code/ })).toHaveCount(0);
  await expect(page.getByText(/Save it on your phone/)).toHaveCount(0);
  await expect(page.getByText(/phone link has expired/)).toHaveCount(0);
});

test('a failed second attempt keeps the picture the child already made', async ({ page }) => {
  test.setTimeout(MODEL_TIMEOUT + 120_000);
  let attempt = 0;
  await page.route('**/api/generate-image', async (route) => {
    attempt += 1;
    if (attempt === 1) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ image: IMAGE, sharePath: SHARE_PATH, shareExpiresAt: Date.now() + 1_800_000 }),
      });
    }
    return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ code: 'busy' }) });
  });

  await openCreate(page);
  await chooseEverything(page);
  await page.getByLabel(/Workshop code/).fill(CODE);
  await page.getByRole('button', { name: /Create my picture/ }).click();
  await expect(page.getByRole('img', { name: /Create a picture of my/ })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: /Create my picture/ }).click();
  await expect(page.getByRole('alert')).toContainText('Lots of pictures are being made right now.');
  // The refusal costs a message, not the picture.
  await expect(page.getByRole('img', { name: /Create a picture of my/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Download my picture/ })).toBeEnabled();
});
