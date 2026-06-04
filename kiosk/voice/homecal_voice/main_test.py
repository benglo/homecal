"""Negative + happy-path coverage of run_once orchestration.

The orchestration loop is the highest-blast-radius code on the Pi; every
branch (auto-apply, silent low-conf, mid-conf confirm yes/no/timeout/edit,
STT exception) is exercised here against mock collaborators.
"""

from unittest.mock import MagicMock, patch

import numpy as np

from homecal_voice.intent import IntentResult
from homecal_voice.main import run_once, OneShotDeps
from homecal_voice.mic import FRAME_SAMPLES


def _speech():
    return (np.random.randn(FRAME_SAMPLES) * 5000).astype(np.int16)


def _make_deps(
    *,
    transcribe=None,
    extract_intent=None,
    execute=None,
    speak=None,
    feed_results=(False, False, True),
):
    mic_frames = iter([_speech()] * 1000)
    wake = MagicMock()
    wake.step.side_effect = lambda f: True
    ep = MagicMock()
    ep.feed.side_effect = list(feed_results)
    ep.audio.return_value = _speech()
    ep.had_speech = True
    state = MagicMock()
    audit = MagicMock()
    deps = OneShotDeps(
        next_frame=lambda: next(mic_frames),
        wake=wake,
        endpointer=ep,
        endpointer_factory=lambda: ep,
        transcribe=transcribe or MagicMock(return_value="default"),
        extract_intent=extract_intent or MagicMock(),
        execute=execute or MagicMock(return_value={"ok": True, "spoken": "ok."}),
        speak=speak or MagicMock(),
        post_state=state,
        post_audit=audit,
        utterance_id=lambda: "u1",
        muted=lambda: False,
    )
    return deps, state, audit


# --- happy path ------------------------------------------------------------


def test_high_confidence_auto_applies():
    intent = IntentResult("dinner_set", {"date": "2026-06-04", "meal": "tacos"}, 0.92, "raw")
    execute = MagicMock(return_value={"ok": True, "spoken": "Saved tacos for today."})
    deps, state, audit = _make_deps(
        transcribe=MagicMock(return_value="tonight's dinner is tacos"),
        extract_intent=MagicMock(return_value=intent),
        execute=execute,
    )
    speak = deps.speak
    run_once(deps)

    execute.assert_called_once()
    speak.assert_called_once_with("Saved tacos for today.")
    kinds = [c.kwargs.get("kind") for c in state.call_args_list]
    assert kinds == ["listening", "thinking", "applied"]
    audit_kwargs = audit.call_args.kwargs
    assert audit_kwargs["status"] == "applied"
    assert audit_kwargs["confidence"] == 0.92
    # applied payload must include the intent fields the wall renders.
    applied_payload = state.call_args_list[-1].kwargs["payload"]
    assert applied_payload["intent"]["meal"] == "tacos"


# --- STT failure -----------------------------------------------------------


def test_stt_exception_posts_failed_state_and_audit():
    transcribe = MagicMock(side_effect=RuntimeError("whisper-server 503"))
    intent_fn = MagicMock()
    execute = MagicMock()
    speak = MagicMock()
    deps, state, audit = _make_deps(
        transcribe=transcribe, extract_intent=intent_fn, execute=execute, speak=speak,
    )
    run_once(deps)

    intent_fn.assert_not_called()
    execute.assert_not_called()
    speak.assert_not_called()
    kinds = [c.kwargs.get("kind") for c in state.call_args_list]
    assert kinds[-1] == "failed"
    assert state.call_args_list[-1].kwargs["payload"]["reason"] == "stt_error"
    audit_kwargs = audit.call_args.kwargs
    assert audit_kwargs["status"] == "failed"
    assert "stt:" in audit_kwargs["error"]


# --- silent low-confidence -------------------------------------------------


def test_low_confidence_silent_fail_does_not_execute_or_speak():
    intent = IntentResult("dinner_set", {"date": "2026-06-04", "meal": "tacos"}, 0.4, "raw")
    execute = MagicMock()
    speak = MagicMock()
    deps, state, audit = _make_deps(
        extract_intent=MagicMock(return_value=intent), execute=execute, speak=speak,
    )
    run_once(deps)

    execute.assert_not_called()
    speak.assert_not_called()
    kinds = [c.kwargs.get("kind") for c in state.call_args_list]
    assert kinds[-1] == "failed"
    assert state.call_args_list[-1].kwargs["payload"]["reason"] == "low_confidence"
    assert audit.call_args.kwargs["status"] == "silent_low_conf"


def test_unknown_intent_silent_fail():
    intent = IntentResult("unknown", {"reason": "no_json"}, 0.0, "raw")
    execute = MagicMock()
    deps, state, audit = _make_deps(
        extract_intent=MagicMock(return_value=intent), execute=execute,
    )
    run_once(deps)

    execute.assert_not_called()
    assert audit.call_args.kwargs["status"] == "silent_low_conf"


# --- mid-confidence confirm flows ------------------------------------------


def _mid_confidence_intent():
    return IntentResult("dinner_set", {"date": "2026-06-04", "meal": "tacos"}, 0.75, "raw")


def test_mid_confidence_confirm_yes_applies():
    execute = MagicMock(return_value={"ok": True, "spoken": "Saved."})
    speak = MagicMock()
    deps, state, audit = _make_deps(
        extract_intent=MagicMock(return_value=_mid_confidence_intent()),
        execute=execute,
        speak=speak,
    )
    with patch("homecal_voice.confirm_loop.confirm_listen") as cl:
        cl.return_value = MagicMock(kind="yes", hint="")
        run_once(deps)
    execute.assert_called_once()
    speak.assert_called_once_with("Saved.")
    assert audit.call_args_list[-1].kwargs["status"] == "confirmed"
    kinds = [c.kwargs.get("kind") for c in state.call_args_list]
    assert "confirming" in kinds and kinds[-1] == "applied"


def test_mid_confidence_confirm_no_cancels_and_speaks():
    execute = MagicMock()
    speak = MagicMock()
    deps, state, audit = _make_deps(
        extract_intent=MagicMock(return_value=_mid_confidence_intent()),
        execute=execute,
        speak=speak,
    )
    with patch("homecal_voice.confirm_loop.confirm_listen") as cl:
        cl.return_value = MagicMock(kind="no", hint="")
        run_once(deps)
    execute.assert_not_called()
    speak.assert_called_once_with("Cancelled.")
    assert audit.call_args_list[-1].kwargs["status"] == "cancelled"
    assert state.call_args_list[-1].kwargs["payload"]["reason"] == "no"


def test_mid_confidence_timeout_speaks_distinct_message():
    """timeout vs no must be distinguishable in both the audit reason AND
    audibly (user feedback) — silence + a fading confirm card is the worst
    possible UX for 'did it save'?"""
    execute = MagicMock()
    speak = MagicMock()
    deps, state, audit = _make_deps(
        extract_intent=MagicMock(return_value=_mid_confidence_intent()),
        execute=execute,
        speak=speak,
    )
    with patch("homecal_voice.confirm_loop.confirm_listen") as cl:
        cl.return_value = MagicMock(kind="timeout", hint="")
        run_once(deps)
    execute.assert_not_called()
    speak.assert_called_once()
    spoken = speak.call_args[0][0]
    assert "yes or no" in spoken.lower() or "didn" in spoken.lower()
    assert state.call_args_list[-1].kwargs["payload"]["reason"] == "timeout"
    assert audit.call_args_list[-1].kwargs["status"] == "cancelled"


def test_mid_confidence_edit_leaves_audit_pending_and_speaks_hint():
    """Edit/ambiguous outcomes leave the audit row as 'pending' (from the
    earlier write) for PendingReviewTray to pick up later. The user must
    still get audible feedback — silence here is the silent-failure mode
    flagged by the review."""
    execute = MagicMock()
    speak = MagicMock()
    deps, state, audit = _make_deps(
        extract_intent=MagicMock(return_value=_mid_confidence_intent()),
        execute=execute,
        speak=speak,
    )
    with patch("homecal_voice.confirm_loop.confirm_listen") as cl:
        cl.return_value = MagicMock(kind="edit", hint="change meal to pasta")
        run_once(deps)
    execute.assert_not_called()
    speak.assert_called_once()
    # Only the initial confirming-pending audit fires for edit outcomes.
    statuses = [c.kwargs["status"] for c in audit.call_args_list]
    assert statuses == ["pending"]
    assert state.call_args_list[-1].kwargs["payload"]["reason"] == "edit"


def test_mid_confidence_ambiguous_leaves_audit_pending_and_speaks_hint():
    execute = MagicMock()
    speak = MagicMock()
    deps, state, audit = _make_deps(
        extract_intent=MagicMock(return_value=_mid_confidence_intent()),
        execute=execute,
        speak=speak,
    )
    with patch("homecal_voice.confirm_loop.confirm_listen") as cl:
        cl.return_value = MagicMock(kind="ambiguous", hint="")
        run_once(deps)
    execute.assert_not_called()
    speak.assert_called_once()
    statuses = [c.kwargs["status"] for c in audit.call_args_list]
    assert statuses == ["pending"]
