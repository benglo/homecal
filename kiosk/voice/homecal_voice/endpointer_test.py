import numpy as np
from homecal_voice.endpointer import Endpointer
from homecal_voice.mic import FRAME_SAMPLES, SAMPLE_RATE

class _FakeVad:
    def __init__(self, decisions):
        self._it = iter(decisions)
    def __call__(self, frame: np.ndarray, _sr: int) -> float:
        return 0.9 if next(self._it) else 0.05

def silence(): return np.zeros(FRAME_SAMPLES, dtype=np.int16)
def speech():  return (np.random.randn(FRAME_SAMPLES) * 5000).astype(np.int16)

def test_endpoints_after_silence_window():
    decisions = [True]*5 + [False]*10
    ep = Endpointer(vad=_FakeVad(decisions), min_silence_ms=700, hard_cap_ms=8000)
    frames = [speech()]*5 + [silence()]*10
    ended = None
    for f in frames:
        if ep.feed(f): ended = ep.audio(); break
    assert ended is not None
    assert ended.shape[0] >= SAMPLE_RATE * 5 // 80 * FRAME_SAMPLES // 5

def test_hard_cap_at_8s():
    decisions = [True] * 200
    ep = Endpointer(vad=_FakeVad(decisions), min_silence_ms=700, hard_cap_ms=8000)
    n_frames = 0
    for f in (speech() for _ in range(200)):
        n_frames += 1
        if ep.feed(f): break
    assert n_frames == 100
