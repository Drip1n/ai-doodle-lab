/**
 * One shared image pipeline for everything the AI sees: canvas drawings,
 * uploaded photos and challenge drawings all end up as the same
 * 224x224 white-background square.
 */

export const MODEL_INPUT_SIZE = 224;
export const THUMBNAIL_SIZE = 128;

type Source = HTMLCanvasElement | HTMLImageElement;

function sourceSize(source: Source): { width: number; height: number } {
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

/**
 * Draws the source centred inside a square white canvas, keeping its aspect
 * ratio (letterboxing with white so nothing is stretched).
 */
export function toSquareCanvas(source: Source, size: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Could not create a drawing surface.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  const { width, height } = sourceSize(source);
  if (!width || !height) return out;

  const scale = Math.min(size / width, size / height);
  const w = width * scale;
  const h = height * scale;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, (size - w) / 2, (size - h) / 2, w, h);
  return out;
}

export function toModelCanvas(source: Source): HTMLCanvasElement {
  return toSquareCanvas(source, MODEL_INPUT_SIZE);
}

export function toThumbnail(source: Source): string {
  return toSquareCanvas(source, THUMBNAIL_SIZE).toDataURL('image/png');
}

/** True when the canvas is still (almost) pure white — nothing drawn yet. */
export function isCanvasBlank(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return true;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // Sample every 8th pixel: plenty to notice a single brush stroke.
  for (let i = 0; i < data.length; i += 32) {
    if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240) return false;
  }
  return true;
}

const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function isSupportedImage(file: File): boolean {
  return SUPPORTED_TYPES.includes(file.type);
}

/** Loads a picked file into an <img>, rejecting unsupported or broken files. */
export function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (!isSupportedImage(file)) {
      reject(new Error('That file type is not supported. Try a JPG, PNG or WEBP.'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (!img.naturalWidth || !img.naturalHeight) {
        reject(new Error('That image could not be opened. Try a different one.'));
        return;
      }
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That image could not be opened. Try a different one.'));
    };
    img.src = url;
  });
}
