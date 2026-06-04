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
        self._seen_speech = False  # gate silence-end on having heard speech first
        log.debug("Endpointer: silence_frames_needed=%d cap_frames=%d threshold=%.2f",
                  self._silence_frames_needed, self._cap_frames, self._threshold)

    def feed(self, frame: np.ndarray) -> bool:
        self._buf.append(frame)
        prob = self._vad(frame, SAMPLE_RATE)
        if prob >= self._threshold:
            self._silent_run = 0
            if not self._seen_speech:
                log.debug("endpoint: first speech at frame %d (prob=%.2f)",
                          len(self._buf), prob)
            self._seen_speech = True
        else:
            self._silent_run += 1
        # Don't end on silence until we've heard at least one frame of speech.
        # Otherwise the pre-speech silence backlog (the gap between wake-word
        # and the rest of the command) terminates the recording immediately.
        if self._seen_speech and self._silent_run >= self._silence_frames_needed:
            log.info("endpoint: silence after %d frames (had speech)", len(self._buf))
            return True
        if len(self._buf) >= self._cap_frames:
            log.warning("endpoint: hard cap (%d frames, seen_speech=%s)",
                        len(self._buf), self._seen_speech)
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
    # Silero VAD v5/v6 ONNX requires a fixed 512-sample chunk at 16kHz (256 at 8kHz).
    # Our 80ms frames are 1280 samples — split into 2× 512, drop the remainder.
    CHUNK_16K = 512
    sr_arr = np.array(16000, dtype=np.int64)

    def vad(frame: np.ndarray, sr: int) -> float:
        nonlocal state
        samples = frame.astype(np.float32) / 32768.0
        probs = []
        # iterate in 512-sample steps; ignore any tail < 512
        for i in range(0, len(samples) - CHUNK_16K + 1, CHUNK_16K):
            x = samples[i:i + CHUNK_16K].reshape(1, -1)
            out, state = sess.run(None, {"input": x, "state": state, "sr": sr_arr})
            probs.append(float(out.squeeze()))
        return max(probs) if probs else 0.0
    return vad
