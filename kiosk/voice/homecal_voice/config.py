import os
from dataclasses import dataclass
from pathlib import Path
from dotenv import load_dotenv

ENV_FILE = Path("/etc/homecal-voice.env")

class ConfigError(RuntimeError): pass

@dataclass(frozen=True)
class Config:
    openrouter_api_key: str
    homecal_api_base: str
    pi_api_token: str
    wake_word: str
    wake_threshold: float
    wake_trigger_level: int
    whisper_model: str
    whisper_server_url: str
    stt_model: str
    intent_model: str
    tts_model: str
    tts_voice: str
    daily_request_cap: int
    audio_device: str

def _require(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        raise ConfigError(f"required env var missing: {name}")
    return v

def load_config() -> Config:
    if ENV_FILE.exists():
        load_dotenv(ENV_FILE, override=False)
    return Config(
        openrouter_api_key=_require("OPENROUTER_API_KEY"),
        homecal_api_base=_require("HOMECAL_API_BASE"),
        pi_api_token=_require("PI_API_TOKEN"),
        wake_word=os.environ.get("WAKE_WORD", "hey_mycroft"),
        # 0.7 + trigger_level=2 was tuned live on 2026-06-05 after observing
        # ambient false positives at 0.5/1 (room background, BOOM 3 idle hiss)
        # producing six "(wind blowing)" Haiku calls per minute. Confirmed
        # real wakes score 0.97+ with the PCM2902 mic at 1m so 0.7 is safe.
        wake_threshold=float(os.environ.get("WAKE_THRESHOLD", "0.7")),
        wake_trigger_level=int(os.environ.get("WAKE_TRIGGER_LEVEL", "2")),
        whisper_model=os.environ.get("WHISPER_MODEL", "small.en-q5_1"),
        whisper_server_url=os.environ.get("WHISPER_SERVER_URL", "http://127.0.0.1:8080/inference"),
        # STT defaults to Google gemini-3-flash-preview (~2.2s on a 1.6s clip
        # vs ~13.6s for local whisper.cpp small.en-q5_1 on Pi 5).
        # Picked by direct head-to-head on a real PCM2902 mic capture
        # (2026-06-05): gpt-audio-mini, voxtral, gemini-2.5-flash-lite, and
        # gpt-audio all hallucinated ("Please upload the audio file...",
        # answered an Italian translation) on the same WAV that gemini-3
        # transcribed correctly. The mic captures cleanly, but the smaller
        # / older audio models can't make sense of low-gain input. Local
        # whisper-server stays as the offline fallback via transcribe_with_fallback.
        stt_model=os.environ.get("STT_MODEL", "google/gemini-3-flash-preview"),
        intent_model=os.environ.get("INTENT_MODEL", "anthropic/claude-haiku-4.5"),
        # Kokoro 82M: cheaper than Gemini TTS Preview, returns MP3 natively (no
        # PCM decode), and was the documented swap-to fallback in the spec.
        # Gemini TTS Preview is restricted to response_format=pcm, which would
        # force a PCM player in the pipeline; not worth it for the savings.
        tts_model=os.environ.get("TTS_MODEL", "hexgrad/kokoro-82m"),
        tts_voice=os.environ.get("TTS_VOICE", "af_bella"),
        daily_request_cap=int(os.environ.get("DAILY_REQUEST_CAP", "200")),
        audio_device=os.environ.get("AUDIO_DEVICE", "default"),
    )
