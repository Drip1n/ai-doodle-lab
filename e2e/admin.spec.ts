/**
 * The teacher's path through the app, end to end, with the Node server mocked.
 *
 * Mocking is deliberate: `server/http.test.mjs` already drives the real
 * routes, and a real server here would need a provider key. What this suite
 * proves is the part only a browser can: the panel is reachable, the session
 * lives in a cookie the page never reads, a new code is shown once, and the
 * list only ever shows the masked form.
 */
import { expect, test, type Page } from '@playwright/test';
import { MODEL_TIMEOUT, openApp, stage } from './support/app';

const FULL_CODE = 'FONTYS-K7P4Q9ZZ';
const MASKED = 'FONTYS-K7•••';

interface CodeRow {
  id: string;
  label: string;
  masked: string;
  usageCount: number;
  usageLimit: number;
  state: 'active' | 'revoked' | 'expired' | 'exhausted';
  revokedAt: string | null;
}

/**
 * A stand-in for the Node server: a signed-in flag, a list of codes, and the
 * one rule that matters -- the plaintext code is returned by the create call
 * and never by any other.
 */
async function mockServer(page: Page) {
  const state = { signedIn: false, codes: [] as CodeRow[] };
  const json = (body: unknown, status = 200) => ({
    status, contentType: 'application/json', body: JSON.stringify(body),
  });

  await page.route('**/api/admin/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/api\/admin/, '');
    const payload = request.postDataJSON?.() ?? {};

    if (path === '/login') {
      // Only this password works, so a failed sign-in is a real path.
      if (payload.password !== 'teacher-password-123') {
        return route.fulfill(json({ error: 'Sign-in failed. Check the email and password.' }, 401));
      }
      state.signedIn = true;
      return route.fulfill({
        ...json({ email: 'teacher@fontys.nl' }),
        headers: { 'content-type': 'application/json', 'set-cookie': 'workshop_admin=mock-session; Path=/; HttpOnly; SameSite=Strict' },
      });
    }
    if (path === '/logout') {
      state.signedIn = false;
      return route.fulfill(json({ ok: true }));
    }
    if (!state.signedIn) return route.fulfill(json({ error: 'Please sign in again.' }, 401));

    if (path === '/codes' && request.method() === 'GET') {
      return route.fulfill(json({ email: 'teacher@fontys.nl', codes: state.codes }));
    }
    if (path === '/codes' && request.method() === 'POST') {
      const entry: CodeRow = {
        id: 'id-a', label: payload.label, masked: MASKED,
        usageCount: 0, usageLimit: payload.usageLimit, state: 'active', revokedAt: null,
      };
      state.codes = [entry];
      return route.fulfill(json({ code: FULL_CODE, entry }, 201));
    }
    const revoke = /^\/codes\/([^/]+)\/revoke$/.exec(path);
    if (revoke && request.method() === 'POST') {
      state.codes = state.codes.map((entry) => entry.id === revoke[1]
        ? { ...entry, state: 'revoked' as const, revokedAt: new Date().toISOString() }
        : entry);
      return route.fulfill(json({ entry: state.codes[0] }));
    }
    return route.fulfill(json({ error: 'Not found' }, 404));
  });

  return state;
}

const panel = (page: Page) => page.getByRole('dialog', { name: 'Workshop admin' });

test('the workshop still works and a teacher can hand out and revoke a code', async ({ page }) => {
  test.setTimeout(MODEL_TIMEOUT + 90_000);
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));

  const state = await mockServer(page);

  // 1. The app loads and lands on Teach.
  await openApp(page);
  await expect(stage(page, 'Teach')).toHaveAttribute('aria-current', 'step');
  await expect(page.getByRole('button', { name: /^Teach AI this / })).toBeVisible();

  // 2. The challenge tabs all still open, Let AI create among them.
  await stage(page, 'Challenge').click();
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(4);
  await tabs.filter({ hasText: 'Let AI create' }).click();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Your drawings, a new adventure!');
  // With nothing taught yet it asks for a drawing first, and nowhere does it
  // ask a child for a workshop code before there is anything to create from.
  await expect(page.getByText('Your adventure starts with a drawing')).toBeVisible();
  await expect(page.getByLabel(/Workshop code/)).toHaveCount(0);

  // 3. The admin entry point is present but quiet: one small icon button.
  const launch = page.getByRole('button', { name: 'Workshop admin' });
  await expect(launch).toBeVisible();
  await expect(launch).toHaveText('⚙');
  const box = (await launch.boundingBox())!;
  expect(box.width).toBeLessThan(56);
  expect(box.height).toBeLessThan(56);

  // 4. It opens a modal that asks for a sign-in.
  await launch.click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByLabel('Email')).toBeVisible();

  // 5. A wrong password is refused, in one generic wording.
  await panel(page).getByLabel('Email').fill('teacher@fontys.nl');
  await panel(page).getByLabel('Password').fill('wrong-password');
  await panel(page).getByRole('button', { name: 'Sign in' }).click();
  await expect(panel(page).getByRole('alert')).toHaveText('Sign-in failed. Check the email and password.');

  // 6. The right password signs in.
  await panel(page).getByLabel('Password').fill('teacher-password-123');
  await panel(page).getByRole('button', { name: 'Sign in' }).click();
  await expect(panel(page).getByText('Signed in as teacher@fontys.nl')).toBeVisible();
  // The session is in an HttpOnly cookie: the page cannot read it, and the
  // panel keeps nothing of its own.
  expect(await page.evaluate(() => document.cookie)).not.toContain('workshop_admin');
  expect(await page.evaluate(() => window.localStorage.length)).toBe(0);

  // 7. Generating a code.
  await panel(page).getByRole('button', { name: 'Generate new code' }).click();
  await panel(page).getByLabel('Label').fill('Workshop Group A');
  await panel(page).getByLabel('Expires in').selectOption('8');
  await panel(page).getByLabel('Usage limit').fill('30');
  await panel(page).getByRole('button', { name: 'Generate' }).click();

  // 8. The full code appears exactly once, with the warning.
  await expect(panel(page).getByText(FULL_CODE)).toBeVisible();
  await expect(panel(page).getByText('Copy this now. The full code will not be shown again.')).toBeVisible();

  // 9. The list shows only the masked form, and dismissing the banner is final.
  const row = panel(page).getByRole('row').filter({ hasText: 'Workshop Group A' });
  await expect(row).toContainText(MASKED);
  await expect(row).toContainText('0 / 30');
  await expect(row).toContainText('Active');
  await panel(page).getByRole('button', { name: 'Done' }).click();
  await expect(panel(page).getByText(FULL_CODE)).toHaveCount(0);
  await expect(panel(page)).not.toContainText(FULL_CODE);

  // Reopening the panel must not bring the plaintext back.
  await panel(page).getByRole('button', { name: 'Close' }).click();
  await launch.click();
  await expect(panel(page).getByText('Signed in as teacher@fontys.nl')).toBeVisible();
  await expect(panel(page)).not.toContainText(FULL_CODE);
  await expect(panel(page)).toContainText(MASKED);

  // 10. Revoking it.
  await panel(page).getByRole('button', { name: 'Revoke' }).click();
  await expect(panel(page).getByText('Code revoked.')).toBeVisible();
  await expect(panel(page).getByRole('row').filter({ hasText: 'Workshop Group A' })).toContainText('Revoked');
  await expect(panel(page).getByRole('button', { name: 'Revoke' })).toHaveCount(0);
  expect(state.codes[0].state).toBe('revoked');

  // 11. Logging out returns to the sign-in form.
  await panel(page).getByRole('button', { name: 'Logout' }).click();
  await expect(panel(page).getByText('Signed out.')).toBeVisible();
  await expect(panel(page).getByLabel('Password')).toBeVisible();
  await expect(panel(page)).not.toContainText('Workshop Group A');

  // And the session really is gone on the server side too.
  await panel(page).getByRole('button', { name: 'Close' }).click();
  await launch.click();
  await expect(panel(page).getByLabel('Password')).toBeVisible();

  // The workshop is untouched by all of this.
  await panel(page).getByRole('button', { name: 'Close' }).click();
  await stage(page, 'Teach').click();
  await expect(page.getByRole('button', { name: /^Teach AI this / })).toBeVisible();
  expect(failures).toEqual([]);
});
