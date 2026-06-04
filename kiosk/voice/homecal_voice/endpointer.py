import logging
import numpy as np
from collections import deque
from typing import Callable, Optional
from homecal_voice.mic import FRAME_SAMPLES, FRAME_MS, SAMPLE_RATE

log = logging.getLogger("homecal_voice.endpointer")
VadFn = Callable[[np.ndarray, int], float]

class Endpointer:
    """Buffer speech until N ms of silence OR hard cap reached."""
    def __init__(self, vad: VadFn, *,
                 threshold: float = 0.5,
                 min_silence_ms: int = 700,
                 hard_cap_ms: int = 8000,
                 speech_pad_ms: int = 200):
        self._vad = vad
        self._threshold = threshold
        self._silence_frames_needed = max(1, min_silence_ms // FRAME_MS)
        self._cap_frames = max(1, hard_cap_ms // FRAME_MS)
        self._pad_frames = max(0, speech_pad_ms // FRAME_MS)
        self._buf: list[np.ndarray] = []
        self._silent_run = 0

    def feed(self, frame: np.ndarray) -> bool:
        self._buf.append(frame)
        prob = self._vad(frame, SAMPLE_RATE)
        if prob >= self._threshold:
            self._silent_run = 0
        else:
            self._silent_run += 1
        if self._silent_run >= self._silence_frames_needed:
            log.info("endpoint: silence")
            return True
        if len(self._buf) >= self._cap_frames:
            log.warning("endpoint: hard cap")
            return True
        return False

    def audio(self) -> np.ndarray:
        return np.concatenate(self._buf) if self._buf else np.zeros(0, dtype=np.int16)

def load_silero_vad() -> VadFn:
    """R15 — pure ONNX (no torch). Silero ships a tiny ONNX model in the package;
    we run it through onnxruntime directly so the install doesn't pull torch."""
    import onnxruntime as ort
    import importlib.resources as pkg_resources
    import silero_vad
    with pkg_resources.as_file(pkg_resources.files(silero_vad) / "data" / "silero_vad.onnx") as p:
        sess = ort.InferenceSession(str(p), providers=["CPUExecutionProvider"])
    state = np.zeros((2, 1, 128), dtype=np.float32)
    def vad(frame: np.ndarray, sr: int) -> float:
        nonlocal state
        x = (frame.astype(np.float32) / 32768.0).reshape(1, -1)
        out, state = sess.run(None, {"input": x, "state": state, "sr": np.array(sr, dtype=np.int64)})
        return float(out.squeeze())
    return vad
