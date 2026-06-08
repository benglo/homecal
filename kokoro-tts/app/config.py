"""Env-driven configuration. All required values must be set; missing
required vars raise loudly at startup so a misconfigured container can't
boot and silently serve wrong-voice synth."""
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    pi_api_token: str
    model_path: str
    voices_path: str
    catalog_dir: str
    default_voice: str = "af_bella"
    max_text_chars: int = 500
    listen_host: str = "0.0.0.0"
    listen_port: int = 8789


def _require(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        raise RuntimeError(f"required env var {name} is not set")
    return v


def from_env() -> Config:
    return Config(
        pi_api_token=_require("PI_API_TOKEN"),
        model_path=_require("KOKORO_MODEL_PATH"),
        voices_path=_require("KOKORO_VOICES_PATH"),
        catalog_dir=_require("KOKORO_CATALOG_DIR"),
        listen_host=os.environ.get("KOKORO_LISTEN_HOST", "0.0.0.0"),
        listen_port=int(os.environ.get("KOKORO_LISTEN_PORT", "8789")),
    )
