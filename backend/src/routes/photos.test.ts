import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {
  FILENAME_RE,
  initPhotos,
  listPhotos,
  savePhoto,
  softDelete,
  purgeTrash,
  photoPath,
} from '../photos';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homecal-photos-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Generate a tiny JPEG buffer via sharp. */
async function tinyJpeg(width = 64, height = 64): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 128, g: 0, b: 0 } },
  })
    .jpeg({ quality: 50 })
    .toBuffer();
}

/** Generate a tiny PNG buffer via sharp. */
async function tinyPng(width = 64, height = 64): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 128, b: 0 } },
  })
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// initPhotos
// ---------------------------------------------------------------------------

test('initPhotos creates photos/ and photos/.trash/', () => {
  const photosDir = path.join(tmpDir, 'photos');
  initPhotos(photosDir);
  assert.ok(fs.existsSync(photosDir));
  assert.ok(fs.existsSync(path.join(photosDir, '.trash')));
});

test('initPhotos is idempotent', () => {
  const photosDir = path.join(tmpDir, 'photos');
  initPhotos(photosDir);
  initPhotos(photosDir); // no throw
  assert.ok(fs.existsSync(photosDir));
});

// ---------------------------------------------------------------------------
// FILENAME_RE
// ---------------------------------------------------------------------------

test('FILENAME_RE accepts a valid UUIDv7 .jpg filename', () => {
  assert.ok(FILENAME_RE.test('019049e0-a13c-7000-8000-000000000001.jpg'));
});

test('FILENAME_RE rejects non-v7 UUID (wrong version nibble)', () => {
  assert.ok(!FILENAME_RE.test('019049e0-a13c-4000-8000-000000000001.jpg'));
});

test('FILENAME_RE rejects missing extension', () => {
  assert.ok(!FILENAME_RE.test('019049e0-a13c-7000-8000-000000000001'));
});

test('FILENAME_RE rejects path traversal attempt', () => {
  assert.ok(!FILENAME_RE.test('../019049e0-a13c-7000-8000-000000000001.jpg'));
});

// ---------------------------------------------------------------------------
// savePhoto
// ---------------------------------------------------------------------------

test('savePhoto writes a JPEG and returns metadata', async () => {
  const photosDir = path.join(tmpDir, 'photos');
  initPhotos(photosDir);

  const buf = await tinyJpeg();
  const meta = await savePhoto(photosDir, buf, 500);

  assert.ok(meta.id);
  assert.ok(FILENAME_RE.test(meta.filename));
  assert.ok(meta.url.startsWith('/api/photos/'));
  assert.ok(typeof meta.createdAt === 'string');
  assert.ok(fs.existsSync(path.join(photosDir, meta.filename)));
});

test('savePhoto accepts PNG input and converts to JPEG', async () => {
  const photosDir = path.join(tmpDir, 'photos');
  initPhotos(photosDir);

  const buf = await tinyPng();
  const meta = await savePhoto(photosDir, buf, 500);

  assert.ok(meta.filename.endsWith('.jpg'));
  // Confirm the file on disk is actually JPEG
  const info = await sharp(path.join(photosDir, meta.filename)).metadata();
  assert.equal(info.format, 'jpeg');
});

test('savePhoto rejects when count cap is reached', async () => {
  const photosDir = path.join(tmpDir, 'photos');
  initPhotos(photosDir);

  // Create 2 dummy files to hit the cap of 2
  fs.writeFileSync(path.join(photosDir, '019049e0-a13c-7000-8000-000000000001.jpg'), 'fake');
  fs.writeFileSync(path.join(photosDir, '019049e0-a13c-7000-8000-000000000002.jpg'), 'fake');

  const buf = await tinyJpeg();
  await assert.rejects(() => savePhoto(photosDir, buf, 2), (err: any) => {
    assert.equal(err.statusCode, 422);
    assert.equal(err.code, 'PHOTO_LIMIT_REACHED');
    return true;
  });
});

test('savePhoto resizes large images to max 1920px long edge', async () => {
  const photosDir = path.join(tmpDir, 'photos');
  initPhotos(photosDir);

  const buf = await sharp({
    create: { width: 3000, height: 2000, channels: 3, background: { r: 0, g: 0, b: 128 } },
  })
    .jpeg({ quality: 50 })
    .toBuffer();

  const meta = await savePhoto(photosDir, buf, 500);
  // Verify the file on disk was resized
  const info = await sharp(path.join(photosDir, meta.filename)).metadata();
  assert.ok(info.width! <= 1920);
  assert.ok(info.height! <= 1920);
  assert.equal(info.width, 1920);
  assert.equal(info.height, 1280);
});

// ---------------------------------------------------------------------------
// listPhotos
// ---------------------------------------------------------------------------

test('listPhotos returns newest-first, excludes .trash', async () => {
  const photosDir = path.join(tmpDir, 'photos');
  initPhotos(photosDir);

  const buf = await tinyJpeg();
  const m1 = await savePhoto(photosDir, buf, 500);
  // small delay so UUIDv7 timestamps differ
  await new Promise((r) => setTimeout(r, 5));
  const m2 = await savePhoto(photosDir, buf, 500);

  const list = listPhotos(photosDir);
  assert.equal(list.length, 2);
  // newest first
  assert.equal(list[0].filename, m2.filename);
  assert.equal(list[1].filename, m1.filename);
});

test('listPhotos ignores dotfiles and non-.jpg files', () => {
  const photosDir = path.join(tmpDir, 'photos');
  initPhotos(photosDir);

  fs.writeFileSync(path.join(photosDir, '.hidden'), 'nope');
  fs.writeFileSync(path.join(photosDir, 'readme.txt'), 'nope');

  const list = listPhotos(photosDir);
  assert.equal(list.length, 0);
});

// ---------------------------------------------------------------------------
// softDelete
// ---------------------------------------------------------------------------

test('softDelete moves file to .trash/', async () => {
  const photosDir = path.join(tmpDir, 'photos');
  initPhotos(photosDir);

  const buf = await tinyJpeg();
  const meta = await savePhoto(photosDir, buf, 500);
  const id = meta.filename.replace('.jpg', '');

  softDelete(photosDir, id);
  assert.ok(!fs.existsSync(path.join(photosDir, meta.filename)));
  assert.ok(fs.existsSync(path.join(photosDir, '.trash', meta.filename)));
});

test('softDelete is idempotent (ENOENT does not throw)', async () => {
  const photosDir = path.join(tmpDir, 'photos');
  initPhotos(photosDir);

  // deleting a non-existent file should not throw
  softDelete(photosDir, '019049e0-a13c-7000-8000-000000000099');
});

// ---------------------------------------------------------------------------
// purgeTrash
// ---------------------------------------------------------------------------

test('purgeTrash removes old files, keeps recent ones', () => {
  const trashDir = path.join(tmpDir, 'photos', '.trash');
  fs.mkdirSync(trashDir, { recursive: true });

  // old file: mtime set to 30 days ago
  const oldFile = path.join(trashDir, 'old.jpg');
  fs.writeFileSync(oldFile, 'old');
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  fs.utimesSync(oldFile, new Date(thirtyDaysAgo), new Date(thirtyDaysAgo));

  // recent file
  const newFile = path.join(trashDir, 'new.jpg');
  fs.writeFileSync(newFile, 'new');

  purgeTrash(trashDir, 7);

  assert.ok(!fs.existsSync(oldFile));
  assert.ok(fs.existsSync(newFile));
});

// ---------------------------------------------------------------------------
// photoPath
// ---------------------------------------------------------------------------

test('photoPath resolves a valid id to the photos directory', () => {
  const photosDir = path.join(tmpDir, 'photos');
  initPhotos(photosDir);

  const id = '019049e0-a13c-7000-8000-000000000001';
  const result = photoPath(photosDir, id);
  assert.equal(result, path.join(photosDir, `${id}.jpg`));
});

test('photoPath rejects path traversal', () => {
  const photosDir = path.join(tmpDir, 'photos');
  initPhotos(photosDir);

  assert.throws(() => photoPath(photosDir, '../etc/passwd'), (err: any) => {
    assert.equal(err.statusCode, 400);
    return true;
  });
});

test('photoPath rejects invalid id format', () => {
  const photosDir = path.join(tmpDir, 'photos');
  initPhotos(photosDir);

  assert.throws(() => photoPath(photosDir, 'not-a-uuid'), (err: any) => {
    assert.equal(err.statusCode, 400);
    return true;
  });
});
