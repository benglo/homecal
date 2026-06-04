import logging
import os
import shutil
import subprocess
import tempfile

import requests

log = logging.getLogger("homecal_voice.tts")


def synthesize(text: str, *, model: str, api_key: str, timeout_s: int = 15) -> bytes:
    r = requests.post(
        "https://openrouter.ai/api/v1/audio/speech",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={"model": model, "input": text, "voice": "default"},
        timeout=timeout_s,
    )
    r.raise_for_status()
    return r.content


def _detect_player() -> list[str] | None:
    """Pick the first available CLI MP3 player. Order chosen so PipeWire's
    native client (`pw-play`) wins when present — it speaks PCM/Opus/MP3 via
    libsndfile/ffmpeg and shares the same audio graph the rest of the kiosk
    uses. Falls back to mpg123, then ffplay. `aplay` is intentionally NOT in
    the list — it's WAV/PCM only and silently fails on MP3."""
    candidates: tuple[tuple[str, list[str]], ...] = (
        ("mpg123", ["mpg123", "-q"]),
        ("ffplay", ["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet"]),
        ("pw-play", ["pw-play"]),
        ("paplay", ["paplay"]),
    )
    for binary, cmd in candidates:
        if shutil.which(binary):
            return cmd
    return None


def speak(text: str, *, model: str, api_key: str, muted: bool = False) -> None:
    if muted:
        log.info("muted; skipping TTS: %r", text)
        return
    try:
        audio = synthesize(text, model=model, api_key=api_key)
    except Exception as e:
        log.warning("TTS failed: %s", e)
        return

    player = _detect_player()
    if player is None:
        log.warning("no MP3 player available (install mpg123); skipping playback")
        return

    # `delete=False` so the playback subprocess can open the file after we've
    # closed our handle; explicit os.unlink in finally guarantees no /tmp leak.
    path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
            f.write(audio)
            path = f.name
        subprocess.run([*player, path], check=False)
    finally:
        if path is not None:
            try:
                os.unlink(path)
            except OSError as e:
                log.debug("could not unlink TTS tempfile %s: %s", path, e)
