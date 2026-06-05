import numpy as np

from homecal_voice.endpointer import Endpointer, _boost_int16, _peak_normalise
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


# --- gain helpers ----------------------------------------------------------


def test_boost_int16_scales_and_clips():
    frame = np.array([100, -200, 16000, -32768, 32767], dtype=np.int16)
    out = _boost_int16(frame, gain=5.0)
    assert out.dtype == np.int16
    assert out[0] == 500
    assert out[1] == -1000
    # Would overflow — must clip to int16 range, not wrap.
    assert out[2] == 32767  # 16000 * 5 = 80000 → clipped
    assert out[3] == -32768
    assert out[4] == 32767


def test_boost_int16_noop_at_gain_one():
    frame = np.array([100, -200, 5000], dtype=np.int16)
    assert (_boost_int16(frame, gain=1.0) == frame).all()


def test_peak_normalise_boosts_quiet_audio_to_target():
    # PCM2902 mic case: peak ~3800 should reach the 16384 target.
    quiet = np.array([3800, -3800, 100, -100, 0, 0], dtype=np.int16)
    out = _peak_normalise(quiet, target_peak=16384)
    assert int(np.max(np.abs(out))) == 16384


def test_peak_normalise_leaves_silence_alone():
    """Below the noise-floor cutoff we must NOT amplify — otherwise pure
    background hiss gets blasted to full scale and confuses STT."""
    near_silence = np.array([50, -80, 30, -40], dtype=np.int16)
    out = _peak_normalise(near_silence, target_peak=16384)
    assert (out == near_silence).all()


def test_peak_normalise_does_not_attenuate_already_loud_audio():
    """If the user spoke loudly enough that peak > target, leave it alone —
    attenuation would reduce signal-to-noise without benefit."""
    loud = np.array([20000, -25000, 100], dtype=np.int16)
    out = _peak_normalise(loud, target_peak=16384)
    assert (out == loud).all()


def test_audio_applies_peak_normalisation():
    """End-to-end: a low-gain capture comes out of audio() at usable level."""
    ep = Endpointer(vad=_FakeVad([True] * 5 + [False] * 20), min_silence_ms=700, hard_cap_ms=8000)
    quiet_speech = (np.random.randn(FRAME_SAMPLES) * 1000).astype(np.int16)
    silent = silence()
    for f in [quiet_speech] * 5 + [silent] * (700 // FRAME_MS):
        if ep.feed(f):
            break
    out = ep.audio()
    # Original peak was ~3000-4000; after normalisation it should hit ~16384.
    assert 15000 <= int(np.max(np.abs(out))) <= 17000


def test_endpointer_applies_vad_gain_before_scoring():
    """Verify the VAD callable receives the boosted frame, not the raw one —
    that's the whole point: Silero needs |x| > 0.05 to lock on, and PCM2902
    peaks at ~0.12 raw → too quiet."""
    seen_peaks = []

    def spy_vad(frame, _sr):
        seen_peaks.append(int(np.max(np.abs(frame))))
        return 0.05

    ep = Endpointer(vad=spy_vad, vad_gain=5.0, min_silence_ms=700, hard_cap_ms=8000)
    raw = (np.ones(FRAME_SAMPLES, dtype=np.int16) * 1000)
    ep.feed(raw)
    assert seen_peaks == [5000]  # 1000 × 5.0


def test_energy_gate_treats_loud_frame_as_speech_even_when_silero_silent():
    """Silero on PCM2902 routinely scores < 0.1 on real speech (mic is too
    quiet for the spectral model). RMS catches it: a frame with RMS above
    threshold counts as speech regardless of Silero's verdict."""
    silero_silent = lambda f, _sr: 0.0
    ep = Endpointer(
        vad=silero_silent,
        vad_gain=1.0,
        energy_rms_threshold=5500.0,
        min_silence_ms=700,
        hard_cap_ms=8000,
    )
    loud_frame = (np.ones(FRAME_SAMPLES, dtype=np.int16) * 8000)  # RMS=8000 > 5500
    ep.feed(loud_frame)
    assert ep.had_speech is True


def test_energy_gate_does_not_fire_on_background_noise():
    """If threshold sits BELOW background noise (e.g. 700 vs ambient 4000),
    every frame reads as speech, silent_run never accumulates, and the
    endpointer always hits the hard cap — defeating the whole point.
    Pin the threshold above realistic background noise levels."""
    silero_silent = lambda f, _sr: 0.0
    ep = Endpointer(
        vad=silero_silent,
        vad_gain=1.0,
        energy_rms_threshold=5500.0,
        min_silence_ms=700,
        hard_cap_ms=8000,
    )
    # 4000 RMS = realistic boosted background level on PCM2902.
    background = (np.ones(FRAME_SAMPLES, dtype=np.int16) * 4000)
    ep.feed(background)
    assert ep.had_speech is False


def test_endpointer_vad_gain_one_passes_raw_frame():
    seen_peaks = []

    def spy_vad(frame, _sr):
        seen_peaks.append(int(np.max(np.abs(frame))))
        return 0.05

    ep = Endpointer(vad=spy_vad, vad_gain=1.0, min_silence_ms=700, hard_cap_ms=8000)
    raw = (np.ones(FRAME_SAMPLES, dtype=np.int16) * 1000)
    ep.feed(raw)
    assert seen_peaks == [1000]
