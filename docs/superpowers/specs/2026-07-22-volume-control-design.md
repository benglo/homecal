# Volume control — design spec

**Date:** 2026-07-22
**Status:** approved (design), pending implementation
**Related:** mirrors the voice **mute** feature (`voice_settings`, `PUT /api/voice/mute`,
`broker.poke('voice')`, `MuteToggle.tsx`, Pi `poke_handlers.py`).

## Problem

USB speakers are now plugged into the Pi. There is no way to set the output level from the wall.
We need a master volume control reachable from the **wall touchscreen**, the **phone**, and by
**voice** ("Luna, turn it up / set volume to 70%").

## Constraints & context

- The homecal backend runs in Docker on the **server** (192.168.1.94). The speakers are on the
  **Pi** (192.168.1.135). Volume must therefore be **applied Pi-side**; the server only holds state.
- Both the Pi TTS (`paplay`/`pw-play`) and the browser chore chime play into the Pi's **default
  PipeWire sink**. Controlling that sink's volume is a genuine **master** control for all sound.
- The applier lives in the `homecal-voice` service. If that service is not running, volume changes
  persist server-side but are not applied on the Pi until it next starts. Accepted for v1.

## Goals

- Single source of truth (server DB) for `volume` (0–100) and `audio_muted` (bool), driven
  identically from wall, phone, and voice.
- Master-audio **mute** distinct from the existing **voice-listening mute** (`mute_until`).
- Persist across reboots; re-applied on Pi service startup.

## Non-goals (v1)

- Per-stream volume (TTS-only vs chime-only). Master sink only.
- Muting the speakers **by voice** — the `audio_muted` toggle is UI-only in v1 (voice does levels).
  Voice audio-mute is a future add.
- Any volume control when the voice service is not installed/running.

## Data model

Migration **v4** (append-only, forward-only) on the `voice_settings` singleton:

```sql
ALTER TABLE voice_settings ADD COLUMN volume       INTEGER NOT NULL DEFAULT 60;  -- 0..100
ALTER TABLE voice_settings ADD COLUMN audio_muted  INTEGER NOT NULL DEFAULT 0;   -- 0/1
```

`voiceSettings` repo gains `getVolume()`, `setVolume(n)` (clamps 0..100), `getAudioMuted()`,
`setAudioMuted(b)`. `audio_muted` is a **separate flag from `mute_until`** (voice-listening mute);
the two never interact.

## API (mirrors `PUT /api/voice/mute`)

- `PUT /api/voice/volume` — body `{ level: number }` (zod: int 0..100, clamped). Sets `volume`,
  then `broker.poke('voice', { kind: 'volume_changed', volume, audio_muted })`. Returns
  `{ ok: true, volume }`.
- `PUT /api/voice/audio-mute` — body `{ muted: boolean }`. Sets `audio_muted`, same poke shape,
  returns `{ ok: true, audio_muted }`.
- `GET /api/voice/status` — gains `volume` and `audio_muted` fields alongside the existing mute
  fields, so every surface reads one value.

Validation via new zod schemas `voiceVolumeBody`, `voiceAudioMuteBody` in the request-schemas module.

## Realtime

Reuses the existing `'voice'` poke channel. The `volume_changed` poke carries both `volume` and
`audio_muted`. The frontend `useRealtime` handler invalidates the voice-status query (as it already
does for `mute_changed`), so wall + phone refetch and re-render.

## Pi applier (`homecal-voice`)

- `poke_handlers.classify_poke` learns a new action: a `voice` poke whose payload
  `kind == "volume_changed"` returns `"volume"` (existing `"listen"`/`"mute"` unchanged).
- On a `"volume"` action **and once on service startup**, the service fetches `/api/voice/status`
  and applies:
  ```
  wpctl set-volume @DEFAULT_AUDIO_SINK@ <volume/100>   # value clamped to ≤ 1.0
  wpctl set-mute   @DEFAULT_AUDIO_SINK@ <1 if audio_muted else 0>
  ```
- Missing `wpctl` or no default sink → log a warning and no-op (consistent with the service's
  graceful-degradation style). No crash.
- Applier is a small pure-ish function `apply_audio(volume:int, muted:bool)` shelling out to `wpctl`,
  so the command construction is unit-testable without a live PipeWire.

## Voice intent — `volume_set`

- Added to the intent valid-set and the Haiku prompt schema.
- Slots: `mode` ∈ {`set`, `up`, `down`}; `value` — target % for `set` (0..100), or step for
  `up`/`down` (default 10 when unspecified).
- Executor: for `up`/`down`, reads current `volume` from `/api/voice/status`, computes
  `clamp(current ± step, 0, 100)`; for `set`, uses `value`. Calls `PUT /api/voice/volume`.
- TTS confirmation: *"Okay — volume 70 percent."* Mid-confidence handling follows the existing
  intent-confirmation pattern.

## UI — `VolumeControl` (speaker icon → popover)

- New component in `frontend/src/components/controls/`. A speaker button in the wall **ControlBar**
  and the phone **Manage** tab (placed like `MuteToggle`).
- Tap opens a popover containing: a **slider** (0–100) and a **mute** button (toggles `audio_muted`).
  Labelled so it reads as "speaker/audio mute", distinct from the voice-listening mute.
- Speaker glyph reflects state: muted → muted icon; else low/high by level.
- State via TanStack Query; slider updates optimistically. The `PUT /api/voice/volume` is **throttled
  while dragging** and fired on release to avoid flooding. SSE `volume_changed` invalidates the query.

## Data flow

```
wall slider ─┐
phone slider ─┼─→ PUT /api/voice/volume ─→ voice_settings.volume ─→ poke('voice', volume_changed)
Luna voice ──┘                                                             │
                                          ┌────────────────────────────────┴───┐
                                    Pi: wpctl set-volume/set-mute      wall/phone: refetch /status
```

## Testing

- **Backend:** migration v4 applies and back-fills defaults; repo clamp behaviour; `PUT` endpoints
  validate + poke; `GET /status` includes new fields. (node:test + tsx.)
- **Pi:** `classify_poke` returns `"volume"` for `volume_changed`; `apply_audio` builds the correct
  `wpctl` argv for representative levels + mute states; graceful no-op when `wpctl` absent.
- **Voice intent:** `volume_set` parsing (set/up/down, default step, clamping); executor computes the
  right target and calls the endpoint. (pytest.)
- **Frontend:** `VolumeControl` renders level/mute glyph states; slider release fires the mutation;
  mute toggle hits the audio-mute endpoint. (Vitest.)

## Rollout

Server (migration auto-runs on boot) → deploy updated `homecal-voice` to the Pi
(`kiosk/voice-install.sh`) → verify: move the wall slider and hear the level change; "Luna, set
volume to 30 percent"; toggle audio-mute.
