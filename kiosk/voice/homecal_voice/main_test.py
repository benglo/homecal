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
    """The wake LSTM reset MUST fire on every run_once exit path — paths
    that skip _speak (blank/unknown/hallucination/exception) leave the
    LSTM primed by the user's wake phrase and ambient frames cascade into
    repeated false wakes. Pin it so a refactor moving reset back into
    _speak alone can't silently regress."""
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
    """A backend outage during family/chores fetch must surface as a
    distinct spoken error — silent fallback to empty lists makes an outage
    indistinguishable from a real 'unknown person/chore' miss."""
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


def test_speak_skipped_when_spoken_text_is_empty():
    """noise_play matcher hits return spoken="" — the executor played the clip
    already, no TTS is needed. Previously _speak called d.speak("") which 400s
    on OpenRouter and pollutes the journal with phantom TTS failures."""
    intent = IntentResult("noise_play", {"catalog_key": "fart"}, 1.0, "raw")
    speak = MagicMock()
    deps, _state, _audit = _make_deps(
        extract_intent=MagicMock(return_value=intent),
        execute=MagicMock(return_value={"ok": True, "spoken": ""}),
        speak=speak,
    )
    run_once(deps)
    speak.assert_not_called()
    # Mic still untouched — no mic_off/mic_on dance for an empty utterance.
    deps.mic_off.assert_not_called()
    deps.mic_on.assert_not_called()


def test_speak_skipped_when_spoken_text_is_whitespace():
    """Defensive: whitespace-only text would also 400 OpenRouter."""
    intent = IntentResult("dinner_set", {"date": "2026-06-04", "meal": "tacos"}, 0.95, "raw")
    speak = MagicMock()
    deps, _state, _audit = _make_deps(
        extract_intent=MagicMock(return_value=intent),
        execute=MagicMock(return_value={"ok": True, "spoken": "   \n  "}),
        speak=speak,
    )
    run_once(deps)
    speak.assert_not_called()


def test_tts_returns_false_logs_warning_without_crashing(caplog):
    """A cloud TTS read-timeout used to look identical to 'wake word broken'
    from the user's side — they spoke, the action applied silently, no audio
    came back. The bool return + WARNING is the signal that lets ops grep
    `journalctl` for swallowed TTS hiccups instead of debugging from scratch."""
    import logging
    intent = IntentResult("timer_set", {"duration_sec": 60, "label": "pasta"}, 1.0, "raw")
    speak = MagicMock(return_value=False)
    deps, _state, _audit = _make_deps(
        extract_intent=MagicMock(return_value=intent),
        execute=MagicMock(return_value={"ok": True, "spoken": "Pasta timer set for 1 minute."}),
        speak=speak,
    )
    with caplog.at_level(logging.WARNING, logger="homecal_voice.main"):
        run_once(deps)
    speak.assert_called_once()
    # Mic recovery still happens — bool failure must not strand the mic closed.
    deps.mic_off.assert_called()
    deps.mic_on.assert_called()
    assert any("TTS produced no audio" in r.message for r in caplog.records), \
        f"expected WARNING log; got {[r.message for r in caplog.records]}"


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


def test_executor_ok_false_audits_failed_not_applied():
    """An executor that returns ok=False (timer not built, unknown person,
    unknown chore) MUST audit as 'failed' and post-state 'failed' — never
    'applied'. Otherwise the dashboard treats the soft failure as success
    and the matcher hit-rate metric lies."""
    intent = IntentResult("timer_set", {"duration_sec": 600}, 1.0, "raw", source="matcher")
    execute = MagicMock(return_value={
        "ok": False, "spoken": "I can't set timers yet.", "error": "timer_not_built",
    })
    deps, state, audit = _make_deps(
        extract_intent=MagicMock(return_value=intent),
        execute=execute,
    )
    run_once(deps)
    execute.assert_called_once()
    # Wall must NOT flash the green ✓ — it would be lying.
    kinds = [c.kwargs.get("kind") for c in state.call_args_list]
    assert kinds[-1] == "failed"
    assert state.call_args_list[-1].kwargs["payload"]["reason"] == "timer_not_built"
    # Audit row carries failed + the executor's error tag for greppability.
    audit_kwargs = audit.call_args.kwargs
    assert audit_kwargs["status"] == "failed"
    assert audit_kwargs["error"] == "timer_not_built"
    # User still hears the explanation — silent failure on a recognised intent
    # is the worst UX.
    deps.speak.assert_called_once_with("I can't set timers yet.")


def test_ok_false_without_error_field_falls_back_to_generic_tag():
    """Defensive: if a handler returns ok=False without naming the error,
    the audit row still tags something greppable rather than `None`."""
    intent = IntentResult("dinner_set", {"date": "2026-06-05", "meal": "tacos"}, 0.95, "raw")
    execute = MagicMock(return_value={"ok": False, "spoken": "nope"})
    deps, _state, audit = _make_deps(
        extract_intent=MagicMock(return_value=intent), execute=execute,
    )
    run_once(deps)
    assert audit.call_args.kwargs["error"] == "executor_refused"


def test_matcher_high_confidence_auto_applies_no_confirm():
    """The matcher emits confidence 1.0; main.py auto-applies at >=0.85.
    Pin that matcher hits skip the confirm card so a future 'soften matcher
    confidence to 0.8' tweak can't silently route them through confirm."""
    intent = IntentResult(
        "dinner_set", {"date": "2026-06-05", "meal": "curry"}, 1.0, "raw", source="matcher",
    )
    execute = MagicMock(return_value={"ok": True, "spoken": "Got it."})
    deps, state, _audit = _make_deps(
        extract_intent=MagicMock(return_value=intent), execute=execute,
    )
    with patch("homecal_voice.confirm_loop.confirm_listen") as cl:
        run_once(deps)
    cl.assert_not_called()
    kinds = [c.kwargs.get("kind") for c in state.call_args_list]
    assert kinds[-1] == "applied"


def test_audit_threads_source_through():
    """source='matcher'|'llm' must reach post_audit so the audit log can
    quantify matcher hit rate. Pinned here so a refactor of `_audit` can't
    quietly drop the field."""
    intent = IntentResult(
        "dinner_set", {"date": "2026-06-05", "meal": "tacos"}, 1.0, "raw", source="matcher",
    )
    deps, _state, audit = _make_deps(
        extract_intent=MagicMock(return_value=intent),
        execute=MagicMock(return_value={"ok": True, "spoken": "Saved."}),
    )
    run_once(deps)
    assert audit.call_args.kwargs["source"] == "matcher"


def test_audit_source_is_none_when_no_intent():
    """STT/blank/hallucination paths produce no IntentResult — the audit row
    still writes but `source` is None (server-side defaults handle it)."""
    transcribe = MagicMock(side_effect=RuntimeError("whisper-server 503"))
    deps, _state, audit = _make_deps(transcribe=transcribe)
    run_once(deps)
    assert audit.call_args.kwargs["source"] is None


# --- matcher-first wiring --------------------------------------------------


def _fresh_matcher_with_v1():
    """Build an isolated matcher so tests don't share singleton state."""
    from homecal_voice.matcher import Matcher
    from homecal_voice.patterns_v1 import register_v1
    m = Matcher()
    register_v1(m)
    return m


def test_extract_with_matcher_first_returns_matcher_hit_without_calling_llm():
    """When the core regex matches (dinner_set), the LLM must not be called —
    that's the whole point of the matcher (saves the OpenRouter round-trip)."""
    from unittest.mock import patch, MagicMock
    import homecal_voice.main as main_mod
    from homecal_voice.matcher import Matcher
    from homecal_voice.patterns_v1 import register_v1

    cfg = MagicMock(homecal_api_base="http://api", intent_model="x", openrouter_api_key="k")

    # Stub out HTTP calls: family-members + chores return empty lists.
    def _get(url, **kw):
        r = MagicMock()
        r.json.return_value = []
        r.raise_for_status = MagicMock()
        return r

    # Replace staged matchers: empty kid_matcher, isolated core_matcher with v1.
    empty_kid = Matcher()
    isolated_core = Matcher()
    register_v1(isolated_core)
    llm_called = MagicMock()

    with patch.object(main_mod, "kid_matcher", empty_kid):
        with patch.object(main_mod, "core_matcher", isolated_core):
            with patch("homecal_voice.main._requests.get", side_effect=_get):
                with patch.object(main_mod, "call_openrouter", llm_called):
                    out = main_mod._extract_with_matcher_first(
                        text="tonight's dinner is curry", cfg=cfg
                    )

    assert out.intent == "dinner_set"
    assert out.source == "matcher"
    llm_called.assert_not_called()


def test_extract_with_matcher_first_falls_through_to_llm():
    """Unrecognised text must reach Haiku unchanged."""
    from unittest.mock import patch, MagicMock
    import homecal_voice.main as main_mod
    from homecal_voice.matcher import Matcher

    cfg = MagicMock(homecal_api_base="http://api", intent_model="x", openrouter_api_key="k")

    def _get(url, **kw):
        r = MagicMock()
        r.json.return_value = []
        r.raise_for_status = MagicMock()
        return r

    noises_mock = MagicMock()
    noises_mock.entries = {}

    # Empty staged matchers so everything falls through to Haiku.
    with patch.object(main_mod, "kid_matcher", Matcher()):
        with patch.object(main_mod, "core_matcher", Matcher()):
            with patch("homecal_voice.main._requests.get", side_effect=_get):
                with patch.object(main_mod, "call_openrouter",
                                  return_value='{"intent":"unknown","reason":"no_match","confidence":0.0}'):
                    with patch("homecal_voice.catalog.load_noises", return_value=noises_mock):
                        out = main_mod._extract_with_matcher_first(
                            text="please play some music", cfg=cfg
                        )

    assert out.intent == "unknown"
    assert out.source == "llm"


def test_extract_with_matcher_first_propagates_backend_fetch_failure():
    """A 5xx from /api/family-members must propagate out of the matcher path —
    NOT silently fall through to the LLM with empty lists. That's the same
    silent-failure mode the orchestration layer was hardened against; the
    matcher inherits the invariant."""
    from unittest.mock import patch, MagicMock
    import homecal_voice.main as main_mod
    from homecal_voice.matcher import Matcher

    cfg = MagicMock(homecal_api_base="http://api", intent_model="x", openrouter_api_key="k")

    # Empty kid_matcher so we reach stage 2 where the HTTP call happens.
    llm = MagicMock()

    def boom(url, **kw):
        if "/api/family-members" in url:
            raise RuntimeError("backend 503")
        r = MagicMock()
        r.json.return_value = []
        r.raise_for_status = MagicMock()
        return r

    with patch.object(main_mod, "kid_matcher", Matcher()):
        with patch.object(main_mod, "core_matcher", Matcher()):
            with patch("homecal_voice.main._requests.get", side_effect=boom):
                with patch.object(main_mod, "call_openrouter", llm):
                    try:
                        main_mod._extract_with_matcher_first(text="anything", cfg=cfg)
                    except RuntimeError as e:
                        assert "503" in str(e)
                    else:
                        assert False, "expected RuntimeError to propagate"
    llm.assert_not_called()


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


# ---------------------------------------------------------------------------
# Task 12 — per-intent auto-apply confidence threshold map
# ---------------------------------------------------------------------------
import math
from homecal_voice.main import (
    AUTO_APPLY_THRESHOLDS,
    AUTO_APPLY_DEFAULT,
    auto_apply_threshold,
)


def test_default_threshold_is_0_85():
    assert AUTO_APPLY_DEFAULT == 0.85
    assert auto_apply_threshold("dinner_set") == 0.85
    assert auto_apply_threshold("chore_complete") == 0.85
    assert auto_apply_threshold("query_dinner") == 0.85
    assert auto_apply_threshold("query_agenda") == 0.85
    assert auto_apply_threshold("timer_set") == 0.85


def test_ask_question_uses_default_0_85():
    """Wrong-answer-vs-confirm tradeoff: confirm is better than wrong answer."""
    assert auto_apply_threshold("ask_question") == 0.85


def test_noise_play_auto_applies_at_any_confidence():
    """A confirm-card disrupts the gag. Spec §3.9."""
    assert auto_apply_threshold("noise_play") == -math.inf


def test_joke_tell_auto_applies_at_any_confidence():
    assert auto_apply_threshold("joke_tell") == -math.inf


def test_thresholds_map_only_lists_non_defaults():
    """Map should only carry intents that override the default — keeps it tight."""
    assert "ask_question" not in AUTO_APPLY_THRESHOLDS
    assert "dinner_set" not in AUTO_APPLY_THRESHOLDS
    assert AUTO_APPLY_THRESHOLDS["noise_play"] == -math.inf
    assert AUTO_APPLY_THRESHOLDS["joke_tell"] == -math.inf


def test_threshold_map_is_frozen():
    """MappingProxyType prevents runtime tampering via test mocks leaking."""
    from types import MappingProxyType
    assert isinstance(AUTO_APPLY_THRESHOLDS, MappingProxyType)


def test_unknown_intent_uses_default():
    """A future intent that doesn't appear in the map should fall back to 0.85."""
    assert auto_apply_threshold("some_future_intent") == 0.85


# ---------------------------------------------------------------------------
# Task 17 — quiet-hours gate for play_clip
# ---------------------------------------------------------------------------
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock
from homecal_voice.main import _is_quiet_hours, _quiet_safe_play_clip


def test_is_quiet_hours_at_11pm_brisbane_returns_true():
    # 13:00 UTC = 23:00 Brisbane (UTC+10) → quiet
    t = datetime(2026, 6, 6, 13, 0, 0, tzinfo=timezone.utc)
    assert _is_quiet_hours(t) is True


def test_is_quiet_hours_at_8pm_brisbane_returns_true():
    # 10:00 UTC = 20:00 Brisbane → quiet starts inclusive
    t = datetime(2026, 6, 6, 10, 0, 0, tzinfo=timezone.utc)
    assert _is_quiet_hours(t) is True


def test_is_quiet_hours_at_6am_brisbane_returns_true():
    # 20:00 UTC = 06:00 next-day Brisbane → still quiet
    t = datetime(2026, 6, 6, 20, 0, 0, tzinfo=timezone.utc)
    assert _is_quiet_hours(t) is True


def test_is_quiet_hours_at_7am_brisbane_returns_false():
    # 21:00 UTC = 07:00 Brisbane → quiet ENDS exclusive (hour < 7 is the rule)
    t = datetime(2026, 6, 6, 21, 0, 0, tzinfo=timezone.utc)
    assert _is_quiet_hours(t) is False


def test_is_quiet_hours_at_noon_brisbane_returns_false():
    # 02:00 UTC = 12:00 Brisbane → not quiet
    t = datetime(2026, 6, 6, 2, 0, 0, tzinfo=timezone.utc)
    assert _is_quiet_hours(t) is False


def test_is_quiet_hours_at_7pm_brisbane_returns_false():
    # 09:00 UTC = 19:00 Brisbane → not yet quiet
    t = datetime(2026, 6, 6, 9, 0, 0, tzinfo=timezone.utc)
    assert _is_quiet_hours(t) is False


def test_quiet_safe_play_clip_blocks_during_quiet():
    """Quiet hours → wrapper swallows the call entirely. No clip plays."""
    play = MagicMock()
    with patch("homecal_voice.main._is_quiet_hours", return_value=True):
        _quiet_safe_play_clip(play, "/tmp/x.mp3")
    play.assert_not_called()


def test_quiet_safe_play_clip_allows_during_day():
    play = MagicMock()
    with patch("homecal_voice.main._is_quiet_hours", return_value=False):
        _quiet_safe_play_clip(play, "/tmp/x.mp3")
    play.assert_called_once_with("/tmp/x.mp3")


def test_quiet_safe_play_clip_returns_True_when_played():
    play = MagicMock()
    with patch("homecal_voice.main._is_quiet_hours", return_value=False):
        result = _quiet_safe_play_clip(play, "/tmp/x.mp3")
    assert result is True
    play.assert_called_once()


def test_quiet_safe_play_clip_returns_False_when_suppressed():
    play = MagicMock()
    with patch("homecal_voice.main._is_quiet_hours", return_value=True):
        result = _quiet_safe_play_clip(play, "/tmp/x.mp3")
    assert result is False
    play.assert_not_called()


# ---------------------------------------------------------------------------
# _gather_dinner_and_agenda
# ---------------------------------------------------------------------------

from homecal_voice.main import _gather_dinner_and_agenda


def test_gather_dinner_and_agenda_returns_meal_and_agenda():
    """Mocks dinners + events GETs; helper composes the prompt-ready dict."""
    def _get_side_effect(url, **_):
        r = MagicMock()
        if "/api/dinners" in url:
            r.json.return_value = [{"date": "2026-06-07", "meal": "Tacos"}]
        elif "/api/events" in url:
            r.json.return_value = [
                {"title": "Swimming", "start": "2026-06-07T07:00:00Z"},
                {"title": "Birthday party", "start": "2026-06-07T05:00:00Z"},
            ]
        else:
            raise AssertionError(f"unexpected fetch: {url}")
        r.raise_for_status = MagicMock()
        return r

    with patch("homecal_voice.main._requests.get", side_effect=_get_side_effect):
        ctx = _gather_dinner_and_agenda(api_base="http://x", today="2026-06-07")

    assert ctx["today_dinner"] == "Tacos"
    assert any("Swimming" in line for line in ctx["today_agenda"])


def test_gather_dinner_and_agenda_no_dinner_today_returns_none_string():
    def _get_side_effect(url, **_):
        r = MagicMock()
        r.json.return_value = []
        r.raise_for_status = MagicMock()
        return r
    with patch("homecal_voice.main._requests.get", side_effect=_get_side_effect):
        ctx = _gather_dinner_and_agenda(api_base="http://x", today="2026-06-07")
    assert ctx["today_dinner"] == "(none)"
    assert ctx["today_agenda"] == []


def test_gather_dinner_and_agenda_propagates_http_error_on_events():
    """An outage on /api/events must NOT silently fall back to [] — same
    reasoning as _list_bare: an empty agenda vs a real outage need distinct
    audit signals."""
    def _get_side_effect(url, **_):
        if "/api/events" in url:
            raise RuntimeError("backend unreachable")
        r = MagicMock()
        r.json.return_value = []
        r.raise_for_status = MagicMock()
        return r

    import pytest
    with patch("homecal_voice.main._requests.get", side_effect=_get_side_effect):
        with pytest.raises(Exception):
            _gather_dinner_and_agenda(api_base="http://x", today="2026-06-07")


# ---------------------------------------------------------------------------
# Three-stage matcher routing
# ---------------------------------------------------------------------------

def test_matcher_first_routing_kid_hit_does_not_fetch_anything():
    """A noise_play matcher hit must not hit the backend at all —
    /api/family-members, /api/chores, /api/dinners, /api/events all
    untouched. Backend outage doesn't kill noise."""
    from unittest.mock import patch, MagicMock
    import homecal_voice.main as main_mod
    from homecal_voice.matcher import Matcher
    from homecal_voice.patterns_kid import register_kid
    from homecal_voice.main import _extract_with_matcher_first

    cfg = MagicMock()
    cfg.homecal_api_base = "http://api"
    cfg.intent_model = "claude-haiku-4.5"
    cfg.openrouter_api_key = "k"

    # Build an isolated kid_matcher with patterns registered.
    isolated_kid = Matcher()
    register_kid(isolated_kid)

    with patch.object(main_mod, "kid_matcher", isolated_kid):
        with patch("homecal_voice.main._requests.get") as get_call:
            result = _extract_with_matcher_first(text="make a chicken noise", cfg=cfg)

    assert result.intent == "noise_play"
    assert result.source == "matcher"
    get_call.assert_not_called()


def test_matcher_first_routing_core_hit_fetches_only_family_and_chores():
    """A query_dinner matcher hit fetches family + chores (needed for the
    matcher) but NOT dinners + events (those are LLM-only)."""
    from unittest.mock import patch, MagicMock
    import homecal_voice.main as main_mod
    from homecal_voice.matcher import Matcher
    from homecal_voice.patterns_v1 import register_v1
    from homecal_voice.main import _extract_with_matcher_first

    cfg = MagicMock()
    cfg.homecal_api_base = "http://api"
    cfg.intent_model = "claude-haiku-4.5"
    cfg.openrouter_api_key = "k"

    # Empty kid_matcher so stage 1 always misses; isolated core_matcher with v1.
    isolated_core = Matcher()
    register_v1(isolated_core)

    def _get(url, **kw):
        r = MagicMock()
        if "/api/family-members" in url:
            r.json.return_value = [{"id": "fm1", "name": "Imogen"}]
        elif "/api/chores" in url:
            r.json.return_value = []
        else:
            raise AssertionError(f"unexpected fetch on core-matcher path: {url}")
        r.raise_for_status = MagicMock()
        return r

    with patch.object(main_mod, "kid_matcher", Matcher()):
        with patch.object(main_mod, "core_matcher", isolated_core):
            with patch("homecal_voice.main._requests.get", side_effect=_get):
                result = _extract_with_matcher_first(text="what's for dinner tonight", cfg=cfg)
    assert result.intent == "query_dinner"


def test_matcher_first_routing_llm_path_fetches_everything():
    """An ask_question (matcher miss on both stages) goes through the LLM
    and fetches family+chores AND dinners+events. The pre-existing tests
    cover the Haiku call; this test just confirms the fetch happens."""
    from unittest.mock import patch, MagicMock
    import homecal_voice.main as main_mod
    from homecal_voice.matcher import Matcher
    from homecal_voice.main import _extract_with_matcher_first

    cfg = MagicMock()
    cfg.homecal_api_base = "http://api"
    cfg.intent_model = "claude-haiku-4.5"
    cfg.openrouter_api_key = "k"

    calls = []

    def _get(url, **kw):
        calls.append(url)
        r = MagicMock()
        r.json.return_value = []
        r.raise_for_status = MagicMock()
        return r

    # Empty both matchers so everything falls through to Haiku.
    with patch.object(main_mod, "kid_matcher", Matcher()):
        with patch.object(main_mod, "core_matcher", Matcher()):
            with patch("homecal_voice.main._requests.get", side_effect=_get):
                with patch("homecal_voice.main.call_openrouter", return_value='{"intent":"unknown","reason":"x","confidence":0.5}'):
                    _extract_with_matcher_first(text="why is the sky so blue today", cfg=cfg)

    fetched = " ".join(calls)
    assert "/api/family-members" in fetched
    assert "/api/chores" in fetched
    assert "/api/dinners" in fetched
    assert "/api/events" in fetched


# ---------------------------------------------------------------------------
# Fix E — Group 2: audit row shape on ok=False
# ---------------------------------------------------------------------------


def test_audit_on_ok_false_populates_intent_name_but_not_answer_concern():
    """When the executor soft-fails, the audit row must record intent_name
    (so 'which kind of intent failed' is queryable) but leave answer and
    concern as None — those represent the spoken response and concern flag,
    which don't exist on a failure."""
    from unittest.mock import MagicMock
    from homecal_voice.server_state import post_audit

    with patch("homecal_voice.server_state.requests") as r:
        post_audit(
            base="http://x", token="t", id="u1",
            transcript="make a dolphin noise", status="failed",
            intent_json='{"intent":"noise_play"}', confidence=0.9,
            duration_ms=200, error="unknown_catalog_key:dolphin",
            source="llm",
            intent_name="noise_play",   # explicitly set on failure
            answer=None,                # NOT populated — kid heard nothing
            concern=None,               # NOT applicable to noise_play
        )
    body = r.post.call_args.kwargs.get("json")
    assert body["intent_name"] == "noise_play"
    assert body["status"] == "failed"
    assert "answer" not in body  # post_audit omits None kwargs
    assert "concern" not in body


def test_audit_on_quiet_hours_suppression_records_truth():
    """The quiet-hours soft-failure must be greppable in the audit log so a
    parent reviewing 'why did the chicken not play at 11pm' can find it.
    intent_name=noise_play, status=failed, error=quiet_hours_suppressed."""
    from unittest.mock import MagicMock
    from homecal_voice.server_state import post_audit

    with patch("homecal_voice.server_state.requests") as r:
        post_audit(
            base="http://x", token="t", id="u2",
            transcript="make a chicken noise", status="failed",
            intent_json='{"intent":"noise_play"}', confidence=1.0,
            duration_ms=100, error="quiet_hours_suppressed",
            source="matcher",
            intent_name="noise_play",
            answer=None, concern=None,
        )
    body = r.post.call_args.kwargs.get("json")
    assert body["error"] == "quiet_hours_suppressed"
    assert body["intent_name"] == "noise_play"


# ---------------------------------------------------------------------------
# Fix E — Group 3d: _gather_dinner_and_agenda partial failure
# ---------------------------------------------------------------------------


def test_gather_dinner_and_agenda_propagates_partial_failure_on_dinners():
    """One endpoint failing must propagate — silent fall-back to (none)
    makes a real outage look like 'no dinner today'."""
    from unittest.mock import MagicMock
    from homecal_voice.main import _gather_dinner_and_agenda
    import pytest

    def _get(url, **kw):
        if "/api/dinners" in url:
            r = MagicMock()
            r.raise_for_status.side_effect = RuntimeError("dinners 500")
            return r
        r = MagicMock()
        r.json.return_value = []
        r.raise_for_status = MagicMock()
        return r

    with patch("homecal_voice.main._requests.get", side_effect=_get):
        with pytest.raises(RuntimeError, match="dinners 500"):
            _gather_dinner_and_agenda(api_base="http://x", today="2026-06-07")


def test_gather_dinner_and_agenda_propagates_partial_failure_on_events():
    from unittest.mock import MagicMock
    from homecal_voice.main import _gather_dinner_and_agenda
    import pytest

    def _get(url, **kw):
        if "/api/events" in url:
            r = MagicMock()
            r.raise_for_status.side_effect = RuntimeError("events 500")
            return r
        r = MagicMock()
        r.json.return_value = []
        r.raise_for_status = MagicMock()
        return r

    with patch("homecal_voice.main._requests.get", side_effect=_get):
        with pytest.raises(RuntimeError, match="events 500"):
            _gather_dinner_and_agenda(api_base="http://x", today="2026-06-07")
