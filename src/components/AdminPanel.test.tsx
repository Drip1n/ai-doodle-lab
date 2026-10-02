import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AdminPanel } from './AdminPanel';
import type { WorkshopCode } from '../admin/adminApi';

/**
 * These drive the panel through fetch, because that is the only surface it
 * has: no credential, no session token and no plaintext code is ever held
 * anywhere this component can see.
 */
const ACTIVE: WorkshopCode = {
  id: 'id-a', label: 'Workshop Group A', masked: 'FONTYS-A7•••',
  createdAt: '2026-01-01T09:00:00.000Z', expiresAt: '2026-01-01T17:00:00.000Z', revokedAt: null,
  usageCount: 7, usageLimit: 30, createdBy: 'teacher@fontys.nl', state: 'active',
};
const REVOKED: WorkshopCode = { ...ACTIVE, id: 'id-b', label: 'Workshop Group B', masked: 'FONTYS-P4•••', revokedAt: '2026-01-01T12:00:00.000Z', state: 'revoked' };

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const fail = (status: number) => ({ ok: false, status, json: async () => ({ error: 'nope' }) });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const open = () => fireEvent.click(screen.getByRole('button', { name: 'Workshop admin' }));

/** Opens the panel already signed in, which most of these tests start from. */
async function signedIn(codes: WorkshopCode[] = [ACTIVE]) {
  fetchMock.mockResolvedValue(ok({ email: 'teacher@fontys.nl', codes }));
  render(<AdminPanel />);
  open();
  await screen.findByText('Signed in as teacher@fontys.nl');
}

describe('the admin entry point', () => {
  it('exists, is labelled, and shows nothing of the panel until it is pressed', () => {
    fetchMock.mockResolvedValue(fail(401));
    render(<AdminPanel />);
    const launch = screen.getByRole('button', { name: 'Workshop admin' });
    expect(launch).toBeInTheDocument();
    // Unobtrusive: one small icon button, no wording competing with the
    // workshop, and it asks the server for nothing until a teacher clicks.
    expect(launch).toHaveClass('adminLaunch');
    expect(launch.textContent).toBe('⚙');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens a labelled modal and closes again on Escape', async () => {
    fetchMock.mockResolvedValue(fail(401));
    render(<AdminPanel />);
    open();
    const dialog = await screen.findByRole('dialog', { name: 'Workshop admin' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('signing in', () => {
  it('asks for an email and a password, and sends them to the server', async () => {
    fetchMock.mockResolvedValueOnce(fail(401));
    render(<AdminPanel />);
    open();
    const email = await screen.findByLabelText('Email');
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();

    fireEvent.change(email, { target: { value: 'teacher@fontys.nl' } });
    fireEvent.change(password, { target: { value: 'teacher-password' } });
    fetchMock.mockResolvedValueOnce(ok({ email: 'teacher@fontys.nl' }));
    fetchMock.mockResolvedValueOnce(ok({ email: 'teacher@fontys.nl', codes: [ACTIVE] }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByText('Signed in as teacher@fontys.nl');
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('/api/admin/login');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body)).toEqual({ email: 'teacher@fontys.nl', password: 'teacher-password' });
    // The password field is cleared, and no token is kept anywhere readable.
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(window.localStorage.length).toBe(0);
    expect(document.body.innerHTML).not.toContain('teacher-password');
  });

  it('shows one generic message when sign-in fails and stays signed out', async () => {
    fetchMock.mockResolvedValueOnce(fail(401));
    render(<AdminPanel />);
    open();
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'teacher@fontys.nl' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fetchMock.mockResolvedValueOnce(fail(401));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Sign-in failed. Check the email and password.');
    // Nothing in the message hints at whether that email exists.
    expect(alert.textContent).not.toMatch(/unknown|not found|no such|exist/i);
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.queryByText(/Signed in as/)).toBeNull();
  });

  it('reports a lockout without blaming the teacher', async () => {
    fetchMock.mockResolvedValueOnce(fail(401));
    render(<AdminPanel />);
    open();
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'teacher@fontys.nl' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'whatever' } });
    fetchMock.mockResolvedValueOnce(fail(429));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many sign-in attempts. Wait a few minutes and try again.');
  });

  it('skips the sign-in form when the browser already has a session', async () => {
    await signedIn();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/codes');
  });
});

describe('managing codes', () => {
  it('lists each class with a masked code, its usage and its status', async () => {
    await signedIn([ACTIVE, REVOKED]);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Workshop Group A');
    expect(rows[0]).toHaveTextContent('FONTYS-A7•••');
    expect(rows[0]).toHaveTextContent('7 / 30');
    expect(rows[0]).toHaveTextContent('Active');
    expect(rows[1]).toHaveTextContent('Revoked');
    // A revoked code cannot be revoked again, and is visibly inactive.
    expect(rows[1].className).toContain('isInactive');
    expect(rows[1].querySelector('button')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1);
  });

  it('shows a new code exactly once, with a copy button and a warning', async () => {
    await signedIn([]);
    fireEvent.click(screen.getByRole('button', { name: 'Generate new code' }));
    fireEvent.change(await screen.findByLabelText('Label'), { target: { value: 'Workshop Group C' } });
    fireEvent.change(screen.getByLabelText('Expires in'), { target: { value: '24' } });
    fireEvent.change(screen.getByLabelText('Usage limit'), { target: { value: '15' } });

    const created: WorkshopCode = { ...ACTIVE, id: 'id-c', label: 'Workshop Group C', masked: 'FONTYS-K7•••', usageCount: 0, usageLimit: 15 };
    fetchMock.mockResolvedValueOnce(ok({ code: 'FONTYS-K7P4Q9ZZ', entry: created }));
    fetchMock.mockResolvedValueOnce(ok({ email: 'teacher@fontys.nl', codes: [created] }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await screen.findByText('FONTYS-K7P4Q9ZZ');
    expect(screen.getByText('Copy this now. The full code will not be shown again.')).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([url, init]) => url === '/api/admin/codes' && init?.method === 'POST');
    expect(JSON.parse(post![1].body)).toEqual({ label: 'Workshop Group C', expiresInHours: 24, usageLimit: 15 });

    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await screen.findByRole('button', { name: 'Copied!' });
    expect(writeText).toHaveBeenCalledWith('FONTYS-K7P4Q9ZZ');

    // Dismissing it is final: the list only ever shows the masked form, and
    // there is no way back to the plaintext.
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByText('FONTYS-K7P4Q9ZZ')).toBeNull());
    expect(screen.getByText('FONTYS-K7•••')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reveal|show code/i })).toBeNull();
  });

  it('will not generate a code without a label', async () => {
    await signedIn([]);
    fireEvent.click(screen.getByRole('button', { name: 'Generate new code' }));
    expect(await screen.findByRole('button', { name: 'Generate' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
  });

  it('revokes a code and refreshes the list', async () => {
    await signedIn([ACTIVE]);
    const after: WorkshopCode = { ...ACTIVE, state: 'revoked', revokedAt: '2026-01-01T13:00:00.000Z' };
    fetchMock.mockResolvedValueOnce(ok({ entry: after }));
    fetchMock.mockResolvedValueOnce(ok({ email: 'teacher@fontys.nl', codes: [after] }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    await screen.findByText('Code revoked.');
    expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/admin/codes/id-a/revoke' && init.method === 'POST')).toBe(true);
    const row = screen.getAllByRole('row')[1];
    expect(row).toHaveTextContent('Revoked');
    expect(row.querySelector('button')).toBeNull();
  });

  it('drops back to the sign-in form when the session has expired', async () => {
    await signedIn([ACTIVE]);
    fetchMock.mockResolvedValueOnce(fail(401));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your sign-in has expired. Please sign in again.');
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByText('Workshop Group A')).toBeNull();
  });

  it('logs out, clears the list and asks for a password again', async () => {
    await signedIn([ACTIVE]);
    fetchMock.mockResolvedValueOnce(ok({ ok: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));

    await screen.findByText('Signed out.');
    expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/admin/logout' && init.method === 'POST')).toBe(true);
    expect(screen.queryByText('Workshop Group A')).toBeNull();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
  });

  it('says so plainly when the server cannot be reached', async () => {
    await signedIn([ACTIVE]);
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the workshop server.');
  });
});
