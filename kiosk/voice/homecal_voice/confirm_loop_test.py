import numpy as np
from unittest.mock import MagicMock

from homecal_voice.confirm_loop import confirm_listen
from homecal_voice.mic import FRAME_SAMPLES


def speech():
    return (np.random.randn(FRAME_SAMPLES) * 5000).astype(np.int16)


def _ep_with_speech(feed_results):
    ep = MagicMock()
    ep.feed.side_effect = feed_results
    ep.audio.return_value = speech()
    ep.had_speech = True
    return ep


def _ep_silent_only():
    ep = MagicMock()
    ep.feed.return_value = False
    ep.audio.return_value = speech()
    ep.had_speech = False
    return ep


def test_confirm_returns_yes_when_grammar_classifies_yes():
    ep = _ep_with_speech([False, False, True])
    stt = MagicMock(return_value="yes")
    next_frame = iter([speech()] * 5).__next__
    r = confirm_listen(next_frame=next_frame, endpointer_factory=lambda: ep, transcribe=stt, timeout_s=5)
    assert r.kind == "yes"


def test_confirm_returns_no_when_grammar_classifies_no():
    ep = _ep_with_speech([False, True])
    stt = MagicMock(return_value="no")
    next_frame = iter([speech()] * 5).__next__
    r = confirm_listen(next_frame=next_frame, endpointer_factory=lambda: ep, transcribe=stt, timeout_s=5)
    assert r.kind == "no"


def test_confirm_returns_edit_with_hint():
    ep = _ep_with_speech([False, False, True])
    stt = MagicMock(return_value="actually change time to six")
    next_frame = iter([speech()] * 5).__next__
    r = confirm_listen(next_frame=next_frame, endpointer_factory=lambda: ep, transcribe=stt, timeout_s=5)
    assert r.kind == "edit"
    assert "six" in r.hint


def test_confirm_returns_ambiguous_for_unrelated_speech():
    ep = _ep_with_speech([False, False, True])
    stt = MagicMock(return_value="i think so maybe")
    next_frame = iter([speech()] * 5).__next__
    r = confirm_listen(next_frame=next_frame, endpointer_factory=lambda: ep, transcribe=stt, timeout_s=5)
    assert r.kind == "ambiguous"


def test_confirm_returns_timeout_after_n_seconds_no_speech():
    """Endpointer never fires within the window — pure silence the whole time.

    Use a generator (not a fixed-length list) for `next_frame` because the
    tight Python loop can iterate millions of times within a 200ms window.
    """
    ep = _ep_silent_only()
    import itertools

    next_frame = lambda _it=itertools.repeat(speech()): next(_it)
    stt = MagicMock(return_value="")
    r = confirm_listen(
        next_frame=next_frame, endpointer_factory=lambda: ep, transcribe=stt, timeout_s=0.2,
    )
    assert r.kind == "timeout"
    # Crucial: we did NOT pay for a whisper call on pure silence.
    stt.assert_not_called()


def test_confirm_short_circuits_when_endpointer_fired_without_speech():
    """Endpointer fires on hard cap with no speech detected — short-circuit
    to timeout instead of sending a buffer of silence to STT."""
    ep = MagicMock()
    ep.feed.side_effect = [False, True]
    ep.audio.return_value = speech()
    ep.had_speech = False
    next_frame = iter([speech()] * 5).__next__
    stt = MagicMock(return_value="")
    r = confirm_listen(
        next_frame=next_frame, endpointer_factory=lambda: ep, transcribe=stt, timeout_s=5,
    )
    assert r.kind == "timeout"
    stt.assert_not_called()


def test_confirm_tolerates_endpointer_without_had_speech_attr():
    """Backward compat: an old MagicMock-style endpointer without the new
    had_speech attribute still works (we assume True so we don't break
    existing test fixtures)."""
    ep = MagicMock(spec=["feed", "audio"])
    ep.feed.side_effect = [True]
    ep.audio.return_value = speech()
    stt = MagicMock(return_value="yes")
    next_frame = iter([speech()] * 5).__next__
    r = confirm_listen(
        next_frame=next_frame, endpointer_factory=lambda: ep, transcribe=stt, timeout_s=5,
    )
    assert r.kind == "yes"
