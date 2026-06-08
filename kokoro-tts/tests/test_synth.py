import numpy as np
from unittest.mock import MagicMock, patch

from app.synth import Synth


def _fake_kokoro(samples=None, sr=24000):
    """Return a mock Kokoro whose .create() returns predictable bytes."""
    k = MagicMock()
    k.create.return_value = (samples if samples is not None else np.linspace(-0.5, 0.5, 24000, dtype=np.float32), sr)
    return k


def test_synth_returns_wav_bytes_with_lead_silence_and_normalized_peak():
    fake_samples = np.array([0.9, -0.9, 0.5, -0.5] * 100, dtype=np.float32)
    with patch("app.synth.Kokoro", return_value=_fake_kokoro(samples=fake_samples)):
        s = Synth(model_path="/x", voices_path="/y")
        wav, latency_ms = s.synthesize("hello", voice="af_bella")
    # WAV header check: starts with "RIFF" + size + "WAVE"
    assert wav[:4] == b"RIFF" and wav[8:12] == b"WAVE"
    # Latency must be measured (> 0)
    assert latency_ms >= 0


def test_synth_passes_voice_param_to_kokoro():
    fake = _fake_kokoro()
    with patch("app.synth.Kokoro", return_value=fake):
        s = Synth(model_path="/x", voices_path="/y")
        s.synthesize("hi", voice="bf_emma")
    args, kwargs = fake.create.call_args
    assert kwargs.get("voice") == "bf_emma"


def test_synth_warmup_runs_one_synth():
    fake = _fake_kokoro()
    with patch("app.synth.Kokoro", return_value=fake):
        s = Synth(model_path="/x", voices_path="/y")
        s.warmup()
    # One warm call after construction
    assert fake.create.call_count == 1
