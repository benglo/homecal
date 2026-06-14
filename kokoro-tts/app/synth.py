"""Kokoro wrapper. Loads the ONNX model + voices once at construction
(~1.1s on i5-7400), then synth.synthesize() returns ready-to-stream WAV
bytes with lead silence + peak normalize applied.

Construction blocks until the model is loaded. The /healthz endpoint
should only return 200 after warmup() has run successfully — that's the
contract callers rely on to avoid sending traffic before the model is
warm in caches."""
import time
from typing import Tuple

from kokoro_onnx import Kokoro

from app.audio import to_wav_bytes, prepend_silence, peak_normalize


class Synth:
    def __init__(self, *, model_path: str, voices_path: str):
        self._k = Kokoro(model_path=model_path, voices_path=voices_path)

    def warmup(self) -> None:
        """Run one synth so ONNX runtime allocates its working memory.
        Without this the first real request is 2-3× slower."""
        self._k.create("warm", voice="af_bella", speed=1.0, lang="en-us")

    def synthesize(self, text: str, *, voice: str, speed: float = 1.0) -> Tuple[bytes, int]:
        """Synthesize text → (WAV bytes, server-side wall-clock ms)."""
        t0 = time.monotonic()
        samples, _sr = self._k.create(text, voice=voice, speed=speed, lang="en-us")
        normalized = peak_normalize(samples)
        with_silence = prepend_silence(normalized)
        wav = to_wav_bytes(with_silence)
        latency_ms = int((time.monotonic() - t0) * 1000)
        return wav, latency_ms
