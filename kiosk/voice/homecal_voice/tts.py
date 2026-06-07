import logging
import os
import shutil
import subprocess
import tempfile
import time
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
    timeout_s: int = 10,
    max_attempts: int = 2,
    backoff_s: float = 0.5,
) -> bytes:
    """POST to /audio/speech with bounded retry.

    Retries on network-class errors (read/connect timeouts, dropped sockets)
    and 5xx — those are transient and the journal shows OpenRouter's speech
    endpoint hiccups regularly. Does NOT retry on 4xx, which are semantic
    (bad model name, empty input, malformed voice) and won't fix themselves.

    Worst case wall-clock = max_attempts * timeout_s + (max_attempts-1) * backoff_s.
    Default 10s × 2 + 0.5s = 20.5s; the per-attempt cap matters more than the
    total because the mic is closed for this whole window — too long and the
    kid loses faith that anything is happening.
    """
    # `voice` is required per OpenRouter's SpeechRequest schema, and
    # `response_format` is provider-specific (Gemini=pcm only, Kokoro=mp3, …).
    # Sending "default" / omitting either returned an opaque 500 in production.
    payload = {
        "model": model,
        "input": text,
        "voice": voice,
        "response_format": response_format,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    for attempt in range(1, max_attempts + 1):
        is_last = attempt == max_attempts
        try:
            r = requests.post(
                "https://openrouter.ai/api/v1/audio/speech",
                headers=headers,
                json=payload,
                timeout=timeout_s,
            )
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            log.warning("TTS attempt %d/%d transport error: %s", attempt, max_attempts, e)
            if is_last:
                raise
            time.sleep(backoff_s)
            continue

        # 4xx → semantic; bail without retrying.
        if 400 <= r.status_code < 500:
            r.raise_for_status()

        # 5xx → transient; retry within budget.
        if r.status_code >= 500:
            log.warning("TTS attempt %d/%d server %d", attempt, max_attempts, r.status_code)
            if is_last:
                r.raise_for_status()
            time.sleep(backoff_s)
            continue

        return r.content

    # Unreachable — every loop iteration either returns or raises (the is_last
    # branches re-raise; intermediate failures `continue`).
    raise RuntimeError("synthesize: exhausted attempts without returning or raising")


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


def speak(text: str, *, model: str, voice: str, api_key: str, muted: bool = False) -> bool:
    """Synthesize `text` and play it. Returns True if the user actually heard
    audio, False if anything (mute, synth error, no player) prevented playback.

    Callers MUST act on a False return — silent TTS failure in the wild looks
    indistinguishable from "wake word stopped working" because the user gets
    no audible confirmation. See main._speak for the failure-handling path.
    """
    if muted:
        log.info("muted; skipping TTS: %r", text)
        return False
    try:
        audio = synthesize(text, model=model, voice=voice, api_key=api_key)
    except Exception as e:
        log.warning("TTS failed: %s", e)
        return False

    player = _detect_player()
    if player is None:
        log.warning("no MP3 player available (install mpg123); skipping playback")
        return False

    # `delete=False` so the playback subprocess can open the file after we've
    # closed our handle; explicit os.unlink in finally guarantees no /tmp leak.
    path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
            f.write(audio)
            path = f.name
        subprocess.run([*player, path], check=False)
        return True
    finally:
        if path is not None:
            try:
                os.unlink(path)
            except OSError as e:
                log.debug("could not unlink TTS tempfile %s: %s", path, e)
