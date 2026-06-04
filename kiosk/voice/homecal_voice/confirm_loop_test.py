import numpy as np
from unittest.mock import MagicMock
from homecal_voice.confirm_loop import confirm_listen
from homecal_voice.mic import FRAME_SAMPLES

def speech(): return (np.random.randn(FRAME_SAMPLES) * 5000).astype(np.int16)

def test_confirm_returns_yes_when_grammar_classifies_yes():
    ep = MagicMock(); ep.feed.side_effect = [False, False, True]; ep.audio.return_value = speech()
    stt = MagicMock(return_value="yes")
    next_frame = iter([speech()] * 5).__next__
    r = confirm_listen(next_frame=next_frame, endpointer_factory=lambda: ep, transcribe=stt, timeout_s=5)
    assert r.kind == "yes"

def test_confirm_returns_timeout_after_n_seconds():
    ep = MagicMock(); ep.feed.return_value = False
    next_frame = iter([speech()] * 1000).__next__
    r = confirm_listen(next_frame=next_frame, endpointer_factory=lambda: ep, transcribe=lambda *_: "", timeout_s=0.2)
    assert r.kind == "timeout"
