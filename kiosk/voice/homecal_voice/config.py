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
    whisper_model: str
    whisper_server_url: str
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
        wake_threshold=float(os.environ.get("WAKE_THRESHOLD", "0.5")),
        whisper_model=os.environ.get("WHISPER_MODEL", "base.en-q5_1"),
        whisper_server_url=os.environ.get("WHISPER_SERVER_URL", "http://127.0.0.1:8080/inference"),
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
