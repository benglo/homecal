import io
import wave
import numpy as np

from app.audio import to_wav_bytes, float32_to_int16, SAMPLE_RATE, prepend_silence, peak_normalize, LEAD_SILENCE_MS, PEAK_DBFS


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


def test_lead_silence_constant_is_100ms():
    assert LEAD_SILENCE_MS == 100


def test_target_peak_is_minus_3_dbfs():
    assert PEAK_DBFS == -3.0


def test_prepend_silence_adds_correct_sample_count():
    samples = np.ones(100, dtype=np.float32) * 0.5
    out = prepend_silence(samples)
    expected_silence = SAMPLE_RATE * LEAD_SILENCE_MS // 1000  # 2400 @ 24kHz
    assert len(out) == 100 + expected_silence
    assert np.all(out[:expected_silence] == 0.0)
    assert np.array_equal(out[expected_silence:], samples)


def test_peak_normalize_to_minus_3_dbfs():
    # Loud signal at 0.9 peak; normalize should pull down to 10^(-3/20) ≈ 0.7079
    samples = np.array([0.9, -0.9, 0.45], dtype=np.float32)
    out = peak_normalize(samples)
    target = 10 ** (PEAK_DBFS / 20)
    assert abs(np.max(np.abs(out)) - target) < 1e-4
    # Ratios preserved
    assert abs(out[2] / out[0] - 0.5) < 1e-6


def test_peak_normalize_silent_returns_unchanged():
    samples = np.zeros(100, dtype=np.float32)
    out = peak_normalize(samples)
    assert np.all(out == 0.0)  # no divide-by-zero blowup
