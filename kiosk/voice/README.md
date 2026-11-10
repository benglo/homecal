# homecal-voice

Pi-side voice command service for homecal. Runs as the `homecal-voice` systemd unit on the
Raspberry Pi 5 kiosk, alongside a local `whisper-server` unit.

## Stack
- **Wake:** openWakeWord, custom-trained `hey_luna` (`homecal_voice/wake_models/hey_luna.onnx`).
  Tap-to-talk on the wall also triggers a listen (via SSE) and skips the wake word.
- **Endpointing:** silero-vad (ONNX) plus an energy gate tuned for the PCM2902 USB mic.
- **STT:** Gemini 3 Flash via OpenRouter, with local whisper.cpp (`whisper-server`, `small.en-q5_1`)
  as the offline fallback.
- **Intent:** Claude Haiku 4.5 via OpenRouter. Fast local pattern matchers (`patterns_v1`,
  `patterns_kid`, `patterns_timer`) run first, so kid intents still work when the backend is down.
- **TTS:** `TTS_BACKEND=cloud` (Kokoro-82M via OpenRouter) or `lan` (the `kokoro-tts` sidecar on
  the server, falling back to cloud on failure). Jokes and noises are pre-rendered catalog clips.
- **Audio:** PipeWire. Master volume/mute is applied with `wpctl` on server poke and at startup.

Intents: `dinner_set`, `query_dinner`, `chore_complete`, `query_agenda`, `event_add` (always
confirms), `volume_set`, timers, `joke_tell`, `noise_play`, `ask_question` (tiered safety prompt).

## Install

```bash
bash kiosk/voice-install.sh     # from the repo root, on the Pi
sudo nano /etc/homecal-voice.env
sudo systemctl start homecal-voice
journalctl -u homecal-voice -f
```

## Configuration (`/etc/homecal-voice.env`)

**Required:**

| Key | Meaning |
|-----|---------|
| `OPENROUTER_API_KEY` | OpenRouter key (STT, intent, cloud TTS) |
| `HOMECAL_API_BASE` | server URL, e.g. `http://<server-ip>:8787` |
| `PI_API_TOKEN` | must match the server's `PI_API_TOKEN` |

**Optional** (defaults from `homecal_voice/config.py`):

| Key | Default | Meaning |
|-----|---------|---------|
| `WAKE_WORD` | `hey_luna` | openWakeWord model name |
| `WAKE_THRESHOLD` | `0.7` | wake score threshold (raise if false wakes) |
| `WAKE_TRIGGER_LEVEL` | `2` | frames above threshold needed to fire a wake |
| `STT_MODEL` | `google/gemini-3-flash-preview` | cloud STT model |
| `WHISPER_MODEL` | `small.en-q5_1` | local whisper.cpp model |
| `WHISPER_SERVER_URL` | `http://127.0.0.1:8080/inference` | local whisper-server |
| `INTENT_MODEL` | `anthropic/claude-haiku-4.5` | intent extraction model |
| `VAD_GAIN` | `5.0` | mic gain before VAD (mic-specific) |
| `ENERGY_RMS_THRESHOLD` | `5500.0` | must sit above the boosted noise floor |
| `TTS_BACKEND` | `cloud` | `cloud` or `lan` |
| `TTS_MODEL` / `TTS_VOICE` | `hexgrad/kokoro-82m` / `af_bella` | cloud TTS |
| `TTS_SERVER_URL` | `http://192.168.1.94:8789` | kokoro-tts sidecar (`lan` backend) |
| `TTS_SERVER_TIMEOUT_S` | `10` | sidecar timeout before falling back to cloud |
| `DAILY_REQUEST_CAP` | `200` | max voice requests per day (cost guard) |
| `AUDIO_DEVICE` | `default` | capture device |
| `HOMECAL_AUDIO_SINK` | `@DEFAULT_AUDIO_SINK@` | PipeWire sink for volume (pin with a `wpctl status` ID) |

## Tests

```bash
cd kiosk/voice
python3 -m venv .venv && . .venv/bin/activate
pip install -e '.[dev]'
pytest
```

## Specs
- `docs/superpowers/specs/2026-06-04-voice-commands-design.md` (v1)
- `docs/superpowers/specs/2026-06-06-kid-intents-design.md`
- `docs/superpowers/specs/2026-06-08-local-tts-sidecar-design.md`
- `docs/superpowers/specs/2026-06-11-ui-slot-create-voice-desktop-design.md`
- `docs/superpowers/specs/2026-07-22-volume-control-design.md`
