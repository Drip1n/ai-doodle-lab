import { IMAGE_ENDPOINT } from '../generative/imageApi';

/**
 * The admin panel talks to the same Node server as picture making, so its
 * base URL is derived from the configured image endpoint
 * (`/api/generate-image` -> `/api`). `VITE_ADMIN_ENDPOINT` overrides that for
 * the rare setup where the two live apart.
 *
 * Nothing here holds a credential. The session lives in an HttpOnly cookie
 * the browser cannot read, which is why every call sends `credentials`.
 */
export const ADMIN_BASE = (
  import.meta.env.VITE_ADMIN_ENDPOINT?.trim()
  || IMAGE_ENDPOINT.replace(/\/generate-image\/?$/, '')
  || '/api'
).replace(/\/$/, '');

export interface WorkshopCode {
  id: string;
  label: string;
  masked: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  usageCount: number;
  usageLimit: number;
  createdBy: string;
  state: 'active' | 'revoked' | 'expired' | 'exhausted';
}

export class AdminError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

/** True once the teacher has to sign in again. */
export const isSignedOut = (error: unknown) => error instanceof AdminError && error.status === 401;

const MESSAGES: Record<number, string> = {
  400: 'Check the name, expiry and usage limit, then try again.',
  401: 'Sign-in failed. Check the email and password.',
  403: 'This browser is not allowed to manage workshop codes.',
  404: 'That code no longer exists. Refresh the list.',
  409: 'Too many workshop codes exist. Revoke some first.',
  429: 'Too many sign-in attempts. Wait a few minutes and try again.',
  503: 'Admin access is not configured on this server.',
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${ADMIN_BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new AdminError('Could not reach the workshop server.', 0);
  }
  if (!response.ok) throw new AdminError(MESSAGES[response.status] ?? 'That did not work. Please try again.', response.status);
  return response.json() as Promise<T>;
}

export const adminLogin = (email: string, password: string) =>
  call<{ email: string }>('/admin/login', { method: 'POST', body: JSON.stringify({ email, password }) });

export const adminLogout = () => call<{ ok: true }>('/admin/logout', { method: 'POST' });

export const listCodes = () => call<{ email: string; codes: WorkshopCode[] }>('/admin/codes');

export const createCode = (input: { label: string; expiresInHours: number; usageLimit: number }) =>
  call<{ code: string; entry: WorkshopCode }>('/admin/codes', { method: 'POST', body: JSON.stringify(input) });

export const revokeCode = (id: string) =>
  call<{ entry: WorkshopCode }>(`/admin/codes/${encodeURIComponent(id)}/revoke`, { method: 'POST' });
