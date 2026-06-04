# homecal-voice

Pi-side voice command service for homecal. Runs as a systemd unit on the Raspberry Pi 5 kiosk.

## Stack
- openWakeWord (wake word detection, `hey_mycroft`)
- silero-vad (ONNX, endpointing)
- whisper.cpp `whisper-server` (local STT, base.en-q5_1)
- OpenRouter (Haiku 4.5 for intent extraction, Gemini 3.1 Flash TTS Preview for speech)

## Deploy
See `kiosk/voice-install.sh` for the one-shot install script.

## Spec
`docs/superpowers/specs/2026-06-04-voice-commands-design.md`
