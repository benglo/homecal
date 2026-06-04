import numpy as np

from homecal_voice.endpointer import Endpointer
from homecal_voice.mic import FRAME_MS, FRAME_SAMPLES


class _FakeVad:
    """Reproducible per-frame VAD that returns 0.9 for True, 0.05 for False."""

    def __init__(self, decisions):
        self._it = iter(decisions)

    def __call__(self, frame: np.ndarray, _sr: int) -> float:
        return 0.9 if next(self._it) else 0.05


def silence():
    return np.zeros(FRAME_SAMPLES, dtype=np.int16)


def speech():
    return (np.random.randn(FRAME_SAMPLES) * 5000).astype(np.int16)


def test_endpoints_after_silence_window():
    """5 frames speech then 10 silence: endpointer ends after 5 speech +
    `silence_frames_needed` (700ms // 80ms = 8) silent frames = 13 frames total."""
    decisions = [True] * 5 + [False] * 10
    ep = Endpointer(vad=_FakeVad(decisions), min_silence_ms=700, hard_cap_ms=8000)
    frames = [speech()] * 5 + [silence()] * 10
    ended_at = None
    for i, f in enumerate(frames, start=1):
        if ep.feed(f):
            ended_at = i
            break
    expected = 5 + (700 // FRAME_MS)
    assert ended_at == expected
    assert ep.audio().shape[0] == expected * FRAME_SAMPLES
    assert ep.had_speech is True


def test_hard_cap_at_8s():
    """8s = 100 frames at 80ms each."""
    decisions = [True] * 200
    ep = Endpointer(vad=_FakeVad(decisions), min_silence_ms=700, hard_cap_ms=8000)
    n_frames = 0
    for f in (speech() for _ in range(200)):
        n_frames += 1
        if ep.feed(f):
            break
    assert n_frames == 100


def test_silence_does_not_end_until_speech_has_been_heard():
    """Pre-speech silence backlog (e.g. the gap between wake-word and the
    rest of the command) must NOT terminate the recording before any speech
    arrives — that was the bug that produced [BLANK_AUDIO] transcripts."""
    # 100 silent frames, then speech, then silence
    decisions = [False] * 100 + [True] * 5 + [False] * 20
    ep = Endpointer(vad=_FakeVad(decisions), min_silence_ms=700, hard_cap_ms=12_000)
    ended_at = None
    for i in range(len(decisions)):
        f = silence() if not decisions[i] else speech()
        if ep.feed(f):
            ended_at = i + 1
            break
    assert ended_at is not None
    # Should end AFTER the speech burst, not during the pre-speech silence.
    expected = 100 + 5 + (700 // FRAME_MS)
    assert ended_at == expected


def test_had_speech_is_false_before_any_threshold_frame():
    ep = Endpointer(vad=_FakeVad([False] * 5), min_silence_ms=700, hard_cap_ms=8000)
    for _ in range(5):
        ep.feed(silence())
    assert ep.had_speech is False
