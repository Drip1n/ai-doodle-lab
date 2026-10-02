export const IMAGE_MODE = import.meta.env.VITE_IMAGE_MODE === 'live' ? 'live' : 'demo';
export const IMAGE_ENDPOINT = import.meta.env.VITE_IMAGE_ENDPOINT?.trim() ?? '';

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

/** Calls our server function, never a provider directly or with a provider key. */
export async function requestImage(request: ImageRequest, signal: AbortSignal, workshopCode?: string): Promise<string> {
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
    if (response.status === 429) {
      const detail = await response.json().catch(() => null);
      throw new Error(detail?.code === 'busy'
        ? 'Another picture is still being made. Please wait a moment.'
        : detail?.code === 'limit'
          ? 'The workshop picture limit has been reached. Ask your teacher to reset it.'
          : 'The workshop is busy or its picture limit has been reached. Ask your teacher.');
    }
    const messages: Record<number, string> = {
      401: 'Ask your teacher for the workshop code, then try again.',
      429: 'The workshop is busy or its picture limit has been reached. Ask your teacher.',
      503: 'Picture making is not configured yet. Ask your workshop teacher.',
    };
    throw new Error(messages[response.status] ?? 'The picture could not be made. Please try again in a little while.');
  }
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || !('image' in result) || !isImageSource(result.image)) {
    throw new Error('The picture did not arrive correctly. Please try again.');
  }
  return result.image;
}
