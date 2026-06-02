# Photo Screensaver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an idle-mode photo screensaver to the wall kiosk, with photo upload/manage from the phone app and backend resize/serve.

**Architecture:** Photos live on the filesystem in `DATA_DIR/photos/` (no DB table). Backend uses `sharp` to resize on upload, `@fastify/multipart` for streaming multipart, and serves resized JPEGs via a regular Fastify route. Frontend adds a `Screensaver` overlay to `WallLayout` (5-min idle, Ken Burns dual-buffer crossfade) and a `PhotoManager` section to the phone Manage tab.

**Tech Stack:** sharp, @fastify/multipart, node:test, vitest, TanStack Query, CSS transforms (GPU-composited)

**Spec:** `docs/superpowers/specs/2026-06-01-photo-screensaver-design.md`

---

## File Map

### Backend (new)
- `backend/src/photos.ts` — photo storage module: init dirs, list, save (stream→sharp→disk), soft-delete, trash cleanup, serve stream, UUIDv7→createdAt extraction
- `backend/src/routes/photos.ts` — Fastify route plugin: GET list, POST upload, DELETE, GET serve
- `backend/src/routes/photos.test.ts` — unit tests for the storage module (filesystem operations)

### Backend (modify)
- `backend/package.json` — add `sharp`, `@fastify/multipart`
- `backend/src/config.ts` — add `photosDir`, `maxPhotoCount`
- `backend/src/server.ts` — register `photoRoutes`, call `initPhotos()` at startup

### Frontend (new)
- `frontend/src/components/screensaver/Screensaver.tsx` — fullscreen overlay: dual-buffer Ken Burns slideshow + clock + gradient scrim
- `frontend/src/components/screensaver/useScreensaver.ts` — 5-min idle timer hook, shuffle state, preload logic
- `frontend/src/components/manage/PhotoManager.tsx` — phone Manage tab: grid, upload, delete

### Frontend (modify)
- `frontend/src/core/api/client.ts` — add `photos`, `deletePhoto`, `uploadPhoto` to `api` object
- `frontend/src/core/hooks/useData.ts` — add `usePhotos()` query hook
- `frontend/src/core/hooks/useMutations.ts` — add `usePhotoMutations()` (upload + delete)
- `frontend/src/core/model/types.ts` — add `Photo` type
- `frontend/src/layouts/WallLayout.tsx` — mount `Screensaver`
- `frontend/src/layouts/PhoneLayout.tsx` — add `PhotoManager` to Manage tab

---

## Task 1: Install dependencies

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Install sharp and @fastify/multipart**

```bash
npm --workspace backend install sharp @fastify/multipart
```

- [ ] **Step 2: Install sharp types (dev)**

```bash
npm --workspace backend install -D @types/sharp
```

- [ ] **Step 3: Verify sharp loads**

```bash
node -e "require('sharp'); console.log('sharp OK')"
```

Expected: `sharp OK` (no native module errors)

- [ ] **Step 4: Commit**

```bash
git add backend/package.json package-lock.json
git commit -m "chore: add sharp and @fastify/multipart for photo upload"
```

---

## Task 2: Backend config + photo storage module

**Files:**
- Modify: `backend/src/config.ts`
- Create: `backend/src/photos.ts`

- [ ] **Step 1: Add photo config to `backend/src/config.ts`**

Add after the existing `staticDir` field:

```typescript
// Photo screensaver storage. Same host-mount as DB.
photosDir: path.join(process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data'), 'photos'),
maxPhotoCount: Number(process.env.MAX_PHOTO_COUNT ?? 500),
```

- [ ] **Step 2: Write failing tests for the photo storage module**

Create `backend/src/routes/photos.test.ts`:

```typescript
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  initPhotos,
  listPhotos,
  savePhoto,
  softDelete,
  purgeTrash,
  photoPath,
  FILENAME_RE,
} from '../photos';

let tmpDir: string;
let photosDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homecal-photos-'));
  photosDir = path.join(tmpDir, 'photos');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('initPhotos creates photos/ and photos/.trash/', () => {
  initPhotos(photosDir);
  assert.ok(fs.existsSync(photosDir));
  assert.ok(fs.existsSync(path.join(photosDir, '.trash')));
});

test('FILENAME_RE matches valid UUIDv7 filenames', () => {
  assert.ok(FILENAME_RE.test('019057e0-1234-7abc-89ab-0123456789ab.jpg'));
  assert.ok(!FILENAME_RE.test('../../etc/passwd'));
  assert.ok(!FILENAME_RE.test('hello.jpg'));
  assert.ok(!FILENAME_RE.test('019057e0-1234-7abc-89ab-0123456789ab.png'));
});

test('savePhoto writes a JPEG file and returns metadata', async () => {
  initPhotos(photosDir);
  // 1x1 red JPEG (smallest valid JPEG)
  const sharp = (await import('sharp')).default;
  const buf = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#ff0000' } })
    .jpeg()
    .toBuffer();

  const result = await savePhoto(photosDir, buf, 500);
  assert.ok(result.id);
  assert.ok(result.filename.endsWith('.jpg'));
  assert.ok(result.createdAt);
  assert.ok(fs.existsSync(path.join(photosDir, result.filename)));
});

test('savePhoto rejects when count cap is reached', async () => {
  initPhotos(photosDir);
  // Write 2 dummy files
  fs.writeFileSync(path.join(photosDir, 'a.jpg'), 'fake');
  fs.writeFileSync(path.join(photosDir, 'b.jpg'), 'fake');

  const sharp = (await import('sharp')).default;
  const buf = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ff0000' } })
    .jpeg()
    .toBuffer();

  await assert.rejects(() => savePhoto(photosDir, buf, 2), (err: any) => {
    assert.equal(err.statusCode, 422);
    assert.equal(err.code, 'PHOTO_LIMIT_REACHED');
    return true;
  });
});

test('listPhotos returns files sorted newest-first', () => {
  initPhotos(photosDir);
  // UUIDv7 sorts lexicographically by time. Use two filenames where 'b' > 'a'.
  fs.writeFileSync(path.join(photosDir, '019057e0-0000-7000-8000-000000000000.jpg'), 'x');
  fs.writeFileSync(path.join(photosDir, '019057e0-ffff-7000-8000-000000000000.jpg'), 'x');
  const list = listPhotos(photosDir);
  assert.equal(list.length, 2);
  assert.ok(list[0].id > list[1].id); // newest first
});

test('listPhotos excludes .trash directory', () => {
  initPhotos(photosDir);
  fs.writeFileSync(path.join(photosDir, '019057e0-0000-7000-8000-000000000000.jpg'), 'x');
  fs.writeFileSync(path.join(photosDir, '.trash', 'old.jpg'), 'x');
  const list = listPhotos(photosDir);
  assert.equal(list.length, 1);
});

test('softDelete moves file to .trash', () => {
  initPhotos(photosDir);
  const fname = '019057e0-0000-7000-8000-000000000000.jpg';
  fs.writeFileSync(path.join(photosDir, fname), 'x');
  softDelete(photosDir, '019057e0-0000-7000-8000-000000000000');
  assert.ok(!fs.existsSync(path.join(photosDir, fname)));
  assert.ok(fs.existsSync(path.join(photosDir, '.trash', fname)));
});

test('softDelete is idempotent (missing file → no error)', () => {
  initPhotos(photosDir);
  assert.doesNotThrow(() => softDelete(photosDir, '019057e0-0000-7000-8000-000000000000'));
});

test('purgeTrash removes files older than maxAge', () => {
  initPhotos(photosDir);
  const trashDir = path.join(photosDir, '.trash');
  const fname = 'old.jpg';
  fs.writeFileSync(path.join(trashDir, fname), 'x');
  // Set mtime to 8 days ago
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  fs.utimesSync(path.join(trashDir, fname), eightDaysAgo, eightDaysAgo);

  const recent = 'recent.jpg';
  fs.writeFileSync(path.join(trashDir, recent), 'x');

  purgeTrash(trashDir, 7);
  assert.ok(!fs.existsSync(path.join(trashDir, fname)));
  assert.ok(fs.existsSync(path.join(trashDir, recent)));
});

test('photoPath resolves within photosDir only', () => {
  initPhotos(photosDir);
  const valid = photoPath(photosDir, '019057e0-0000-7000-8000-000000000000');
  assert.ok(valid);
  const invalid = photoPath(photosDir, '../../etc/passwd');
  assert.equal(invalid, null);
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm --workspace backend test
```

Expected: new tests FAIL (module `../photos` does not exist)

- [ ] **Step 4: Implement photo storage module `backend/src/photos.ts`**

```typescript
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { newId } from './util/ids';
import { httpError } from './util/errors';

export const FILENAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/;

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif']);

export interface PhotoMeta {
  id: string;
  filename: string;
  url: string;
  createdAt: string;
}

function createdAtFromUuid(uuid: string): string {
  const hex = uuid.replace(/-/g, '').slice(0, 12);
  const ms = parseInt(hex, 16);
  return new Date(ms).toISOString();
}

export function initPhotos(photosDir: string): void {
  fs.mkdirSync(photosDir, { recursive: true });
  fs.mkdirSync(path.join(photosDir, '.trash'), { recursive: true });
}

export function listPhotos(photosDir: string): PhotoMeta[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(photosDir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith('.jpg') && !f.startsWith('.'))
    .sort()
    .reverse()
    .map((f) => {
      const id = f.replace('.jpg', '');
      return { id, filename: f, url: `/api/photos/${f}`, createdAt: createdAtFromUuid(id) };
    });
}

export async function savePhoto(
  photosDir: string,
  buffer: Buffer,
  maxCount: number
): Promise<PhotoMeta> {
  const existing = fs.readdirSync(photosDir).filter((f) => f.endsWith('.jpg') && !f.startsWith('.'));
  if (existing.length >= maxCount) {
    throw httpError(422, 'PHOTO_LIMIT_REACHED', `Maximum of ${maxCount} photos reached`);
  }

  const meta = await sharp(buffer, { sequentialRead: true, limitInputPixels: 100_000_000 })
    .timeout({ seconds: 10 })
    .metadata();

  if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) {
    throw httpError(422, 'INVALID_FORMAT', `Unsupported image format: ${meta.format ?? 'unknown'}. Accepted: JPEG, PNG, WebP, HEIC`);
  }

  const id = newId();
  const filename = `${id}.jpg`;
  const dest = path.join(photosDir, filename);

  await sharp(buffer, { sequentialRead: true, limitInputPixels: 100_000_000 })
    .timeout({ seconds: 10 })
    .rotate() // auto-orient from EXIF
    .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(dest);

  return { id, filename, url: `/api/photos/${filename}`, createdAt: createdAtFromUuid(id) };
}

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

export function purgeTrash(trashDir: string, maxAgeDays: number): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(trashDir);
  } catch {
    return;
  }
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  for (const f of entries) {
    try {
      const fp = path.join(trashDir, f);
      const stat = fs.statSync(fp);
      if (stat.mtimeMs < cutoff) fs.unlinkSync(fp);
    } catch {
      /* best-effort */
    }
  }
}

export function photoPath(photosDir: string, id: string): string | null {
  const filename = `${id}.jpg`;
  if (!FILENAME_RE.test(filename)) return null;
  const resolved = path.resolve(photosDir, filename);
  if (!resolved.startsWith(path.resolve(photosDir))) return null;
  return resolved;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm --workspace backend test
```

Expected: all new photo tests PASS, all existing tests still PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/photos.ts backend/src/routes/photos.test.ts backend/src/config.ts
git commit -m "feat: photo storage module with tests (save, list, soft-delete, trash)"
```

---

## Task 3: Backend photo routes

**Files:**
- Create: `backend/src/routes/photos.ts`
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Create `backend/src/routes/photos.ts`**

```typescript
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { config } from '../config';
import { listPhotos, savePhoto, softDelete, photoPath, FILENAME_RE } from '../photos';
import { httpError } from '../util/errors';
import { broker } from '../realtime';

export async function photoRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: { fileSize: 20 * 1024 * 1024 },
  });

  app.get('/api/photos', async () => {
    return { data: listPhotos(config.photosDir) };
  });

  app.post('/api/photos', async (req, reply) => {
    const file = await req.file();
    if (!file) throw httpError(400, 'NO_FILE', 'No file uploaded');

    const buffer = await file.toBuffer();
    const photo = await savePhoto(config.photosDir, buffer, config.maxPhotoCount);
    broker.poke('photos');
    return reply.status(201).send(photo);
  });

  app.delete<{ Params: { id: string } }>('/api/photos/:id', async (req, reply) => {
    softDelete(config.photosDir, req.params.id);
    broker.poke('photos');
    return reply.status(204).send();
  });

  app.get<{ Params: { filename: string } }>('/api/photos/:filename', async (req, reply) => {
    const { filename } = req.params;
    if (!FILENAME_RE.test(filename)) throw httpError(400, 'INVALID_FILENAME', 'Invalid photo filename');

    const id = filename.replace('.jpg', '');
    const resolved = photoPath(config.photosDir, id);
    if (!resolved || !fs.existsSync(resolved)) throw httpError(404, 'NOT_FOUND', 'Photo not found');

    return reply
      .header('content-type', 'image/jpeg')
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'public, max-age=31536000, immutable')
      .send(fs.createReadStream(resolved));
  });
}
```

- [ ] **Step 2: Register routes and init photos in `backend/src/server.ts`**

Add import at top:

```typescript
import { photoRoutes } from './routes/photos';
import { initPhotos, purgeTrash } from './photos';
```

After `getDb();` add:

```typescript
initPhotos(config.photosDir);
purgeTrash(path.join(config.photosDir, '.trash'), 7);
```

After `await app.register(feedRoutes);` add:

```typescript
await app.register(photoRoutes);
```

- [ ] **Step 3: Verify build and tests pass**

```bash
npm --workspace backend test && npm run build
```

Expected: all tests PASS, build clean

- [ ] **Step 4: Manual smoke test**

```bash
rm -rf /tmp/d && DATA_DIR=/tmp/d STATIC_DIR=frontend/dist PORT=8797 node backend/dist/server.js &
sleep 2

# List (empty)
curl -s localhost:8797/api/photos | jq .

# Upload a test image
convert -size 100x100 xc:red /tmp/test.jpg 2>/dev/null || python3 -c "
from PIL import Image; Image.new('RGB',(100,100),'red').save('/tmp/test.jpg')
" 2>/dev/null || echo 'create test.jpg manually'
curl -s -X POST -F "file=@/tmp/test.jpg" localhost:8797/api/photos | jq .

# List (1 photo)
curl -s localhost:8797/api/photos | jq '.data | length'

# Serve
FNAME=$(curl -s localhost:8797/api/photos | jq -r '.data[0].filename')
curl -sI localhost:8797/api/photos/$FNAME | grep -E 'content-type|x-content|cache-control'

# Delete
ID=$(curl -s localhost:8797/api/photos | jq -r '.data[0].id')
curl -s -o /dev/null -w '%{http_code}' -X DELETE localhost:8797/api/photos/$ID
# Should be 204

# Verify soft-delete (file in .trash)
ls /tmp/d/photos/.trash/

kill %1
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/photos.ts backend/src/server.ts
git commit -m "feat: photo upload/list/delete/serve API routes"
```

---

## Task 4: Frontend types + API client + hooks

**Files:**
- Modify: `frontend/src/core/model/types.ts`
- Modify: `frontend/src/core/api/client.ts`
- Modify: `frontend/src/core/hooks/useData.ts`
- Modify: `frontend/src/core/hooks/useMutations.ts`

- [ ] **Step 1: Add Photo type to `frontend/src/core/model/types.ts`**

Add at the end of the file:

```typescript
export interface Photo {
  id: string;
  filename: string;
  url: string;
  createdAt: string;
}
```

- [ ] **Step 2: Add photo API methods to `frontend/src/core/api/client.ts`**

Add to the imports:

```typescript
import type { ..., Photo } from '../model/types';
```

Add to the `api` object:

```typescript
  // photo reads
  photos: () => get<{ data: Photo[] }>('/api/photos').then((r) => r.data),

  // photo writes
  deletePhoto: (id: string) => send<void>('DELETE', `/api/photos/${id}`),
```

Note: `uploadPhoto` uses XHR for progress tracking, so it lives in the mutation hook, not here.

- [ ] **Step 3: Add `usePhotos()` query hook to `frontend/src/core/hooks/useData.ts`**

Add import:

```typescript
import type { ..., Photo } from '../model/types';
```

Add hook:

```typescript
export function usePhotos() {
  return useQuery<Photo[]>({
    queryKey: ['photos'],
    queryFn: api.photos,
    staleTime: 5 * 60_000,
  });
}
```

- [ ] **Step 4: Add `usePhotoMutations()` to `frontend/src/core/hooks/useMutations.ts`**

Add at the end of the file:

```typescript
export function usePhotoMutations() {
  const qc = useQueryClient();
  const settle = () => void qc.invalidateQueries({ queryKey: ['photos'] });

  const remove = useMutation({
    mutationFn: (id: string) => api.deletePhoto(id),
    onSettled: settle,
  });

  return { remove };
}
```

- [ ] **Step 5: Build check**

```bash
npm run build
```

Expected: clean

- [ ] **Step 6: Commit**

```bash
git add frontend/src/core/model/types.ts frontend/src/core/api/client.ts frontend/src/core/hooks/useData.ts frontend/src/core/hooks/useMutations.ts
git commit -m "feat: frontend photo types, API client, query + mutation hooks"
```

---

## Task 5: Phone — PhotoManager component

**Files:**
- Create: `frontend/src/components/manage/PhotoManager.tsx`
- Modify: `frontend/src/layouts/PhoneLayout.tsx`

- [ ] **Step 1: Create `frontend/src/components/manage/PhotoManager.tsx`**

```tsx
import { useState, useRef } from 'react';
import { Upload, X } from 'lucide-react';
import type { Photo } from '../../core/model/types';
import { usePhotos } from '../../core/hooks/useData';
import { usePhotoMutations } from '../../core/hooks/useMutations';
import { Button } from '../primitives/Button';

interface UploadProgress {
  file: File;
  progress: number;
}

function uploadFile(file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/photos');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`)));
    xhr.onerror = () => reject(new Error('Upload failed'));
    const fd = new FormData();
    fd.append('file', file);
    xhr.send(fd);
  });
}

export function PhotoManager() {
  const photosQ = usePhotos();
  const { remove } = usePhotoMutations();
  const photos = photosQ.data ?? [];

  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [preview, setPreview] = useState<Photo | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList) => {
    const arr = Array.from(files);
    for (const file of arr) {
      const entry: UploadProgress = { file, progress: 0 };
      setUploads((prev) => [...prev, entry]);
      try {
        await uploadFile(file, (pct) => {
          setUploads((prev) => prev.map((u) => (u.file === file ? { ...u, progress: pct } : u)));
        });
      } catch {
        /* upload error — entry will be cleaned up below */
      }
      setUploads((prev) => prev.filter((u) => u.file !== file));
    }
    photosQ.refetch();
  };

  const onDelete = (photo: Photo) => {
    remove.mutate(photo.id, { onSuccess: () => setPreview(null) });
  };

  return (
    <section style={{ marginTop: 24 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
        <h2 className="font-semibold text-text-muted" style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Photos
          <span className="font-normal" style={{ marginLeft: 8, fontSize: 12 }}>
            {photos.length} photo{photos.length !== 1 ? 's' : ''} · max 500
          </span>
        </h2>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1.5 rounded-full font-semibold"
          style={{ fontSize: 13, padding: '8px 14px', background: 'var(--accent)', color: '#fff' }}
        >
          <Upload size={14} /> Upload
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {/* Upload progress */}
      {uploads.map((u, i) => (
        <div key={i} className="rounded-md border border-border" style={{ padding: '8px 12px', marginBottom: 8, background: 'var(--surface)' }}>
          <div className="flex items-center justify-between" style={{ fontSize: 13 }}>
            <span className="truncate" style={{ maxWidth: '70%' }}>{u.file.name}</span>
            <span className="text-text-muted">{u.progress}%</span>
          </div>
          <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, marginTop: 4 }}>
            <div style={{ height: '100%', width: `${u.progress}%`, background: 'var(--accent)', borderRadius: 2, transition: 'width 0.2s' }} />
          </div>
        </div>
      ))}

      {/* Photo grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
        {photos.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPreview(p)}
            style={{ aspectRatio: '1', borderRadius: 6, overflow: 'hidden', background: 'var(--surface-2)' }}
          >
            <img src={p.url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </button>
        ))}
      </div>

      {photos.length === 0 && uploads.length === 0 && (
        <p className="text-text-faint" style={{ fontSize: 14, textAlign: 'center', padding: '24px 0' }}>
          No photos yet. Upload some to enable the wall screensaver.
        </p>
      )}

      {/* Preview overlay */}
      {preview && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: 24,
          }}
        >
          <img src={preview.url} alt="" style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: 8 }} />
          <div className="flex gap-3" style={{ marginTop: 16 }}>
            <Button variant="danger" onClick={() => onDelete(preview)} disabled={remove.isPending}>
              Delete
            </Button>
            <Button variant="ghost" onClick={() => setPreview(null)} style={{ color: '#fff' }}>
              Close
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Add PhotoManager to phone Manage tab in `frontend/src/layouts/PhoneLayout.tsx`**

Add import:

```typescript
import { PhotoManager } from '../components/manage/PhotoManager';
```

Inside the `{tab === 'manage' && ...}` block, after `<CategoryManager .../>`, add:

```tsx
<PhotoManager />
```

- [ ] **Step 3: Build check**

```bash
npm run build
```

Expected: clean

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/manage/PhotoManager.tsx frontend/src/layouts/PhoneLayout.tsx
git commit -m "feat: phone photo manager — upload, grid, preview, delete"
```

---

## Task 6: Wall — Screensaver hook

**Files:**
- Create: `frontend/src/components/screensaver/useScreensaver.ts`

- [ ] **Step 1: Create `frontend/src/components/screensaver/useScreensaver.ts`**

```typescript
import { useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Photo } from '../../core/model/types';

const IDLE_MS = 5 * 60_000;

function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface ScreensaverState {
  active: boolean;
  queue: Photo[];
  index: number;
  dismiss: () => void;
}

export function useScreensaver(photos: Photo[] | undefined): ScreensaverState {
  const [active, setActive] = useState(false);
  const [queue, setQueue] = useState<Photo[]>([]);
  const [index, setIndex] = useState(0);
  const timerRef = useRef(0);
  const qc = useQueryClient();

  const resetTimer = useCallback(() => {
    window.clearTimeout(timerRef.current);
    if (active) return; // don't restart while showing
    timerRef.current = window.setTimeout(() => {
      setActive(true);
    }, IDLE_MS);
  }, [active]);

  // Listen for user interaction to reset timer
  useEffect(() => {
    resetTimer();
    const bump = () => {
      if (!active) resetTimer();
    };
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    return () => {
      window.clearTimeout(timerRef.current);
      events.forEach((e) => window.removeEventListener(e, bump));
    };
  }, [resetTimer, active]);

  // On activation, build shuffled queue
  useEffect(() => {
    if (!active) return;
    const list = photos ?? [];
    if (list.length === 0) {
      setActive(false);
      return;
    }
    setQueue(fisherYates(list));
    setIndex(0);
  }, [active, photos]);

  const dismiss = useCallback(() => {
    setActive(false);
    setQueue([]);
    setIndex(0);
    // Reset idle timer
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setActive(true), IDLE_MS);
    // Invalidate cache so calendar is fresh
    void qc.invalidateQueries();
  }, [qc]);

  return { active, queue, index, dismiss };
}

export function useAdvance(
  active: boolean,
  queue: Photo[],
  index: number,
  setIndex: (fn: (i: number) => number) => void
): void {
  // Exposed for the Screensaver component to manage via its own advancing logic
}
```

Wait — the advance logic is tightly coupled with the image preloading (onload/onerror), so it belongs in the component itself. Let me simplify this hook to just manage idle state + shuffle, and export the `setIndex` setter.

Actually, let me restructure: the hook returns `{ active, queue, index, setIndex, dismiss }` and the component drives advancing.

Replace the above with:

```typescript
import { useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Photo } from '../../core/model/types';

const IDLE_MS = 5 * 60_000;

function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface ScreensaverState {
  active: boolean;
  queue: Photo[];
  index: number;
  advance: () => void;
  skipPhoto: (id: string) => void;
  dismiss: () => void;
}

export function useScreensaver(photos: Photo[] | undefined): ScreensaverState {
  const [active, setActive] = useState(false);
  const [queue, setQueue] = useState<Photo[]>([]);
  const [index, setIndex] = useState(0);
  const timerRef = useRef(0);
  const qc = useQueryClient();

  const arm = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setActive(true), IDLE_MS);
  }, []);

  useEffect(() => {
    if (active) return;
    arm();
    const bump = () => arm();
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    return () => {
      window.clearTimeout(timerRef.current);
      events.forEach((e) => window.removeEventListener(e, bump));
    };
  }, [active, arm]);

  useEffect(() => {
    if (!active) return;
    const list = photos ?? [];
    if (list.length === 0) {
      setActive(false);
      return;
    }
    setQueue(fisherYates(list));
    setIndex(0);
  }, [active, photos]);

  const advance = useCallback(() => {
    setIndex((i) => {
      const next = i + 1;
      if (next >= queue.length) {
        setQueue(fisherYates(queue));
        return 0;
      }
      return next;
    });
  }, [queue]);

  const skipPhoto = useCallback((id: string) => {
    setQueue((q) => {
      const filtered = q.filter((p) => p.id !== id);
      if (filtered.length === 0) {
        setActive(false);
        arm();
        return [];
      }
      return filtered;
    });
    setIndex((i) => Math.min(i, queue.length - 2));
  }, [queue.length, arm]);

  const dismiss = useCallback(() => {
    setActive(false);
    setQueue([]);
    setIndex(0);
    arm();
    void qc.invalidateQueries();
  }, [qc, arm]);

  return { active, queue, index, advance, skipPhoto, dismiss };
}
```

- [ ] **Step 2: Build check**

```bash
npm run build
```

Expected: clean (hook is unused but exported — tree-shaking keeps it)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/screensaver/useScreensaver.ts
git commit -m "feat: screensaver idle timer + shuffle hook"
```

---

## Task 7: Wall — Screensaver component

**Files:**
- Create: `frontend/src/components/screensaver/Screensaver.tsx`
- Modify: `frontend/src/layouts/WallLayout.tsx`

- [ ] **Step 1: Create `frontend/src/components/screensaver/Screensaver.tsx`**

```tsx
import { useEffect, useRef, useState, useCallback } from 'react';
import { DateTime } from 'luxon';
import { ZONE } from '../../core/util/time';
import type { Photo } from '../../core/model/types';

interface Props {
  queue: Photo[];
  index: number;
  advance: () => void;
  skipPhoto: (id: string) => void;
  dismiss: () => void;
}

const REDUCED_MOTION =
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function randomKenBurns(isPortrait: boolean): { from: string; to: string } {
  if (REDUCED_MOTION) return { from: 'scale3d(1,1,1) translate3d(0,0,0)', to: 'scale3d(1,1,1) translate3d(0,0,0)' };
  const scaleMin = isPortrait ? 1.02 : 1.05;
  const scaleMax = isPortrait ? 1.05 : 1.15;
  const s = scaleMin + Math.random() * (scaleMax - scaleMin);
  const txMax = isPortrait ? 2 : 5;
  const tyMax = isPortrait ? 5 : 3;
  const tx = (Math.random() * txMax * 2 - txMax).toFixed(2);
  const ty = (Math.random() * tyMax * 2 - tyMax).toFixed(2);
  return {
    from: `scale3d(${s.toFixed(3)},${s.toFixed(3)},1) translate3d(0%,0%,0)`,
    to: `scale3d(${s.toFixed(3)},${s.toFixed(3)},1) translate3d(${tx}%,${ty}%,0)`,
  };
}

function displayMs(count: number): number {
  if (count === 1) return 30_000;
  if (count <= 3) return 20_000;
  return 10_000;
}

export function Screensaver({ queue, index, advance, skipPhoto, dismiss }: Props) {
  const [visible, setVisible] = useState(false);
  const [front, setFront] = useState(0); // which buffer is in front: 0 or 1
  const imgRefs = [useRef<HTMLImageElement>(null), useRef<HTMLImageElement>(null)];
  const advanceTimer = useRef(0);
  const preloaded = useRef(false);

  // Fade in on mount
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const current = queue[index];
  const next = queue[(index + 1) % queue.length];
  const interval = displayMs(queue.length);

  // Load current photo into front buffer and start Ken Burns
  useEffect(() => {
    const img = imgRefs[front].current;
    if (!img || !current) return;
    img.src = current.url;
    const kb = randomKenBurns(false); // portrait detection happens onload
    img.style.transition = 'none';
    img.style.transform = kb.from;
    img.style.opacity = '1';

    const onLoad = () => {
      const isPortrait = img.naturalHeight > img.naturalWidth;
      const kb2 = randomKenBurns(isPortrait);
      img.style.transition = 'none';
      img.style.transform = kb2.from;
      // Force reflow then animate
      void img.offsetHeight;
      img.style.transition = `transform ${interval}ms linear, opacity 1.5s ease`;
      img.style.transform = kb2.to;
      preloaded.current = false;

      // Pre-load next image
      if (next && next.id !== current.id) {
        const preload = new Image();
        preload.src = next.url;
        preload.onload = () => { preloaded.current = true; };
      }
    };

    img.addEventListener('load', onLoad, { once: true });
    img.addEventListener('error', () => skipPhoto(current.id), { once: true });

    // 8s load timeout — if image hasn't loaded, skip it
    const loadTimeout = window.setTimeout(() => skipPhoto(current.id), 8000);

    // Schedule advance
    window.clearTimeout(advanceTimer.current);
    advanceTimer.current = window.setTimeout(() => {
      // Freeze outgoing buffer
      const outgoing = imgRefs[front].current;
      if (outgoing) {
        const computed = getComputedStyle(outgoing).transform;
        outgoing.style.transition = 'opacity 1.5s ease';
        outgoing.style.transform = computed;
        outgoing.style.opacity = '0';
      }
      setFront((f) => (f === 0 ? 1 : 0));
      advance();
    }, interval);

    return () => {
      window.clearTimeout(advanceTimer.current);
      window.clearTimeout(loadTimeout);
      img.removeEventListener('load', onLoad);
    };
  }, [current, index, front]);

  // Dismiss handler
  const onDismiss = useCallback(
    (e: React.PointerEvent | React.TouchEvent) => {
      e.stopPropagation();
      setVisible(false);
      setTimeout(dismiss, 300);
    },
    [dismiss]
  );

  const now = DateTime.now().setZone(ZONE);

  return (
    <div
      onPointerDown={onDismiss}
      onTouchStart={onDismiss}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: '#000',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.3s ease',
        overflow: 'hidden',
        cursor: 'none',
      }}
    >
      {/* Dual image buffers */}
      {[0, 1].map((i) => (
        <img
          key={i}
          ref={imgRefs[i]}
          alt=""
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'cover',
            willChange: 'transform',
            opacity: i === front ? 1 : 0,
          }}
        />
      ))}

      {/* Gradient scrim */}
      <div
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          height: '25%',
          background: 'linear-gradient(transparent, rgba(0,0,0,0.55))',
          pointerEvents: 'none',
        }}
      />

      {/* Clock */}
      <div
        style={{
          position: 'absolute', bottom: 20, left: 20,
          color: '#fff',
          textShadow: '0 1px 3px rgba(0,0,0,0.8)',
          fontVariantNumeric: 'tabular-nums',
          pointerEvents: 'none',
        }}
      >
        <div style={{ fontSize: 48, fontWeight: 300 }}>
          {now.toFormat('h:mm')}
        </div>
        <div style={{ fontSize: 16, textTransform: 'uppercase', opacity: 0.9 }}>
          {now.toFormat('EEEE d LLLL')}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount Screensaver in `frontend/src/layouts/WallLayout.tsx`**

Add imports:

```typescript
import { useScreensaver } from '../components/screensaver/useScreensaver';
import { Screensaver } from '../components/screensaver/Screensaver';
import { usePhotos } from '../core/hooks/useData';
```

Inside `WallLayout`, after the existing query hooks, add:

```typescript
const photosQ = usePhotos();
const screensaver = useScreensaver(photosQ.data);
```

At the very end of the JSX return (just before the closing `</div>`), after `<VirtualKeyboard />`, add:

```tsx
{screensaver.active && screensaver.queue.length > 0 && (
  <Screensaver
    queue={screensaver.queue}
    index={screensaver.index}
    advance={screensaver.advance}
    skipPhoto={screensaver.skipPhoto}
    dismiss={screensaver.dismiss}
  />
)}
```

- [ ] **Step 3: Build check**

```bash
npm run build
```

Expected: clean

- [ ] **Step 4: Manual verification**

```bash
rm -rf /tmp/d && DATA_DIR=/tmp/d STATIC_DIR=frontend/dist PORT=8798 node backend/dist/server.js &
sleep 2

# Upload a few test photos
for i in 1 2 3; do
  convert -size 800x600 "xc:rgb($((RANDOM%256)),$((RANDOM%256)),$((RANDOM%256)))" /tmp/test$i.jpg 2>/dev/null
  curl -s -X POST -F "file=@/tmp/test$i.jpg" localhost:8798/api/photos > /dev/null
done

# Open wall view — wait 5 minutes (or temporarily reduce IDLE_MS to 10s for testing)
# Verify: screensaver fades in, Ken Burns animates, clock shows, tap dismisses
```

For faster testing, temporarily change `IDLE_MS` to `10_000` in `useScreensaver.ts`, rebuild, and test. Restore to `5 * 60_000` before committing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/screensaver/Screensaver.tsx frontend/src/components/screensaver/useScreensaver.ts frontend/src/layouts/WallLayout.tsx
git commit -m "feat: wall screensaver — Ken Burns slideshow with clock overlay"
```

---

## Task 8: Frontend tests

**Files:**
- Create: `frontend/src/components/screensaver/useScreensaver.test.ts`

- [ ] **Step 1: Write screensaver utility tests**

Create `frontend/src/components/screensaver/useScreensaver.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

// Test the Fisher-Yates shuffle (extract for testability)
function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

describe('fisherYates', () => {
  it('returns all elements (no duplicates, no missing)', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = fisherYates(input);
    expect(result).toHaveLength(input.length);
    expect(new Set(result)).toEqual(new Set(input));
  });

  it('does not mutate the original array', () => {
    const input = [1, 2, 3];
    const copy = [...input];
    fisherYates(input);
    expect(input).toEqual(copy);
  });

  it('handles single element', () => {
    expect(fisherYates([42])).toEqual([42]);
  });

  it('handles empty array', () => {
    expect(fisherYates([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run frontend tests**

```bash
npm --workspace frontend test
```

Expected: all new + existing tests PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/screensaver/useScreensaver.test.ts
git commit -m "test: screensaver shuffle unit tests"
```

---

## Task 9: Final integration test + full test run

- [ ] **Step 1: Run all backend tests**

```bash
npm --workspace backend test
```

Expected: all PASS (existing recurrence/broker/backup + new photo tests)

- [ ] **Step 2: Run all frontend tests**

```bash
npm --workspace frontend test
```

Expected: all PASS

- [ ] **Step 3: Full build**

```bash
npm run build
```

Expected: clean

- [ ] **Step 4: Docker build**

```bash
docker compose build
```

Expected: sharp installs + builds successfully in the Docker image

- [ ] **Step 5: End-to-end smoke test**

```bash
rm -rf /tmp/d && DATA_DIR=/tmp/d STATIC_DIR=frontend/dist PORT=8799 node backend/dist/server.js &
sleep 2

# Upload photos
for i in 1 2 3 4 5; do
  curl -s -X POST -F "file=@/tmp/test$i.jpg" localhost:8799/api/photos > /dev/null
done

# Verify API
curl -s localhost:8799/api/photos | jq '.data | length'  # 5

# Verify phone manage tab shows photos
# Verify wall screensaver activates after idle
# Verify tap dismisses screensaver

kill %1
```

- [ ] **Step 6: Update SESSION-LOG.md**

Add a new entry to `docs/SESSION-LOG.md` documenting what was built, files changed, verification steps, and test counts.

- [ ] **Step 7: Update CLAUDE.md**

Add a note under the status section about the photo screensaver feature.

- [ ] **Step 8: Commit all remaining changes**

```bash
git add -A
git commit -m "feat: photo screensaver — upload, manage, wall slideshow with Ken Burns"
```
