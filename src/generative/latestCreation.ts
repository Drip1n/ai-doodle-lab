import type { GeneratedPicture } from '../types';
import { isImageSource, SHARE_PATH_PATTERN } from './imageApi';

/**
 * The rules for keeping the latest generated picture across a navigation and,
 * where it is honest to do so, across a reload.
 *
 * Two kinds of picture come back from the server:
 *
 *  - an inline `data:` image, which is bytes we hold ourselves. Those are
 *    worth writing to IndexedDB: they will still render tomorrow.
 *  - an `https:` URL on the provider's own host, whose lifetime is not ours
 *    to promise. Those are kept for the session only. Storing one would mean
 *    a child reopening the app to a broken image and being told it is their
 *    picture, which is worse than an honest empty panel.
 *
 * The phone link has its own, shorter lifetime, so it is dropped on the way
 * in or out as soon as it has expired, leaving the picture itself intact.
 */

/** Only bytes we hold ourselves are worth promising across a reload. */
export const isDurable = (picture: GeneratedPicture): boolean => picture.image.startsWith('data:');

/** Whether the phone link on this picture is still worth showing. */
export const hasLiveShare = (picture: GeneratedPicture | null, now = Date.now()): boolean =>
  Boolean(picture?.sharePath && picture.shareExpiresAt && picture.shareExpiresAt > now);

/** The picture with any expired phone link removed. */
export function withoutExpiredShare(picture: GeneratedPicture, now = Date.now()): GeneratedPicture {
  if (hasLiveShare(picture, now)) return picture;
  if (picture.sharePath === undefined && picture.shareExpiresAt === undefined) return picture;
  const { sharePath: _path, shareExpiresAt: _expiry, ...rest } = picture;
  return rest;
}

/**
 * A stored row turned back into a picture, or null. Everything is re-checked:
 * the row came from a browser store that another tab, an older version of the
 * app or a curious child could have written to.
 */
export function restoreCreation(value: unknown, now = Date.now()): GeneratedPicture | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<GeneratedPicture>;
  if (!isImageSource(row.image) || !row.image.startsWith('data:')) return null;
  if (typeof row.categoryId !== 'string' || !row.categoryId) return null;
  if (typeof row.categoryName !== 'string' || !row.categoryName) return null;
  if (typeof row.prompt !== 'string' || !row.prompt) return null;
  if (typeof row.createdAt !== 'number' || !Number.isFinite(row.createdAt)) return null;
  const picture: GeneratedPicture = {
    image: row.image,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    prompt: row.prompt,
    createdAt: row.createdAt,
  };
  if (typeof row.sharePath === 'string' && SHARE_PATH_PATTERN.test(row.sharePath)
    && typeof row.shareExpiresAt === 'number' && Number.isFinite(row.shareExpiresAt)) {
    picture.sharePath = row.sharePath;
    picture.shareExpiresAt = row.shareExpiresAt;
  }
  return withoutExpiredShare(picture, now);
}
