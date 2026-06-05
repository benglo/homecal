from unittest.mock import MagicMock

from homecal_voice.wake import WakeDetector


def make_detector(scores_per_frame, *, refractory_frames=10):
    """Build a WakeDetector with a deterministic per-call score sequence.

    Note: while the detector is in its refractory window, `step()` short-circuits
    and does NOT call model.predict() — so the iterator is only consumed on
    frames OUTSIDE the refractory window. Tests must account for that.
    """
    model = MagicMock()
    it = iter(scores_per_frame)
    model.predict = lambda chunk: next(it)
    return WakeDetector(
        model=model,
        wake_name="hey_mycroft_v0.1",
        threshold=0.5,
        trigger_level=1,
        refractory_frames=refractory_frames,
    )


def test_no_wake_below_threshold(silence_frame):
    d = make_detector([{"hey_mycroft_v0.1": 0.1}, {"hey_mycroft_v0.1": 0.2}])
    assert d.step(silence_frame) is False
    assert d.step(silence_frame) is False


def test_wake_fires_once_at_threshold(silence_frame):
    """Second call: refractory > 0, no predict, no fire."""
    d = make_detector([{"hey_mycroft_v0.1": 0.6}, {"hey_mycroft_v0.1": 0.9}])
    assert d.step(silence_frame) is True
    # Refractory active — second high score must NOT fire.
    assert d.step(silence_frame) is False


def test_refractory_blocks_for_exactly_n_frames(silence_frame):
    """Fire once, then `refractory_frames` consecutive False returns (no
    predict calls), then a fresh trigger fires."""
    refractory_n = 5
    # 1 score for the initial fire, then 1 score for the post-refractory trigger.
    # During refractory, predict is NOT called → no scores consumed.
    scores = [{"hey_mycroft_v0.1": 0.9}, {"hey_mycroft_v0.1": 0.9}]
    d = make_detector(scores, refractory_frames=refractory_n)
    assert d.step(silence_frame) is True
    for _ in range(refractory_n):
        assert d.step(silence_frame) is False
    # Refractory drained — next high frame fires.
    assert d.step(silence_frame) is True


def test_refractory_low_score_after_drain_does_not_fire(silence_frame):
    refractory_n = 3
    scores = [{"hey_mycroft_v0.1": 0.9}, {"hey_mycroft_v0.1": 0.1}, {"hey_mycroft_v0.1": 0.9}]
    d = make_detector(scores, refractory_frames=refractory_n)
    assert d.step(silence_frame) is True
    for _ in range(refractory_n):
        assert d.step(silence_frame) is False
    # First post-refractory frame is below threshold.
    assert d.step(silence_frame) is False
    # Second is above — fires.
    assert d.step(silence_frame) is True
