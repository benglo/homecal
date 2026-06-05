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
        mic_off=MagicMock(),
        mic_on=MagicMock(),
        play_clip=MagicMock(),
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
    mic_off = deps.mic_off
    mic_on = deps.mic_on
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
    # Mic must be closed for the entire TTS window so the pw-record pipe can't
    # accumulate the BOOM 3 echo and cascade into post-reply false wakes.
    mic_off.assert_called_once()
    mic_on.assert_called_once()


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


def test_low_confidence_reverts_silently_to_idle():
    """Industry-standard behavior (Alexa/Siri/Google): low-confidence intent
    after wake = silent revert. The chip just calmly returns to its idle
    invitation state — no 'didn't catch that' flash, no TTS.
    The audit row still captures it for later review."""
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
    assert kinds[-1] == "idle"
    assert audit.call_args.kwargs["status"] == "silent_low_conf"


def test_unknown_intent_reverts_silently_to_idle():
    intent = IntentResult("unknown", {"reason": "no_json"}, 0.0, "raw")
    execute = MagicMock()
    speak = MagicMock()
    deps, state, audit = _make_deps(
        extract_intent=MagicMock(return_value=intent), execute=execute, speak=speak,
    )
    run_once(deps)

    execute.assert_not_called()
    speak.assert_not_called()
    kinds = [c.kwargs.get("kind") for c in state.call_args_list]
    assert kinds[-1] == "idle"
    assert audit.call_args.kwargs["status"] == "silent_low_conf"


def test_unknown_intent_plays_didnt_catch_clip():
    """Audible fallback: when STT comes back but intent is unknown, the user
    deserves a clear 'I heard you but didn't understand' signal instead of
    silent revert (otherwise they don't know if the wall heard them at all).
    Uses the pre-recorded clip rather than synthesising via TTS because the
    same network glitch that broke STT could break TTS too."""
    intent = IntentResult("unknown", {"reason": "no_json"}, 0.0, "raw")
    deps, _state, _audit = _make_deps(extract_intent=MagicMock(return_value=intent))
    run_once(deps)

    deps.play_clip.assert_called_once()
    # mic must be off during playback to prevent echo cascading into wake.
    deps.mic_off.assert_called()
    deps.mic_on.assert_called()


def test_blank_transcript_plays_didnt_catch_clip():
    transcribe = MagicMock(return_value="[BLANK_AUDIO]")
    deps, _state, _audit = _make_deps(transcribe=transcribe, extract_intent=MagicMock())
    run_once(deps)

    deps.play_clip.assert_called_once()
    deps.mic_off.assert_called()
    deps.mic_on.assert_called()


def test_had_speech_false_still_runs_stt():
    """The Silero VAD is mis-tuned for the PCM2902 mic — real speech rarely
    crosses 0.5 in practice. So a `had_speech=False` short-circuit before STT
    would lose every successful utterance. We instead let Whisper see every
    capture and rely on `_is_blank_transcript` to drop true silence (step 3a).
    This test pins that behavior so the gate doesn't sneak back in."""
    intent = IntentResult("dinner_set", {"date": "2026-06-10", "meal": "sushi"}, 0.92, "raw")
    transcribe = MagicMock(return_value="wednesday's dinner is sushi")
    extract_intent = MagicMock(return_value=intent)
    deps, state, audit = _make_deps(
        transcribe=transcribe,
        extract_intent=extract_intent,
        execute=MagicMock(return_value={"ok": True, "spoken": "Saved."}),
    )
    deps.endpointer.had_speech = False  # type: ignore[attr-defined]
    run_once(deps)

    transcribe.assert_called_once()
    extract_intent.assert_called_once()
    kinds = [c.kwargs.get("kind") for c in state.call_args_list]
    assert kinds[-1] == "applied"
    assert audit.call_args.kwargs["status"] == "applied"


def test_blank_transcript_skips_intent_and_reverts_silently():
    """Whisper sometimes returns '' or '[BLANK_AUDIO]' for silent/static input
    that still has VAD-triggering noise. We must not waste a Haiku call on it."""
    transcribe = MagicMock(return_value="[BLANK_AUDIO]")
    extract_intent = MagicMock()
    deps, state, audit = _make_deps(transcribe=transcribe, extract_intent=extract_intent)
    run_once(deps)

    extract_intent.assert_not_called()
    kinds = [c.kwargs.get("kind") for c in state.call_args_list]
    assert kinds[-1] == "idle"
    assert audit.call_args.kwargs["status"] == "silent_low_conf"
    assert audit.call_args.kwargs["transcript"]


def test_empty_transcript_audited_with_sentinel():
    """Whisper occasionally returns "" (not "[BLANK_AUDIO]"). The pure-blank
    branch still needs to post an audit row, and the row's transcript must
    satisfy Zod's min(1). Sentinel substitution lives in run_once."""
    transcribe = MagicMock(return_value="")
    extract_intent = MagicMock()
    deps, _state, audit = _make_deps(transcribe=transcribe, extract_intent=extract_intent)
    run_once(deps)
    extract_intent.assert_not_called()
    assert audit.call_args.kwargs["transcript"]
    assert audit.call_args.kwargs["transcript"] != ""


def test_punctuation_only_transcript_treated_as_blank():
    """`.` / `?` / etc. happen on muffled noise — never a real utterance."""
    transcribe = MagicMock(return_value=" ... ")
    extract_intent = MagicMock()
    deps, _state, audit = _make_deps(transcribe=transcribe, extract_intent=extract_intent)
    run_once(deps)
    extract_intent.assert_not_called()
    assert audit.call_args.kwargs["transcript"]


def test_is_blank_transcript_helper():
    from homecal_voice.main import _is_blank_transcript
    assert _is_blank_transcript("")
    assert _is_blank_transcript("   ")
    assert _is_blank_transcript("[BLANK_AUDIO]")
    assert _is_blank_transcript("[blank_audio]")
    assert _is_blank_transcript(".")
    assert _is_blank_transcript("...")
    assert _is_blank_transcript(" ?! ")
    # Whisper stage-direction hallucinations (subtitle-corpus artefact).
    assert _is_blank_transcript("(wind blowing)")
    assert _is_blank_transcript("(music playing)")
    assert _is_blank_transcript("[silence]")
    assert _is_blank_transcript("(applause).")
    assert _is_blank_transcript(" (wind) ")
    # Real speech (including parens INSIDE the utterance) must pass through.
    assert not _is_blank_transcript("hi")
    assert not _is_blank_transcript("Tonight's dinner is tacos.")
    assert not _is_blank_transcript("ok.")
    assert not _is_blank_transcript("Set the (Friday) dinner to curry")


def test_is_hallucination_helper():
    """Cloud audio models sometimes refuse or answer chat-style instead of
    transcribing. These never appear in real user speech."""
    from homecal_voice.main import _is_hallucination
    assert _is_hallucination("I'm an assistant that operates solely on text-based inputs.")
    assert _is_hallucination("I'm here to help, but I need more context.")
    assert _is_hallucination("Please provide the audio you'd like transcribed.")
    assert _is_hallucination("Please go ahead and upload the audio file.")
    assert _is_hallucination("I'm sorry, but I can't transcribe the audio.")
    assert _is_hallucination("As an AI, I don't have the capability to process audio.")
    # Case insensitive.
    assert _is_hallucination("PLEASE PROVIDE THE AUDIO")
    # Real transcripts must pass through unmodified.
    assert not _is_hallucination("What's for dinner tonight?")
    assert not _is_hallucination("Tonight's dinner is curry.")
    assert not _is_hallucination("Mia did the bathroom.")
    assert not _is_hallucination("")


def test_low_confidence_plays_didnt_catch_clip():
    """The low-confidence branch (intent.confidence < SILENT_FAIL_CONFIDENCE)
    must play the fallback clip — pinned separately from the unknown-intent
    branch so a refactor that splits the two can't silently regress half
    the user-visible feedback."""
    intent = IntentResult("dinner_set", {"date": "2026-06-04", "meal": "tacos"}, 0.4, "raw")
    deps, _state, audit = _make_deps(extract_intent=MagicMock(return_value=intent))
    run_once(deps)
    deps.play_clip.assert_called_once()
    assert audit.call_args.kwargs["status"] == "silent_low_conf"


def test_wake_reset_called_on_every_exit_path():
    """The cascade fix lives in run_once's try/finally. Pin it so a
    refactor moving reset back into _speak alone can't silently regress —
    that was the exact bug that brought the cascade back in 2026-06-05."""
    intent_applied = IntentResult("dinner_set", {"date": "2026-06-04", "meal": "tacos"}, 0.95, "raw")
    intent_unknown = IntentResult("unknown", {"reason": "no_json"}, 0.0, "raw")

    scenarios = [
        ("applied", MagicMock(return_value="hi"), MagicMock(return_value=intent_applied),
         MagicMock(return_value={"ok": True, "spoken": "ok"})),
        ("blank_transcript", MagicMock(return_value="[BLANK_AUDIO]"), MagicMock(),
         MagicMock()),
        ("unknown_intent", MagicMock(return_value="something"),
         MagicMock(return_value=intent_unknown), MagicMock()),
        ("stt_exception", MagicMock(side_effect=RuntimeError("boom")), MagicMock(),
         MagicMock()),
        ("intent_exception", MagicMock(return_value="hi"),
         MagicMock(side_effect=RuntimeError("backend")), MagicMock()),
        ("executor_exception", MagicMock(return_value="hi"),
         MagicMock(return_value=intent_applied),
         MagicMock(side_effect=RuntimeError("backend"))),
        ("hallucination", MagicMock(return_value="I'm an assistant, please provide audio"),
         MagicMock(), MagicMock()),
    ]
    for name, transcribe, extract_intent, execute in scenarios:
        deps, _state, _audit = _make_deps(
            transcribe=transcribe, extract_intent=extract_intent, execute=execute,
        )
        run_once(deps)
        assert deps.wake.reset.called, f"wake.reset not called on {name} path"


def test_intent_extraction_failure_audits_failed_and_speaks_error():
    """Previously a backend outage during family/chores fetch returned []
    silently, so Haiku reported 'unknown person' indistinguishably from a
    real miss. Now the failure must surface as a distinct spoken error."""
    extract_intent = MagicMock(side_effect=RuntimeError("backend 500"))
    speak = MagicMock()
    deps, state, audit = _make_deps(extract_intent=extract_intent, speak=speak)
    run_once(deps)
    assert audit.call_args.kwargs["status"] == "failed"
    assert "intent:" in audit.call_args.kwargs["error"]
    speak.assert_called_once()
    assert "calendar" in speak.call_args.args[0].lower()
    kinds = [c.kwargs.get("kind") for c in state.call_args_list]
    assert kinds[-1] == "failed"


def test_executor_failure_audits_failed_and_speaks_error():
    """If the homecal backend is unreachable mid-utterance, run_once must
    NOT crash before the audit row writes — that would leave the user
    staring at 'thinking…' forever with no record of what went wrong."""
    intent = IntentResult("dinner_set", {"date": "2026-06-04", "meal": "tacos"}, 0.92, "raw")
    execute = MagicMock(side_effect=RuntimeError("backend 503"))
    speak = MagicMock()
    deps, state, audit = _make_deps(
        extract_intent=MagicMock(return_value=intent), execute=execute, speak=speak,
    )
    run_once(deps)
    # Audit row written with status='failed' + error tag for greppability.
    assert audit.call_args.kwargs["status"] == "failed"
    assert "executor:" in audit.call_args.kwargs["error"]
    # User hears something — silent failure on backend outage is the worst UX.
    speak.assert_called_once()
    assert "calendar" in speak.call_args.args[0].lower()
    # Wall state ends in "failed", not "applied".
    kinds = [c.kwargs.get("kind") for c in state.call_args_list]
    assert kinds[-1] == "failed"


def test_speak_exception_still_calls_mic_on():
    """If TTS playback raises (BT speaker disconnected mid-play, OSError,
    etc.) the mic MUST reopen — otherwise the wall goes deaf permanently."""
    intent = IntentResult("dinner_set", {"date": "2026-06-04", "meal": "tacos"}, 0.92, "raw")
    speak = MagicMock(side_effect=RuntimeError("BT speaker died"))
    deps, _state, _audit = _make_deps(
        extract_intent=MagicMock(return_value=intent),
        execute=MagicMock(return_value={"ok": True, "spoken": "Saved."}),
        speak=speak,
    )
    try:
        run_once(deps)
    except RuntimeError:
        pass  # expected — exception propagates after mic recovery
    deps.mic_off.assert_called()
    deps.mic_on.assert_called()


def test_play_clip_exception_still_calls_mic_on():
    """Same guarantee for the didn't-catch fallback path: if the MP3 player
    chokes, the mic still reopens."""
    deps, _state, _audit = _make_deps(extract_intent=MagicMock(
        return_value=IntentResult("unknown", {"reason": "no_json"}, 0.0, "raw")
    ))
    deps.play_clip.side_effect = RuntimeError("mpg123 crashed")
    try:
        run_once(deps)
    except RuntimeError:
        pass
    deps.mic_off.assert_called()
    deps.mic_on.assert_called()


def test_hallucination_short_circuits_before_intent_extraction():
    """A Voxtral-style refusal must not reach Haiku — that's the whole point
    of the filter (saves the OpenRouter call + makes audit greppable)."""
    transcribe = MagicMock(return_value="I'm an assistant and can't transcribe audio.")
    extract_intent = MagicMock()
    deps, _state, audit = _make_deps(transcribe=transcribe, extract_intent=extract_intent)
    run_once(deps)
    extract_intent.assert_not_called()
    # Tagged in `error` (status stays in existing enum, no migration).
    assert audit.call_args.kwargs["status"] == "failed"
    assert audit.call_args.kwargs["error"] == "hallucination"
    deps.play_clip.assert_called_once()


def test_muted_skips_wake_and_audit():
    """While muted, run_once must drain the mic but never fire wake, run STT,
    or call Haiku. Previously mute only gated TTS — wake cascades during
    mute still billed OpenRouter for hallucinated transcripts."""
    transcribe = MagicMock()
    extract_intent = MagicMock()
    deps, state, audit = _make_deps(
        transcribe=transcribe, extract_intent=extract_intent,
    )
    deps.muted = lambda: True  # type: ignore[method-assign]
    # Wake never fires while muted, so run_once would block forever.
    # Patch wake.step to fire on the 50th frame so the test can break out
    # — but only AFTER we've shown mute blocks the first 49 attempts.
    call_count = {"n": 0}
    original_step = deps.wake.step

    def step_when_unmuted(f):
        call_count["n"] += 1
        # The mute gate is checked BEFORE wake.step, so this should never be
        # called while muted. If it is, the gate failed.
        raise AssertionError("wake.step called while muted")

    deps.wake.step = step_when_unmuted  # type: ignore[method-assign]
    # Drain ~10 frames worth of muted iteration then unmute + fire wake.
    mute_state = {"on": True, "ticks": 0}

    def muted_fn():
        mute_state["ticks"] += 1
        if mute_state["ticks"] > 10:
            mute_state["on"] = False
            deps.wake.step = lambda _f: True  # type: ignore[method-assign]
        return mute_state["on"]

    deps.muted = muted_fn  # type: ignore[method-assign]
    transcribe.return_value = "tonight's dinner is tacos"
    extract_intent.return_value = IntentResult(
        "dinner_set", {"date": "2026-06-05", "meal": "tacos"}, 0.92, "raw",
    )
    run_once(deps)

    # Confirm we never hit wake.step (the original) while muted — assertion
    # would have fired. After unmute, the lambda fired and pipeline ran.
    transcribe.assert_called_once()
    extract_intent.assert_called_once()


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
