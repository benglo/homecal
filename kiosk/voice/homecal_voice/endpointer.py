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

def load_silero_vad(onnx_path: str | None = None) -> VadFn:
    """Pure ONNX (no torch). The silero-vad pypi package's __init__ imports torch
    transitively, so we vendor `silero_vad.onnx` (downloaded by the install
    script) and load it with onnxruntime directly. Path resolution order:
      1. explicit `onnx_path` argument
      2. SILERO_VAD_ONNX env var
      3. ./silero_vad.onnx beside the running script
      4. ~/homecal-voice/silero_vad.onnx (install default)
    """
    import os
    import onnxruntime as ort

    if onnx_path is None:
        candidates = [
            os.environ.get("SILERO_VAD_ONNX"),
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "silero_vad.onnx"),
            os.path.expanduser("~/homecal-voice/silero_vad.onnx"),
        ]
        for c in candidates:
            if c and os.path.isfile(c):
                onnx_path = c
                break
        if onnx_path is None:
            raise RuntimeError(
                "silero_vad.onnx not found. Set SILERO_VAD_ONNX or place the "
                "file at ~/homecal-voice/silero_vad.onnx (install script does this)."
            )

    sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    state = np.zeros((2, 1, 128), dtype=np.float32)

    def vad(frame: np.ndarray, sr: int) -> float:
        nonlocal state
        x = (frame.astype(np.float32) / 32768.0).reshape(1, -1)
        out, state = sess.run(None, {"input": x, "state": state, "sr": np.array(sr, dtype=np.int64)})
        return float(out.squeeze())
    return vad
