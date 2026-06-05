import io, struct, subprocess
from unittest.mock import MagicMock, patch
import numpy as np
from homecal_voice.mic import MicStream, FRAME_SAMPLES, SAMPLE_RATE

def test_frame_size_is_80ms_at_16k():
    assert FRAME_SAMPLES == 1280
    assert SAMPLE_RATE == 16000

def test_mic_stream_yields_frames(monkeypatch):
    fake_pcm = (np.zeros(FRAME_SAMPLES * 3, dtype=np.int16)).tobytes()
    fake_proc = MagicMock()
    fake_proc.stdout = io.BytesIO(fake_pcm)
    fake_proc.poll.return_value = None
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **kw: fake_proc)
    m = MicStream(device="default")
    m.start()
    frames = []
    for f in m.frames():
        frames.append(f)
        if len(frames) == 3: break
    m.stop()
    assert all(f.shape == (FRAME_SAMPLES,) for f in frames)
    assert all(f.dtype == np.int16 for f in frames)
