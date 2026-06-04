from unittest.mock import MagicMock, patch
import numpy as np
from homecal_voice.main import run_once, OneShotDeps
from homecal_voice.mic import FRAME_SAMPLES
from homecal_voice.intent import IntentResult

def speech(): return (np.random.randn(FRAME_SAMPLES) * 5000).astype(np.int16)

def test_run_once_high_confidence_auto_applies():
    mic_frames = iter([speech()] * 200)
    wake = MagicMock(); wake.step.side_effect = lambda f: True
    ep = MagicMock()
    ep.feed.side_effect = [False, False, True]
    ep.audio.return_value = speech()
    stt = MagicMock(return_value="tonight's dinner is tacos")
    intent = MagicMock(return_value=IntentResult("dinner_set", {"date": "2026-06-04", "meal": "tacos"}, 0.92, ""))
    executor = MagicMock(); executor.apply.return_value = {"ok": True, "spoken": "Saved tacos for today."}
    tts = MagicMock()
    state = MagicMock()
    audit = MagicMock()
    deps = OneShotDeps(
        next_frame=lambda: next(mic_frames),
        wake=wake, endpointer=ep,
        endpointer_factory=lambda: ep,
        transcribe=stt, extract_intent=intent,
        execute=executor.apply, speak=tts, post_state=state, post_audit=audit,
        utterance_id=lambda: "u1", muted=lambda: False,
    )
    run_once(deps)
    executor.apply.assert_called_once()
    tts.assert_called_once_with("Saved tacos for today.")
    audit.assert_called_once()
    kinds = [c.kwargs.get("kind") for c in state.call_args_list]
    assert kinds == ["listening", "thinking", "applied"]
