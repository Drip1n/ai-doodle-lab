export const IMAGE_MODE = import.meta.env.VITE_IMAGE_MODE === 'live' ? 'live' : 'demo';
export const IMAGE_ENDPOINT = import.meta.env.VITE_IMAGE_ENDPOINT?.trim() ?? '';

export interface ImageRequest {
  category: { id: string; name: string };
  idea: string;
  references: string[];
}

export function isImageSource(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return true;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

/** Calls our server function, never a provider directly or with a provider key. */
export async function requestImage(request: ImageRequest, signal: AbortSignal): Promise<string> {
  if (!IMAGE_ENDPOINT) throw new Error('Picture making is not connected yet. Ask your workshop teacher to set it up.');
  const response = await fetch(IMAGE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok) throw new Error('The picture could not be made. Please try again in a little while.');
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || !('image' in result) || !isImageSource(result.image)) {
    throw new Error('The picture did not arrive correctly. Please try again.');
  }
  return result.image;
}
