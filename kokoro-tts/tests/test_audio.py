import io
import wave
import numpy as np

from app.audio import to_wav_bytes, float32_to_int16, SAMPLE_RATE


def _read_wav(buf: bytes):
    with wave.open(io.BytesIO(buf), "rb") as w:
        return {
            "channels": w.getnchannels(),
            "sampwidth": w.getsampwidth(),
            "framerate": w.getframerate(),
            "nframes": w.getnframes(),
            "raw": w.readframes(w.getnframes()),
        }


def test_sample_rate_is_24khz():
    assert SAMPLE_RATE == 24000


def test_float32_to_int16_round_trips_zero():
    out = float32_to_int16(np.zeros(100, dtype=np.float32))
    assert out.dtype == np.int16
    assert np.all(out == 0)


def test_float32_to_int16_clips_out_of_range():
    out = float32_to_int16(np.array([1.5, -1.5, 0.5], dtype=np.float32))
    # 1.0 → 32767; -1.0 → -32767; 0.5 → ~16384
    assert out[0] == 32767
    assert out[1] == -32767  # symmetric clip, not -32768
    assert 16000 < out[2] < 16500


def test_to_wav_bytes_writes_mono_24khz_s16():
    samples = np.zeros(1200, dtype=np.float32)  # 50ms @ 24kHz
    buf = to_wav_bytes(samples)
    parsed = _read_wav(buf)
    assert parsed["channels"] == 1
    assert parsed["sampwidth"] == 2
    assert parsed["framerate"] == SAMPLE_RATE
    assert parsed["nframes"] == 1200
    assert len(parsed["raw"]) == 1200 * 2
