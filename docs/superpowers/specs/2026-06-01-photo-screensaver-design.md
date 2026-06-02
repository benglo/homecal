# Photo Screensaver — Design Spec

## Overview

After 5 minutes of no interaction on the wall display, a fullscreen photo slideshow activates with Ken Burns effect. Touch anywhere to dismiss and return to the calendar. Photos are uploaded from the phone app and stored/resized on the server.

## Backend

### Storage

Photos live in `DATA_DIR/photos/` (host-mounted alongside the DB). All files are JPEG, server-named as `{UUIDv7}.jpg`. The `photos/` directory is created at server startup (`fs.mkdirSync(photosDir, { recursive: true })`) — same pattern as the data dir itself.

### Processing

On upload, the server uses `sharp` (streaming API) to:
- Resize to max 1920px on the long edge (preserves aspect ratio)
- Strip EXIF metadata
- Convert to JPEG at quality 80
- Configured with `sequentialRead: true` and `limitInputPixels: 100_000_000` (100MP cap)
- Processing timeout: 10 seconds (`sharp.timeout({ seconds: 10 })`)

The original upload buffer is **never written to disk** — only the sharp output is persisted. This destroys any polyglot/embedded payloads.

Result: each photo is ~200-400KB. Upload limit is 20MB pre-resize.

### Accepted formats

JPEG, PNG, WebP, HEIC only. SVG, TIFF, GIF are rejected at upload validation (SVG allows XXE/script execution; TIFF triggers libvips edge cases). Validation uses both the multipart MIME header and `sharp.metadata()` format detection.

### Photo count cap

Configurable via `MAX_PHOTO_COUNT` env var (default: 500). Uploads are rejected with 422 when the cap is reached. Prevents disk exhaustion on the shared data volume.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/photos` | List all photos: `{ data: [{ id, filename, url, createdAt }] }`. Sorted newest-first (UUIDv7 is lexicographically time-ordered). |
| `POST` | `/api/photos` | Multipart upload via `@fastify/multipart` (streaming — pipe into sharp, never buffer full image in RAM). Returns created photo object. |
| `DELETE` | `/api/photos/:id` | Soft-delete: moves file to `DATA_DIR/photos/.trash/`. Returns 204. Idempotent (ENOENT → 204). |
| `GET` | `/api/photos/:filename` | Serves the resized JPEG. Regular Fastify route with `fs.createReadStream` (NOT `@fastify/static` — avoids double-registration conflict). |

### Soft-delete and trash

Deleted photos move to `DATA_DIR/photos/.trash/{filename}`. A cleanup runs on server startup: files in `.trash/` older than 7 days are permanently removed. Photos are not covered by the DB backup (`VACUUM INTO`), so soft-delete provides the only recovery path.

### Serving photos — security

The `GET /api/photos/:filename` route:
- Validates filename with strict regex: `/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/`
- After `path.join()`, verifies resolved path starts with the photos directory
- Rejects any filename containing `/`, `\`, `..`, or null bytes
- Response headers: `Content-Type: image/jpeg`, `X-Content-Type-Options: nosniff`, `Cache-Control: public, max-age=31536000, immutable` (content-addressed by UUIDv7)

### No database table

The filesystem is the source of truth. The listing endpoint reads the `photos/` directory (excluding `.trash/`). `createdAt` is derived from the UUIDv7 filename timestamp. Races (delete-during-list) are handled by catching ENOENT and skipping the entry.

### Dependencies

- `sharp` (backend, ARM-compatible — prebuilt binaries for linux/arm64 on Node 20)
- `@fastify/multipart` (streaming multipart parsing with `limits: { fileSize: 20 * 1024 * 1024 }`)

### Docker

- `DATA_DIR/photos/` uses the same host bind-mount as the DB — no additional volumes
- sharp prebuilt binary resolves automatically; smoke-test with `node -e "require('sharp')"` in runtime stage
- If prebuild fails on arm64, add `pkg-config libvips-dev` to the build stage `apt-get`

## Frontend — Wall (Screensaver Component)

### Activation

A second idle timer (5 minutes / 300,000ms) runs in `WallLayout`, independent of the existing 90s idle reset. The screensaver timer resets only on user-initiated `pointerdown`/`touchstart` events — programmatic view changes (like the 90s idle reset) do not count as interaction.

If no photos exist (empty listing response), the screensaver does not activate.

### Slideshow Mechanics

**Dual-buffer crossfade:** Two stacked `<img>` elements (front/back), both with `will-change: transform` and using `translate3d`/`scale3d` for guaranteed GPU compositing on the Pi. When transitioning:
1. Preload next photo into the back buffer (starts as soon as current photo begins displaying)
2. Apply a new random Ken Burns transform to the back buffer
3. Only advance when the next image's `onload` has fired (skip on timeout after 8s)
4. Crossfade: back opacity 0→1, front opacity 1→0 (1.5s CSS transition)
5. Pause the outgoing image's animation at crossfade start (set computed transform as static value — only one image animates at a time to reduce Pi GPU load)
6. Swap roles

**Ken Burns effect:** Each photo gets a random start position and slow pan/zoom over its 10-second display time:
- `transform: scale3d(1.05–1.15, 1.05-1.15, 1) translate3d(±2–5%, ±2–5%, 0)`
- CSS transition: `transform 10s linear`
- Random direction per photo
- Portrait images (detected via natural dimensions): reduce scale to 1.02–1.05, bias vertical pan

**Image display:** `object-fit: cover` — family photos are about faces, moderate crop is acceptable. Combined with Ken Burns pan, more of the frame is revealed over the 10s duration.

**Shuffle algorithm:** Fisher-Yates on the photo list at screensaver activation. No repeats until all photos have shown, then reshuffle. Photo list is refreshed from the API each time the screensaver activates (picks up new uploads/deletes).

**Few-photos edge cases:**
- 1 photo: single slow pan (no crossfade), reset direction each loop, display time 30s
- 2-3 photos: increase display time to 20s per photo

**Error handling:** `onerror` on `<img>` skips the broken photo and removes it from the current shuffle queue.

**Reduced motion:** When `prefers-reduced-motion: reduce` is active, disable Ken Burns (static display) and use simple opacity crossfade only.

### Clock Overlay

- **Position:** Bottom-left, 20px from edges
- **Content:** Time (h:mm format, `font-weight: 300`, 48px) + day/date below (16px, uppercase)
- **Font:** Geist (self-hosted), `font-variant-numeric: tabular-nums`
- **Contrast:** Gradient scrim across bottom ~25% of screen: `linear-gradient(transparent, rgba(0,0,0,0.55))`. Additional text-shadow on clock text: `0 1px 3px rgba(0,0,0,0.8)` as safety net for high-key photos.

### Dismiss

Any `pointerdown` or `touchstart` event on the screensaver overlay:
- Fade out the overlay (300ms opacity transition)
- Reset the 5-minute idle timer
- Invalidate TanStack Query cache (ensures calendar shows fresh data on return)

## Frontend — Phone (Manage Tab)

### Photos Section

Added below the Categories section in the Manage tab:

- **Header:** "Photos" with a count badge ("12 photos · max 500")
- **Grid:** Square thumbnails, 3 columns, gap between them
- **Upload:** Button opens native file picker (`accept="image/jpeg,image/png,image/webp,image/heic"`, `multiple` attribute for batch upload). Shows determinate progress bar during upload or thumbnail with spinner overlay per file.
- **Delete:** Tap thumbnail → preview with delete button (one extra tap prevents accidental deletion). DELETE request moves to trash.

### Data Layer

- `usePhotos()` hook — TanStack Query, fetches `GET /api/photos`
- `useUploadPhoto()` mutation — multipart POST with XHR for upload progress, invalidates photo list on success
- `useDeletePhoto()` mutation — DELETE, invalidates photo list on success

## Out of Scope (v1)

- Photo albums or folders
- Captions or metadata display on screen
- Alternative transition styles
- Brightness/dimming schedule (handled by existing `--kiosk-brightness` CSS var)
- Upload from wall (phone only)
- Photo reordering or favourites
- Video support
- Trash management UI (auto-purge at 7 days is sufficient)
