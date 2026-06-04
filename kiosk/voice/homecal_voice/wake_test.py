from unittest.mock import MagicMock
from homecal_voice.wake import WakeDetector

def make_detector(scores_per_frame):
    model = MagicMock()
    it = iter(scores_per_frame)
    model.predict = lambda chunk: next(it)
    return WakeDetector(model=model, wake_name="hey_mycroft_v0.1", threshold=0.5, trigger_level=1, refractory_frames=10)

def test_no_wake_below_threshold(silence_frame):
    d = make_detector([{"hey_mycroft_v0.1": 0.1}, {"hey_mycroft_v0.1": 0.2}])
    assert d.step(silence_frame) is False
    assert d.step(silence_frame) is False

def test_wake_fires_once_at_threshold(silence_frame):
    d = make_detector([{"hey_mycroft_v0.1": 0.6}, {"hey_mycroft_v0.1": 0.9}])
    assert d.step(silence_frame) is True
    assert d.step(silence_frame) is False

def test_refractory_clears_after_n_frames(silence_frame):
    scores = [{"hey_mycroft_v0.1": 0.9}] + [{"hey_mycroft_v0.1": 0.0}] * 12 + [{"hey_mycroft_v0.1": 0.9}]
    d = make_detector(scores)
    assert d.step(silence_frame) is True
    for _ in range(12):
        assert d.step(silence_frame) is False
    assert d.step(silence_frame) is True
