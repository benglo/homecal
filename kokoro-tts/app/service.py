"""FastAPI app for the kokoro-tts sidecar.

State (module-level `state`) holds the loaded Synth. The lifespan handler
loads + warms the model at startup, sets state.ready=True, and tears down
on shutdown. Tests can substitute state.synth with a mock without doing
the lifespan dance."""
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Optional

from fastapi import FastAPI, Response

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
