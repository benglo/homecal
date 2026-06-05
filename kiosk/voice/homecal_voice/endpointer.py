import logging
import numpy as np
from collections import deque
from typing import Callable, Optional
from homecal_voice.mic import FRAME_SAMPLES, FRAME_MS, SAMPLE_RATE

log = logging.getLogger("homecal_voice.endpointer")
VadFn = Callable[[np.ndarray, int], float]

class Endpointer:
    """Buffer speech until N ms of silence OR hard cap reached.

    Speech is detected if EITHER Silero fires OR per-frame RMS exceeds
    `energy_rms_threshold`. Silero alone is unreliable on low-gain mics
    (its spectral model needs healthy signal); the energy gate covers the
    gap. The gate must sit above the boosted background-noise floor — if
    it's below, every frame reads as speech and silence-end never fires.

    `vad_gain` boosts int16 audio before BOTH the Silero call and the RMS
    measurement. Default 5× is tuned for the PCM2902 USB mic; override via
    Config / `VAD_GAIN` env when the hardware changes.
    """
    def __init__(self, vad: VadFn, *,
                 threshold: float = 0.5,
                 min_silence_ms: int = 700,
                 hard_cap_ms: int = 8000,
                 speech_pad_ms: int = 200,
                 vad_gain: float = 5.0,
                 energy_rms_threshold: float = 5500.0):
        self._vad = vad
        self._threshold = threshold
        self._silence_frames_needed = max(1, min_silence_ms // FRAME_MS)
        self._cap_frames = max(1, hard_cap_ms // FRAME_MS)
        self._pad_frames = max(0, speech_pad_ms // FRAME_MS)
        self._vad_gain = vad_gain
        self._energy_rms_threshold = energy_rms_threshold
        self._buf: list[np.ndarray] = []
        self._silent_run = 0
        self._seen_speech = False  # gate silence-end on having heard speech first
        self._probs: list[float] = []  # diagnostic: per-frame VAD scores
        self._peaks: list[int] = []    # diagnostic: per-frame |int16| peak
        self._rms: list[float] = []    # diagnostic: per-frame RMS (boosted)
        log.debug("Endpointer: silence_frames_needed=%d cap_frames=%d threshold=%.2f",
                  self._silence_frames_needed, self._cap_frames, self._threshold)

    def feed(self, frame: np.ndarray) -> bool:
        self._buf.append(frame)
        boosted = _boost_int16(frame, self._vad_gain) if self._vad_gain != 1.0 else frame
        prob = self._vad(boosted, SAMPLE_RATE)
        rms = float(np.sqrt(np.mean(boosted.astype(np.float64) ** 2)))
        self._probs.append(prob)
        self._peaks.append(int(np.max(np.abs(frame))))
        self._rms.append(rms)
        is_speech = prob >= self._threshold or rms >= self._energy_rms_threshold
        if is_speech:
            self._silent_run = 0
            if not self._seen_speech:
                log.debug("endpoint: first speech at frame %d (prob=%.2f rms=%.0f)",
                          len(self._buf), prob, rms)
            self._seen_speech = True
        else:
            self._silent_run += 1
        # Don't end on silence until we've heard at least one frame of speech.
        # Otherwise the pre-speech silence backlog (the gap between wake-word
        # and the rest of the command) terminates the recording immediately.
        if self._seen_speech and self._silent_run >= self._silence_frames_needed:
            log.info("endpoint: silence after %d frames | vad max=%.3f | rms max=%.0f p90=%.0f",
                     len(self._buf), max(self._probs),
                     max(self._rms), sorted(self._rms)[int(len(self._rms)*0.9)])
            return True
        if len(self._buf) >= self._cap_frames:
            log.warning("endpoint: hard cap (%d frames, seen_speech=%s) | vad max=%.3f mean=%.3f | rms max=%.0f mean=%.0f p90=%.0f | peak max=%d",
                        len(self._buf), self._seen_speech, max(self._probs),
                        sum(self._probs)/len(self._probs),
                        max(self._rms), sum(self._rms)/len(self._rms),
                        sorted(self._rms)[int(len(self._rms)*0.9)],
                        max(self._peaks))
            return True
        return False

    def audio(self) -> np.ndarray:
        if not self._buf:
            return np.zeros(0, dtype=np.int16)
        joined = np.concatenate(self._buf)
        # Peak-normalise the assembled utterance before STT. Without this the
        # PCM2902 mic's low gain (peak ~3800/32768) means even GPT-audio-mini
        # occasionally hallucinates ("Please provide the audio you'd like
        # transcribed"). Target peak 0.5 of int16 range = 16384.
        return _peak_normalise(joined, target_peak=16384)

    @property
    def had_speech(self) -> bool:
        """True iff at least one frame fed in scored above the VAD threshold.
        Callers (e.g. confirm_loop) use this to short-circuit timeouts and
        avoid sending silence to a paid STT endpoint."""
        return self._seen_speech


def _boost_int16(frame: np.ndarray, gain: float) -> np.ndarray:
    """Apply a fixed multiplicative gain to int16 PCM with hard clipping."""
    if gain == 1.0:
        return frame
    boosted = frame.astype(np.int32) * gain
    return np.clip(boosted, -32768, 32767).astype(np.int16)


def _peak_normalise(pcm: np.ndarray, *, target_peak: int) -> np.ndarray:
    """Scale int16 PCM so its absolute peak hits `target_peak`, capped at the
    int16 range. No-op for silent input (peak ≤ floor) to avoid amplifying
    background noise to full scale."""
    peak = int(np.max(np.abs(pcm))) if pcm.size else 0
    if peak <= 200:  # below this the chunk is effectively silence
        return pcm
    gain = min(target_peak / peak, 32767 / max(peak, 1))
    if gain <= 1.0:
        return pcm
    return np.clip(pcm.astype(np.int32) * gain, -32768, 32767).astype(np.int16)


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
