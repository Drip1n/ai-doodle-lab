export const IMAGE_MODE = import.meta.env.VITE_IMAGE_MODE === 'live' ? 'live' : 'demo';
export const IMAGE_ENDPOINT = import.meta.env.VITE_IMAGE_ENDPOINT?.trim() ?? '';

/**
 * How long the browser waits in total. A request can sit in the server's
 * queue (IMAGE_QUEUE_WAIT_MS, 120s by default) before its provider call
 * (IMAGE_PROVIDER_TIMEOUT_MS, 90s) even starts, so a shorter client timeout
 * would abandon pictures that were still on their way.
 */
export const IMAGE_TIMEOUT_MS = 240_000;

/**
 * The temporary phone-handoff link the server may hand back with a picture.
 * Matched strictly, because this string is turned into a URL on our own API
 * origin: a surprising response body must not be able to point a QR code
 * anywhere else.
 */
export const SHARE_PATH_PATTERN = /^\/api\/shared-image\/[A-Za-z0-9_-]{43}$/;

export interface ImageRequest {
  category: { id: string; name: string };
  idea: string;
  style?: 'realistic' | 'cartoon' | 'painting' | 'toy';
  references: string[];
}

export function isImageSource(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return true;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

/**
 * Wording lives here, not on the server: the panel shows children whatever
 * this map says, so a surprising response body can never put unexpected text
 * on a workshop screen.
 */
const BY_CODE: Record<string, string> = {
  busy: 'Lots of pictures are being made right now. Wait a moment and try again.',
  limit: 'The workshop picture limit has been reached. Ask your teacher to reset it.',
  rate: 'That workshop code has made a lot of pictures very quickly. Wait a moment and try again.',
  unknown: 'Ask your teacher for the workshop code, then try again.',
  revoked: 'That workshop code is not in use any more. Ask your teacher for the new one.',
  expired: 'That workshop code has finished for today. Ask your teacher.',
  exhausted: 'That workshop code has made all of its pictures. Ask your teacher.',
};

const BY_STATUS: Record<number, string> = {
  401: 'Ask your teacher for the workshop code, then try again.',
  403: 'Ask your teacher for the workshop code, then try again.',
  413: 'That drawing is too big. Try with fewer drawing clues.',
  429: 'Lots of pictures are being made right now. Wait a moment and try again.',
  503: 'Picture making is not ready right now. Ask your workshop teacher.',
};

export interface ImageResult {
  image: string;
  /** Present only when the server really is holding a phone copy. */
  sharePath?: string;
  shareExpiresAt?: number;
}

/**
 * The origin of our API, so a QR code can carry an absolute URL a phone can
 * open. Derived from the configured endpoint -- an absolute
 * `VITE_IMAGE_ENDPOINT` names the backend origin, a relative one means the
 * backend is this same site. No hostname is ever hardcoded.
 */
export function apiOrigin(): string {
  if (/^https?:\/\//i.test(IMAGE_ENDPOINT)) {
    try { return new URL(IMAGE_ENDPOINT).origin; } catch { return ''; }
  }
  return typeof window === 'undefined' ? '' : window.location.origin;
}

/** The absolute phone URL for a share path, or null if it cannot be trusted. */
export function shareUrl(sharePath: string | undefined): string | null {
  if (!sharePath || !SHARE_PATH_PATTERN.test(sharePath)) return null;
  const origin = apiOrigin();
  if (!/^https?:\/\/[^/]+$/.test(origin)) return null;
  return `${origin}${sharePath}`;
}

/** Calls our server function, never a provider directly or with a provider key. */
export async function requestImage(request: ImageRequest, signal: AbortSignal, workshopCode?: string): Promise<ImageResult> {
  if (!IMAGE_ENDPOINT) throw new Error('Picture making is not connected yet. Ask your workshop teacher to set it up.');
  const code = workshopCode?.trim();
  if (code && !/^[\x21-\x7E]+$/.test(code)) {
    throw new Error('Use the workshop code from your teacher with English letters, numbers or symbols, without spaces.');
  }
  const response = await fetch(IMAGE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(code ? { 'X-Workshop-Code': code } : {}) },
    credentials: 'same-origin',
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok) {
    const detail: unknown = await response.json().catch(() => null);
    const reason = detail && typeof detail === 'object' && 'code' in detail && typeof detail.code === 'string'
      ? detail.code
      : '';
    throw new Error(BY_CODE[reason] ?? BY_STATUS[response.status] ?? 'The picture could not be made. Please try again in a little while.');
  }
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || !('image' in result) || !isImageSource(result.image)) {
    throw new Error('The picture did not arrive correctly. Please try again.');
  }
  const share = result as { sharePath?: unknown; shareExpiresAt?: unknown };
  // The QR fields are an extra. Anything unexpected about them is dropped,
  // never an error: the child still has their picture.
  if (typeof share.sharePath === 'string' && SHARE_PATH_PATTERN.test(share.sharePath)
    && typeof share.shareExpiresAt === 'number' && Number.isFinite(share.shareExpiresAt)
    && share.shareExpiresAt > Date.now()) {
    return { image: result.image, sharePath: share.sharePath, shareExpiresAt: share.shareExpiresAt };
  }
  return { image: result.image };
}
