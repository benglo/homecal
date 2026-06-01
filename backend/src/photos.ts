import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { newId } from './util/ids';
import { httpError } from './util/errors';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** UUIDv7 filename pattern — exactly `<uuidv7>.jpg`. */
export const FILENAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/;

/** Formats sharp can decode that we accept as upload input. */
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif']);

const MAX_LONG_EDGE = 1920;
const JPEG_QUALITY = 80;
const SHARP_TIMEOUT = 10_000; // 10 s
const SHARP_PIXEL_LIMIT = 100_000_000; // 100 MP

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PhotoMeta {
  filename: string;
  width: number;
  height: number;
  sizeBytes: number;
  createdAt: string; // ISO-8601
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the millisecond timestamp embedded in the first 48 bits of a UUIDv7. */
function uuidv7ToDate(uuid: string): Date {
  const hex = uuid.replace(/-/g, '').slice(0, 12); // first 48 bits
  return new Date(parseInt(hex, 16));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Ensure the photos directory and its .trash sub-directory exist. */
export function initPhotos(photosDir: string): void {
  fs.mkdirSync(path.join(photosDir, '.trash'), { recursive: true });
}

/**
 * List all photos, newest-first. Each entry includes the filename and the
 * createdAt timestamp derived from the UUIDv7 id.
 */
export function listPhotos(photosDir: string): PhotoMeta[] {
  const entries = fs.readdirSync(photosDir).filter((f) => FILENAME_RE.test(f));

  return entries
    .map((filename) => {
      const stat = fs.statSync(path.join(photosDir, filename));
      const id = filename.replace('.jpg', '');
      return {
        filename,
        width: 0, // not stored — cheap listing; full metadata only on save
        height: 0,
        sizeBytes: stat.size,
        createdAt: uuidv7ToDate(id).toISOString(),
      };
    })
    .sort((a, b) => (a.filename > b.filename ? -1 : a.filename < b.filename ? 1 : 0));
}

/**
 * Validate, resize, strip EXIF, and save a photo.
 *
 * @returns Metadata of the saved file.
 * @throws 422 PHOTO_LIMIT_REACHED when `maxCount` is hit.
 * @throws 422 INVALID_PHOTO_FORMAT when the input isn't a supported image.
 */
export async function savePhoto(
  photosDir: string,
  buffer: Buffer,
  maxCount: number,
): Promise<PhotoMeta> {
  // --- count guard ---
  const existing = fs.readdirSync(photosDir).filter((f) => FILENAME_RE.test(f));
  if (existing.length >= maxCount) {
    throw httpError(422, 'PHOTO_LIMIT_REACHED', `Maximum of ${maxCount} photos reached`);
  }

  // --- validate format ---
  const meta = await sharp(buffer, {
    sequentialRead: true,
    limitInputPixels: SHARP_PIXEL_LIMIT,
  }).metadata();

  if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) {
    throw httpError(422, 'INVALID_PHOTO_FORMAT', `Unsupported image format: ${meta.format ?? 'unknown'}`);
  }

  // --- resize + convert ---
  let pipeline = sharp(buffer, {
    sequentialRead: true,
    limitInputPixels: SHARP_PIXEL_LIMIT,
  })
    .rotate() // auto-rotate based on EXIF orientation, then strip EXIF
    .resize({
      width: MAX_LONG_EDGE,
      height: MAX_LONG_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY })
    .timeout({ seconds: SHARP_TIMEOUT / 1000 });

  const outputBuffer = await pipeline.toBuffer({ resolveWithObject: true });

  const id = newId();
  const filename = `${id}.jpg`;
  const dest = path.join(photosDir, filename);

  fs.writeFileSync(dest, outputBuffer.data);

  return {
    filename,
    width: outputBuffer.info.width,
    height: outputBuffer.info.height,
    sizeBytes: outputBuffer.data.length,
    createdAt: uuidv7ToDate(id).toISOString(),
  };
}

/**
 * Soft-delete a photo by moving it to the `.trash/` sub-directory.
 * Idempotent — silently ignores ENOENT.
 */
export function softDelete(photosDir: string, id: string): void {
  const filename = `${id}.jpg`;
  const src = path.join(photosDir, filename);
  const dest = path.join(photosDir, '.trash', filename);
  try {
    fs.renameSync(src, dest);
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/**
 * Remove trash files older than `maxAgeDays`.
 */
export function purgeTrash(trashDir: string, maxAgeDays: number): void {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let entries: string[];
  try {
    entries = fs.readdirSync(trashDir);
  } catch (err: any) {
    if (err.code === 'ENOENT') return;
    throw err;
  }

  for (const entry of entries) {
    const fullPath = path.join(trashDir, entry);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(fullPath);
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
}

/**
 * Resolve a photo id to an absolute path, validating against path traversal.
 *
 * @throws 400 INVALID_PHOTO_ID on bad id or traversal attempt.
 */
export function photoPath(photosDir: string, id: string): string {
  const filename = `${id}.jpg`;
  if (!FILENAME_RE.test(filename)) {
    throw httpError(400, 'INVALID_PHOTO_ID', `Invalid photo id: ${id}`);
  }
  const resolved = path.join(photosDir, filename);
  if (!resolved.startsWith(photosDir)) {
    throw httpError(400, 'INVALID_PHOTO_ID', 'Path traversal detected');
  }
  return resolved;
}
