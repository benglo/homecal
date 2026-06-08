"""FastAPI app for the kokoro-tts sidecar.

State (module-level `state`) holds the loaded Synth. The lifespan handler
loads + warms the model at startup, sets state.ready=True, and tears down
on shutdown. Tests can substitute state.synth with a mock without doing
the lifespan dance."""
import re
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Response, status
from pydantic import BaseModel, Field

from app.auth import require_pi_token
from app.config import from_env
from app.synth import Synth


@dataclass
class State:
    synth: Optional[Synth] = None
    ready: bool = False


state = State()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    cfg = from_env()
    state.synth = Synth(model_path=cfg.model_path, voices_path=cfg.voices_path)
    state.synth.warmup()
    state.ready = True
    try:
        yield
    finally:
        state.ready = False
        state.synth = None


app = FastAPI(lifespan=lifespan)


@app.get("/healthz")
def healthz():
    if not state.ready or state.synth is None:
        return Response(status_code=503)
    return {"ok": True, "model_loaded": True, "warm": True}


class TtsRequest(BaseModel):
    text: str = Field(..., min_length=0)
    voice: str | None = None


@app.post("/tts")
def tts(req: TtsRequest, _=Depends(require_pi_token)):
    if state.synth is None or not state.ready:
        return Response(status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
    text = req.text or ""
    if not text.strip():
        raise HTTPException(status_code=400, detail="text must be non-empty")
    cfg = from_env()
    if len(text) > cfg.max_text_chars:
        raise HTTPException(status_code=413, detail=f"text exceeds {cfg.max_text_chars} chars")
    voice = req.voice or cfg.default_voice
    wav, latency_ms = state.synth.synthesize(text, voice=voice)
    return Response(
        content=wav,
        media_type="audio/wav",
        headers={"X-Synth-Ms": str(latency_ms)},
    )


_SAFE_KEY = re.compile(r"^[a-z0-9_-]{1,64}$")


def _read_catalog_clip(kind: str, key: str) -> bytes:
    """Read a pre-rendered WAV from the catalog dir. Key must match a
    strict charset — rejecting anything else closes off path-traversal
    cleanly (no `..`, no `/`, no urlencoded sneakiness)."""
    if not _SAFE_KEY.match(key):
        raise HTTPException(status_code=400, detail="invalid key")
    cfg = from_env()
    path = Path(cfg.catalog_dir) / kind / f"{key}.wav"
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"{kind}:{key} not found")
    return path.read_bytes()


@app.get("/catalog/noise/{key}")
def catalog_noise(key: str, _=Depends(require_pi_token)):
    return Response(content=_read_catalog_clip("noise", key), media_type="audio/wav")


@app.get("/catalog/joke/{joke_id}")
def catalog_joke(joke_id: str, _=Depends(require_pi_token)):
    return Response(content=_read_catalog_clip("joke", joke_id), media_type="audio/wav")
