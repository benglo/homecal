# Local TTS Sidecar — Design

**Status:** Draft, awaiting sign-off.
**Brainstormed with:** 4-persona review (senior backend engineer, SRE, voice/audio specialist, family-UX).
**Feasibility:** validated on the home server (Intel i5-7400, 16 GB RAM) — see §10.
**Supersedes for TTS only:** `2026-06-04-voice-commands-design.md` §3.5 (Kokoro 82M via OpenRouter).

---

## 1. One-liner

Move TTS synthesis off OpenRouter onto a Python sidecar container on the home server. Same Kokoro 82M voices, lower and more consistent latency (LAN ~1.2 s vs cloud 1–3 s typical, 5 s+ spikes), no read-timeouts, no per-utterance cloud cost.

## 2. Background

Today's TTS path is OpenRouter `/audio/speech` (Kokoro 82M, voice `af_bella`). The June 7th 2026 session hit two `Read timed out` errors inside a 30-minute window; both were swallowed silently (the action applied on the wall but no audio came back, indistinguishable from "wake word broken"). We patched the silent-failure mode the same day with a bool-return + WARNING + single retry (commit `f9b6790`), but the underlying flakiness remains.

The home server (192.168.1.94) sits idle ~90 % of the time and is already a hard dependency of the kiosk (it serves the calendar). Hosting TTS there adds no new failure surface and removes one cloud dependency from a feature that's used several times a day.

### Why not on the Pi

Empirically tested 2026-06-08 (see §10). Pi 5 (Cortex-A76) runs Kokoro fp16 at 2.8× real-time (5.6 s synth for 2 s audio). That's worse than the cloud's typical latency. The dev server's i5-7400 (Kaby Lake, AVX2) runs the same model at 0.6× RT (1.2 s synth for 2 s audio) — fast enough to beat cloud in the happy path.

### Why not stay on cloud

- TTS is the only voice subsystem still routinely WAN-dependent in the happy path (STT primary is cloud but local whisper.cpp fallback works; this is the symmetric move for TTS).
- Per-utterance cost is negligible (~$0.0002) but per-utterance latency variance is not.
- The retry we added today is a band-aid; on-device is the cure.

---

## 3. Locked decisions (binding — read before changing behaviour)

1. **Sidecar runs as its own container in the existing `docker-compose.yml`** — not a Node child process, not a host systemd unit.
2. **Hard memory limit:** `mem_limit: 1500m` on the sidecar service. The sidecar OOMs alone before it can take the calendar with it.
3. **Image arch pinned:** `platform: linux/amd64`. Prevents an accidental ARM build from silently breaking.
4. **Model + voice files baked into the image.** No first-boot downloads, no surprise minutes-long startup, atomic rollback via image tag.
5. **Wire format: WAV, 24 kHz, int16, mono.** Kokoro's native sample rate, halved bandwidth vs fp32, played by every standard player. No re-encoding to MP3/Opus on the sidecar — saves ~50 ms CPU per reply, costs ~48 KB/s on a LAN where we have 100+ Mbit free.
6. **Sync `POST /tts`** returning audio bytes. No async/WebSocket; the call is sub-second and there's exactly one client.
7. **Auth via `X-Pi-Token`** — re-uses `backend/src/voice/auth.ts` middleware. The LAN includes IoT devices and guest wifi; "trust the LAN" is how you get adversarial text-to-speech at 11 pm.
8. **Pre-rendered catalog endpoints** (`GET /catalog/noise/{key}`, `GET /catalog/joke/{id}`) — these are *not* synth at request time. Generated at image build, cached in-memory at boot, served as bytes. Eliminates the "1.2 s pause before a fart sound" comedy crime and kills the empty-string-TTS bug at its root.
9. **Fallback ladder on the Pi:** local → cloud (existing retry) → `didnt_catch.mp3` → silent + WARNING + audit `tts_provider=none, error=tts_all_failed`. **No "silent" before the clip** — the clip is always better feedback than nothing.
10. **Cloud-fallback rate cap.** When the LAN sidecar misbehaves we don't want a broken-sidecar week to quietly burn cloud budget. Re-use the `_under_cap` pattern from `main.py` to cap **cloud TTS calls** at the same `daily_request_cap` as the rest of the voice service. Past the cap, the ladder skips straight from local → clip.
11. **Pi-side health cache:** 30 s "sidecar reachable" cache mirroring `is_muted_locally` in `main.py`. The first `/tts` call after TTL expiry IS the probe — no separate `/healthz` round-trip on the happy path. A failed `/tts` (connection refused / 5xx / timeout) marks the sidecar "down" for the next 30 s so subsequent utterances jump straight to cloud without paying the 3 s timeout each time. The dedicated `/healthz` endpoint exists for the Docker healthcheck (§12.2) and for operator debugging, not for per-utterance polling.
12. **Single voice.** Stay on `af_bella` for v1. Vary prosody (speed/pitch) if we want per-intent personality, **not identity** — "Mycroft" is a character; multiple voices = multiple characters = confusing for kids.
13. **No streaming in v1.** Wait-then-play. Stitching seams in a short confirmation ("Dinner set to —[click]— pasta") read as malfunction. Reassess for jokes after 50 clean replies in a row.
14. **"Single-origin" spec scope clarified:** §0 of the voice-commands spec applies to **browser** origins (one URL for the wall, no CORS). Pi → backend and Pi → kokoro-tts are LAN service-to-service calls; they're outside that scope. A one-line clarification is added to that spec as part of this work.

---

## 4. v1 scope

**In scope:**
- New `kokoro-tts` container in `docker-compose.yml`, Python 3.13 + onnxruntime + kokoro-onnx + espeak-ng, Kokoro fp16 model + voices file baked in.
- HTTP API: `POST /tts`, `GET /catalog/noise/{key}`, `GET /catalog/joke/{id}`, `GET /healthz`. All non-health endpoints require `X-Pi-Token`.
- Build-time pre-render of the noise catalog (12 entries) and joke catalog (30 entries) into in-image audio files.
- Pi-side `tts.py` extension: `TTS_BACKEND=lan` env, `TTS_SERVER_URL` env, 30 s health cache, fallback ladder, player preference swap (prefer `ffplay`/`paplay` over `mpg123` for WAV).
- Pi-side `noise_play` + `joke_tell` rewiring: hit the sidecar's catalog endpoints first; if 404 or sidecar down, fall to today's behaviour.
- Audit schema gains `tts_provider` enum (`kokoro_lan` | `openrouter` | `clip` | `none`) and `tts_latency_ms` int.
- Backend `GET /api/voice/status` gains `last_tts_provider` field (computed from the most recent non-null `tts_provider` row in `voice_utterances`).
- Frontend: ambient coloured dot on `VoiceChip` — green (full), amber (TTS-only, no intent), grey (voice muted/offline). No text, no modal.
- §0 of `2026-06-04-voice-commands-design.md` gets a one-line clarification on the single-origin scope.

**Out of scope (deferred):**
- Streaming synthesis (jokes-only experiment, after 50 clean wait-then-play replies).
- Per-intent voice variety (different identities). Prosody knobs are also v2.
- A "one sec" stall clip when fallback kicks in (UX review wanted this; deferring to keep v1 lean, can add in a small follow-up).
- Pre-rendering generic timer/dinner confirmations (the strings are too varied — only the fixed catalogs benefit).
- Moving the sidecar off the same host as the SQLite DB. Acceptable today at <1 QPS with `mem_limit` enforced.

---

## 5. Architecture

### 5.1 Topology

```
┌──────────────────── Pi 5 (192.168.1.135) ──────────────────────┐
│  homecal-voice (systemd, Python)                                │
│    wake → STT → intent → execute → speak                        │
│                                       │                          │
│  ┌─────────────────────────────────── speak() ──────────────┐   │
│  │  if catalog hit:                                          │   │
│  │     GET /catalog/{kind}/{key} → bytes → play             │   │
│  │  else:                                                    │   │
│  │     ladder: lan → cloud → clip → silent                  │   │
│  └───────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                       │ LAN, X-Pi-Token
                       ▼
┌──────────────── Home server (192.168.1.94) ────────────────────┐
│  docker-compose:                                                │
│    homecal (Fastify + frontend, existing)                       │
│    kokoro-tts (NEW, Python, mem_limit: 1500m, platform: amd64)  │
│      ├─ POST   /tts                                             │
│      ├─ GET    /catalog/noise/{key}                             │
│      ├─ GET    /catalog/joke/{id}                               │
│      └─ GET    /healthz                                         │
└─────────────────────────────────────────────────────────────────┘
                       │ fallback only
                       ▼
              OpenRouter /audio/speech
              (existing retry path, capped per day)
```

### 5.2 Components

**Sidecar container — `kokoro-tts/`** (new top-level directory in the repo):

- `Dockerfile` — Python 3.13 slim base + `espeak-ng` + venv + `kokoro-onnx` + `fastapi` + `uvicorn`. Model files copied in from a `models/` subdir.
- `models/` — `kokoro-v1.0.fp16.onnx` (170 MB) + `voices-v1.0.bin` (27 MB). Gitignored; pulled by a build-time script from the upstream GitHub release.
- `app/service.py` — FastAPI app. Loads Kokoro at startup (~1.1 s on i5-7400), runs one warm synthesis before marking `/healthz` 200. Single worker (one Pi, one request at a time). Returns WAV bytes.
- `app/render_catalogs.py` — build-time script. Reads `kiosk/voice/homecal_voice/catalogs/{noises,jokes}.json`, synthesizes each entry, writes WAV files into `/app/cache/{noise,joke}/`.
- `app/audio.py` — small helpers: int16 conversion, 100 ms leading-silence prepend (A2DP wake-up mask), peak normalize to −3 dBFS, WAV serialization.

**Pi-side changes — `kiosk/voice/homecal_voice/`**:

- `tts.py` — new `_synthesize_lan(text)` and `_fetch_catalog(kind, key)` paths. `speak()` and `play_clip()` gain backend-dispatch logic. The cloud retry path stays exactly as today (commit `f9b6790`) and becomes a fallback rung.
- `tts.py` — `_detect_player` swaps order to `ffplay > paplay > pw-play > mpg123` so WAV plays without re-encoding.
- `executor.py` `_noise_play` — when sidecar is reachable, hit `/catalog/noise/{catalog_key}` directly instead of returning `spoken=""`. Eliminates the empty-string TTS dance entirely for matcher hits.
- `executor.py` `_joke_tell` — emit `joke_id` (already in the matcher output), hit `/catalog/joke/{joke_id}` instead of speaking setup + pause + punchline via cloud TTS. The 1.5 s pause is baked into the pre-rendered audio.
- `main.py` — new `lan_tts_health()` with 30 s cache. New env var `TTS_BACKEND` (default `lan` once validated, `cloud` for safe-rollback).
- `config.py` — `tts_backend`, `tts_server_url`, `tts_server_timeout_s` fields.

**Frontend — `frontend/src/components/controls/VoiceChip.tsx`**:

- New ambient dot rendered on the chip. Reads `/api/voice/status` (existing endpoint, already polled). Colour mapping:
  - **Green** — `mic_online && tts_provider in (kokoro_lan, openrouter)` in the last successful utterance.
  - **Amber** — `mic_online && tts_provider in (clip, none)` in the last utterance (degraded).
  - **Grey** — `muted || !mic_online`.
- The `/api/voice/status` payload gets a new field `last_tts_provider` (last successful utterance's provider). No SSE change; existing 5 s poll backstop is enough.

---

## 6. Schema additions

### 6.1 Backend — migration v7 (`backend/src/db/migrate.ts`)

```sql
-- v7: TTS provenance on voice utterances
ALTER TABLE voice_utterances ADD COLUMN tts_provider TEXT;
ALTER TABLE voice_utterances ADD COLUMN tts_latency_ms INTEGER;
```

Both nullable; legacy rows stay NULL. Enum is enforced in the zod schema only (`voiceAuditBody`); SQLite stays flexible to avoid a CHECK constraint that's hard to evolve.

Allowed `tts_provider` values: `kokoro_lan`, `openrouter`, `clip`, `none`.

### 6.2 Pi audit POST

`POST /api/voice/audit` body (`backend/src/schemas.ts` `voiceAuditBody`) gains:

```ts
tts_provider: z.enum(['kokoro_lan','openrouter','clip','none']).nullable().optional(),
tts_latency_ms: z.number().int().min(0).nullable().optional(),
```

---

## 7. Contracts

### 7.1 Sidecar HTTP endpoints

```
POST /tts
  Headers: X-Pi-Token: <token>, Content-Type: application/json
  Body:    { "text": "string (1..500)", "voice": "af_bella" (default) }
  Returns: 200 audio/wav (24kHz, s16, mono, 100ms lead silence, peak-normalized)
           400 if text empty/whitespace
           401 if token missing/wrong
           413 if text > 500 chars
           503 if model not loaded
  Header on success: X-Synth-Ms: <int>   (server-side synth wall-clock)

GET /catalog/noise/{key}
  Headers: X-Pi-Token: <token>
  Returns: 200 audio/wav for the pre-rendered catalog clip
           401 if token missing/wrong
           404 if key not in catalog

GET /catalog/joke/{joke_id}
  Headers: X-Pi-Token: <token>
  Returns: 200 audio/wav for the pre-rendered joke (setup + pause + punchline as one file)
           401 if token missing/wrong
           404 if joke_id not in catalog

GET /healthz
  No auth.
  Returns: 200 {"ok": true, "model_loaded": true, "warm": true} when ready
           503 otherwise
```

### 7.2 Pi-side speak() dispatch (pseudocode)

```python
def speak(text):
    if not text.strip():
        return  # existing empty-text guard

    # 1. Local sidecar (preferred)
    if lan_tts_health_cached():
        audio = try_lan_tts(text, timeout=3s)
        if audio:
            play(audio, format='wav')
            audit(tts_provider='kokoro_lan', tts_latency_ms=...)
            return

    # 2. Cloud fallback (existing retry path from f9b6790), capped per day
    if cloud_tts_under_cap():
        audio = try_cloud_tts(text)
        if audio:
            play(audio, format='mp3')
            audit(tts_provider='openrouter', tts_latency_ms=...)
            return

    # 3. Audible clip fallback (existing didnt_catch.mp3)
    play_file(CLIP_DIDNT_CATCH)
    audit(tts_provider='clip')
    log.warning("TTS produced no audio — fell to didnt_catch for: %r", text[:120])
```

For `noise_play` and `joke_tell` matcher hits: a sibling `play_catalog(kind, key)` runs first. On 404 / sidecar-down it falls through to the existing matcher behaviour (no spoken text + a brief log).

### 7.3 Health cache pattern

Mirror the existing `is_muted_locally` cache in `main.py`. The `/tts` call itself acts as the probe — no separate `/healthz` round-trip on the happy path.

```
- _sidecar_state = {"reachable": True, "checked_at": 0.0}
- TTL: 30s
- Steady state (cache fresh): hit /tts directly with 3s timeout.
- On /tts success: reachable=True, checked_at=now.
- On /tts failure (ConnectionError | Timeout | 5xx): reachable=False, checked_at=now.
- Cache miss (now - checked_at > TTL): treat as reachable=True for that one attempt;
  the /tts result updates the cache.
- When reachable=False and cache fresh: skip /tts, go straight to cloud (no 3s wait).
```

Net effect: a single failure costs one 3 s timeout; subsequent utterances within 30 s skip the LAN attempt entirely. Once the 30 s expires we try again, and a successful sidecar restart resumes the local path automatically.

---

## 8. Frontend — VoiceChip ambient dot

A 6 px circle absolutely positioned at the top-right of the existing chip. No text, no animation in steady states.

| State | Colour token | When |
|---|---|---|
| Green | `var(--c-ok)` | `mic_online` AND `last_tts_provider in (kokoro_lan, openrouter)` |
| Amber | `var(--c-warn)` | `mic_online` AND `last_tts_provider in (clip, none)` (degraded TTS, calendar fine) |
| Grey | `var(--c-muted)` | `!mic_online` OR `muted` |

Visible only on the wall (kiosk mode). Phone editor sees the existing chip without the dot — too small to surface there.

Tests pin: dot present at the right colour for each `last_tts_provider` value; component re-renders when `/api/voice/status` poll returns a new provider.

---

## 9. Failure modes (folded in from the SRE review)

| Failure | Behaviour |
|---|---|
| Sidecar cold start mid-utterance | Pi retry once after 500 ms; on second fail, jump to cloud. Total mic-closed budget: 4 s. |
| Sidecar OOM | `mem_limit: 1500m` kills only the sidecar. `restart: unless-stopped` brings it back. Pi's health cache flips to "down" on first failure; next utterance jumps to cloud. |
| Server reboot — Pi sends before sidecar ready | First call returns ConnectionRefused → instant cloud fallback → 30 s later, sidecar healthy + cache refreshes. |
| Model file corruption | Health check fails at boot (warm-up synth raises). Container restart loops with a clear error in `docker logs`. Pi never sees it as healthy. |
| Catalog endpoint returns 404 | `noise_play` / `joke_tell` falls through to current behaviour (matcher hit + no audio + brief log). Catalog drift logged loudly so we can rebuild the image. |
| Cloud fallback also fails | `didnt_catch.mp3` clip plays. Audit row tagged `tts_provider=clip` + `error=tts_all_failed`. |
| All audio paths fail (incl. clip) | WARNING log + audit `tts_provider=none`. Wall already shows ✓ for `applied` intents so visual feedback survives. |
| Sidecar update / image swap | `docker compose up -d kokoro-tts` recreates only that service (~3 s gap). Pi's cache + cloud fallback covers the gap invisibly. |
| Sidecar broken for hours/days | Ladder falls through to cloud per utterance until `daily_request_cap` is hit, then jumps straight to the `didnt_catch.mp3` clip + WARNING. Audit log shows the `kokoro_lan → openrouter` drift; a daily cron over `voice_utterances` could alert on sustained drift (out of scope for v1). |
| Audio length > expected (long ask_question answer) | Sidecar takes proportionally longer. Pi timeout is 3 s for typical replies; long answers up the timeout to 8 s (still under cloud's worst case). |

---

## 10. Feasibility test results (2026-06-08)

Bench on dev server (i5-7400, 16 GB), three sentences ranging 2.0–4.2 s of audio:

| Variant | Load | RSS | Synth (2 s reply) | RT factor |
|---|---|---|---|---|
| int8 (88 MB) | 0.8 s | 220 MiB | 4.7 s | 2.3× |
| **fp16 (170 MB)** | **1.1 s** | **354 MiB** | **1.2 s** | **0.6×** |
| fp32 (311 MB) | 0.8 s | 475 MiB | 1.5 s | 0.7× |

**Selected: fp16.** Best RT factor; RSS comfortably under the 1.5 GB cap.

Pi bench for comparison (Cortex-A76, 2 GB):

| Variant | RSS | Synth (2 s reply) | RT factor |
|---|---|---|---|
| int8 | 219 MiB | 10.8 s | 5.5× |
| fp16 | 361 MiB | 5.6 s | 2.8× |
| fp32 | 487 MiB | 7.8 s | 3.9× |

Conclusively rules out Pi-side hosting.

Cloud baseline (from today's journal): 1–3 s typical, 5 s+ spikes, occasional `Read timed out` requiring the new retry path.

---

## 11. Testing strategy

**Sidecar (Python, pytest):**
- `/healthz` returns 503 before model load, 200 after warm-up.
- `/tts` happy path: text in → WAV bytes out, correct sample rate (24 kHz), correct format (s16 mono), leading silence ≥ 100 ms, peak within 0.5 dB of −3 dBFS.
- `/tts` 400 on empty text, 413 on > 500 chars, 401 on missing/wrong token.
- `/catalog/noise/{key}` — all 12 keys return WAV; unknown key → 404.
- `/catalog/joke/{id}` — at least one known joke ID returns WAV; unknown → 404.
- `render_catalogs.py` — given a fixture catalog with 2 noises + 2 jokes, produces 4 valid WAV files in the right paths.

**Pi (existing pytest suite under `kiosk/voice/`):**
- `_synthesize_lan` happy path: mocks `requests.post`, returns audio bytes, plays via `_detect_player`.
- `_synthesize_lan` timeout → falls to cloud (existing path covered).
- `_fetch_catalog` 404 → falls through to current behaviour (no exception).
- Health cache: probe called once on cold start; not called on subsequent utterances within 30 s; re-probed after a failure.
- `speak()` records `tts_provider` + `tts_latency_ms` in the audit POST (mock backend, verify payload).
- `_detect_player` prefers `ffplay` over `mpg123` when both present.

**Backend (existing node:test suite):**
- Migration v7 applies cleanly + is idempotent.
- `voiceAuditBody` accepts new optional fields; rejects unknown `tts_provider` values.
- Repo `insertUtterance` round-trips `tts_provider` + `tts_latency_ms`.

**Frontend (existing vitest suite):**
- VoiceChip renders dot at expected colour for each `last_tts_provider` × `mic_online` × `muted` combination.
- Dot updates when `/api/voice/status` poll returns a new provider.

**End-to-end (manual on Pi after deploy):**
1. With `TTS_BACKEND=lan`, say "Hey Mycroft, what's for dinner tonight" — expect spoken reply in < 1.5 s, audit row tagged `kokoro_lan`.
2. Stop the sidecar (`docker compose stop kokoro-tts`) and repeat — expect spoken reply via cloud fallback, audit tagged `openrouter`, slight added latency.
3. Stop the sidecar AND simulate cloud down (block egress to openrouter.ai temporarily) — expect `didnt_catch.mp3` plays, audit tagged `clip`.
4. Restart sidecar, say "Hey Mycroft, do a chicken noise" — expect instant catalog hit (~100 ms), audit tagged `kokoro_lan`.
5. "Hey Mycroft, tell me a joke" — expect single-file playback of setup + pause + punchline.
6. Wall: dot is green throughout normal operation; amber after step 3; back to green after sidecar recovers.

---

## 12. Deployment

### 12.1 Image build

```bash
# Pulled by a make target or build-script (not committed):
#   kokoro-tts/models/kokoro-v1.0.fp16.onnx
#   kokoro-tts/models/voices-v1.0.bin
make -C kokoro-tts pull-models    # idempotent download from GH release
docker compose build kokoro-tts   # bakes models + runs render_catalogs.py
docker compose up -d kokoro-tts   # ~5s container start, +1.1s model load + ~1s warm synth
```

### 12.2 docker-compose addition

```yaml
services:
  kokoro-tts:
    build: ./kokoro-tts
    platform: linux/amd64
    restart: unless-stopped
    mem_limit: 1500m
    ports:
      - "8789:8789"   # bind LAN-only via PI_LAN env if we ever multi-home
    environment:
      - PI_API_TOKEN=${PI_API_TOKEN}   # shared with the homecal service
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:8789/healthz || exit 1"]
      interval: 30s
      timeout: 2s
      start_period: 10s
      retries: 3
```

### 12.3 Pi-side env

`/etc/homecal-voice.env` additions:
```
TTS_BACKEND=cloud           # initial value at deploy; flip to "lan" after validation
TTS_SERVER_URL=http://192.168.1.94:8789
TTS_SERVER_TIMEOUT_S=3
# TTS_MODEL / TTS_VOICE retained for the cloud fallback path
```

Roll-out: deploy the sidecar + Pi code with `TTS_BACKEND=cloud` so the existing cloud path keeps running unchanged. Run manual validation (§11 step 1) against the sidecar from a one-off Pi shell. Once green, edit `/etc/homecal-voice.env` to `TTS_BACKEND=lan` and `systemctl restart homecal-voice`.

### 12.4 Rollback

- Sidecar misbehaves → `TTS_BACKEND=cloud` on the Pi, `systemctl restart homecal-voice`. Cloud path is unchanged.
- Image regression → `docker compose pull kokoro-tts:<previous-tag> && docker compose up -d kokoro-tts`.
- Migration v7 needs rollback (unlikely) → manual `DROP COLUMN` is fine since both new columns are nullable.

---

## 13. Open questions

None blocking. Two acknowledged deferrals:

1. **Streaming for long replies (jokes, ask_question)** — revisit after 50 clean wait-then-play replies. UX review wanted this for jokes specifically; bench it then decide.
2. **"One sec" stall clip** — pre-rendered ~0.5 s clip to play when the LAN→cloud fallback fires, so the kid hears "Mycroft is thinking" instead of dead air. Small follow-up PR; not in v1 to keep scope tight.
