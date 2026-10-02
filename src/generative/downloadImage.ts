import { isImageSource } from './imageApi';

/**
 * Saving a generated picture to the child's device.
 *
 * Kept out of the component so it can be tested directly, and so the two
 * source shapes the server may return -- an inline `data:` image or an
 * `https:` URL -- are handled in one place.
 */

/** `ai-doodle-flying-cat.png`, safe on Windows, macOS and Linux alike. */
export function pictureFileName(categoryName: string): string {
  const safe = categoryName
    .normalize('NFKD')
    // Strip accents, so "Café" becomes "cafe" rather than losing the word.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40);
  return `ai-doodle-${safe || 'picture'}.png`;
}

function save(href: string, fileName: string) {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  // Firefox only acts on a click if the anchor is in the document.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * A `data:` image is already bytes, so it goes straight to the anchor. An
 * `https:` one has to be fetched first: pointing `download` at a cross-origin
 * URL is ignored by browsers, which navigate to the image instead of saving
 * it, and the child loses the picture they just made.
 */
export async function downloadImage(source: string, fileName: string): Promise<void> {
  // The same guard the app uses on anything the server returns: never hand a
  // javascript:, blob: or http: source to an anchor.
  if (!isImageSource(source)) throw new Error('That picture cannot be saved.');
  if (source.startsWith('data:')) {
    save(source, fileName);
    return;
  }
  const response = await fetch(source);
  if (!response.ok) throw new Error('That picture could not be fetched.');
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    save(objectUrl, fileName);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
