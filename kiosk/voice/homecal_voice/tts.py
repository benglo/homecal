import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import requests

log = logging.getLogger("homecal_voice.tts")

# Pre-rendered fallback clip for when STT failed (silent/hallucinated audio,
# unknown intent). Pre-recorded rather than synthesised on demand because the
# fallback fires precisely when the cloud path is misbehaving — using TTS to
# say "I didn't catch that" risks the same network glitch the original STT
# call hit. Bundled with the package via pyproject `package-data`.
CLIPS_DIR = Path(__file__).parent / "clips"
CLIP_DIDNT_CATCH = CLIPS_DIR / "didnt_catch.mp3"


def synthesize(
    text: str,
    *,
    model: str,
    voice: str,
    api_key: str,
    response_format: str = "mp3",
    timeout_s: int = 15,
) -> bytes:
    # `voice` is required per OpenRouter's SpeechRequest schema, and
    # `response_format` is provider-specific (Gemini=pcm only, Kokoro=mp3, …).
    # Sending "default" / omitting either returned an opaque 500 in production.
    r = requests.post(
        "https://openrouter.ai/api/v1/audio/speech",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": model,
            "input": text,
            "voice": voice,
            "response_format": response_format,
        },
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


def play_file(path: str | os.PathLike) -> None:
    """Play a pre-rendered audio file through whichever CLI player is available.
    No-op (with a warning) if no player is installed or the file is missing —
    callers MUST tolerate that, since this is itself a fallback path."""
    p = Path(path)
    if not p.is_file():
        log.warning("audio clip missing: %s", p)
        return
    player = _detect_player()
    if player is None:
        log.warning("no MP3 player available (install mpg123); cannot play %s", p)
        return
    subprocess.run([*player, str(p)], check=False)


def speak(text: str, *, model: str, voice: str, api_key: str, muted: bool = False) -> None:
    if muted:
        log.info("muted; skipping TTS: %r", text)
        return
    try:
        audio = synthesize(text, model=model, voice=voice, api_key=api_key)
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
