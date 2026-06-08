"""Audio post-processing for Kokoro output.

Kokoro emits float32 PCM at 24 kHz mono. We convert to int16 + WAV before
sending over LAN because (a) every Linux audio player handles WAV natively,
(b) int16 halves the wire bytes vs fp32 with no audible loss for TTS, (c)
no re-encoding cost (vs MP3/Opus). 100ms leading silence + peak normalize
are applied at synth time (see synth.py) — this module only owns the bytes."""
import io
import wave
import numpy as np

SAMPLE_RATE = 24000  # Kokoro's native rate


def float32_to_int16(samples: np.ndarray) -> np.ndarray:
    """Clip to [-1, 1] and scale to symmetric int16. Symmetric clip (-32767
    not -32768) keeps amplitude balanced — saves a half-LSB DC offset that's
    inaudible but theoretically annoying to a level-meter."""
    clipped = np.clip(samples, -1.0, 1.0)
    return (clipped * 32767.0).astype(np.int16)


def to_wav_bytes(samples: np.ndarray) -> bytes:
    """Wrap float32 PCM samples in a mono/16-bit/24kHz WAV blob."""
    pcm = float32_to_int16(samples)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()
