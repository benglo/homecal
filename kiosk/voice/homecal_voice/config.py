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
    vad_gain: float
    energy_rms_threshold: float
    tts_model: str
    tts_voice: str
    daily_request_cap: int
    audio_device: str
    tts_backend: str
    tts_server_url: str
    tts_server_timeout_s: int

def _require(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        raise ConfigError(f"required env var missing: {name}")
    return v

def load_config() -> Config:
    if ENV_FILE.exists():
        load_dotenv(ENV_FILE, override=False)
    backend = os.environ.get("TTS_BACKEND", "cloud").lower()
    if backend not in ("lan", "cloud"):
        raise ValueError(f"TTS_BACKEND must be 'lan' or 'cloud', got {backend!r}")
    return Config(
        openrouter_api_key=_require("OPENROUTER_API_KEY"),
        homecal_api_base=_require("HOMECAL_API_BASE"),
        pi_api_token=_require("PI_API_TOKEN"),
        wake_word=os.environ.get("WAKE_WORD", "hey_luna"),
        # Higher than the openWakeWord default — ambient noise + BT idle hiss
        # produced ~6 false wakes/minute at 0.5. Real wakes score 0.97+ on
        # this mic so 0.7 leaves plenty of headroom.
        wake_threshold=float(os.environ.get("WAKE_THRESHOLD", "0.7")),
        wake_trigger_level=int(os.environ.get("WAKE_TRIGGER_LEVEL", "2")),
        whisper_model=os.environ.get("WHISPER_MODEL", "small.en-q5_1"),
        whisper_server_url=os.environ.get("WHISPER_SERVER_URL", "http://127.0.0.1:8080/inference"),
        # gemini-3-flash-preview was the only model in the head-to-head that
        # reliably transcribed low-gain PCM2902 captures — gpt-audio-mini,
        # voxtral, and gemini-2.5 all hallucinated refusals on the same WAV.
        # Local whisper.cpp stays as the offline fallback (transcribe_with_fallback).
        stt_model=os.environ.get("STT_MODEL", "google/gemini-3-flash-preview"),
        intent_model=os.environ.get("INTENT_MODEL", "anthropic/claude-haiku-4.5"),
        # Mic-specific endpointer tuning. Defaults are for the PCM2902 USB
        # mic; replacing the mic should override these via env. Energy
        # threshold must sit above the boosted background-noise floor;
        # setting it too low makes every frame read as speech and the
        # endpointer never closes before the hard cap.
        vad_gain=float(os.environ.get("VAD_GAIN", "5.0")),
        energy_rms_threshold=float(os.environ.get("ENERGY_RMS_THRESHOLD", "5500.0")),
        # Kokoro 82M: cheaper than Gemini TTS Preview, returns MP3 natively (no
        # PCM decode), and was the documented swap-to fallback in the spec.
        # Gemini TTS Preview is restricted to response_format=pcm, which would
        # force a PCM player in the pipeline; not worth it for the savings.
        tts_model=os.environ.get("TTS_MODEL", "hexgrad/kokoro-82m"),
        tts_voice=os.environ.get("TTS_VOICE", "af_bella"),
        daily_request_cap=int(os.environ.get("DAILY_REQUEST_CAP", "200")),
        audio_device=os.environ.get("AUDIO_DEVICE", "default"),
        tts_backend=backend,
        tts_server_url=os.environ.get("TTS_SERVER_URL", "http://192.168.1.94:8789").rstrip("/"),
        tts_server_timeout_s=int(os.environ.get("TTS_SERVER_TIMEOUT_S", "3")),
    )
