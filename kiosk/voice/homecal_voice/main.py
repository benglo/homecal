"""Top-level orchestration loop for the Pi voice service.

Per utterance:
    wake -> record -> STT -> intent -> (auto-apply | confirm | silent-fail)
    Confirmation loop listens 5s for yes/no/edit/ambiguous.

Heartbeat thread + mute SSE listener run as daemons; SIGTERM drains the
mic and exits cleanly.
"""

import logging
import math
import re
import signal
import sys
import time
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from types import MappingProxyType
from typing import Callable

import requests as _requests
from uuid_utils import uuid7

from homecal_voice.config import load_config
from homecal_voice.intent import (
    IntentResult,
    build_system_prompt,
    parse_intent_response,
    call_openrouter,
)
from homecal_voice.matcher import MatchContext, kid_matcher, core_matcher
from homecal_voice.timezone import today_brisbane, BRISBANE_OFFSET_SECONDS, is_quiet_hours
from homecal_voice import catalog as kid_catalog

log = logging.getLogger("homecal_voice.main")

# Tunables centralised at the top so future operators don't grep the file.

# Per-intent auto-apply confidence floor. Default is `AUTO_APPLY_DEFAULT`;
# the override map only lists intents that DIFFER from the default to keep
# the table tight. `noise_play` and `joke_tell` auto-apply at ANY confidence
# — a confirm-card disrupts the gag, and the matcher emits 1.0 on catalog
# hits anyway. MappingProxyType is read-only at runtime, which blocks
# test-mock leakage between cases.
AUTO_APPLY_DEFAULT = 0.85
AUTO_APPLY_THRESHOLDS = MappingProxyType({
    "noise_play": -math.inf,
    "joke_tell": -math.inf,
    # Calendar writes are higher-stakes than dinner/chores — always show the
    # confirm card. +inf means it never clears the auto-apply bar, so it always
    # falls into the confirm branch (still silent-fails below 0.6 confidence).
    "event_add": math.inf,
})
SILENT_FAIL_CONFIDENCE = 0.6


def auto_apply_threshold(intent_name: str) -> float:
    return AUTO_APPLY_THRESHOLDS.get(intent_name, AUTO_APPLY_DEFAULT)
HEARTBEAT_INTERVAL_SEC = 30
CAP_COOLDOWN_SEC = 60
MUTE_CACHE_TTL_SEC = 5
SSE_RECONNECT_DELAY_SEC = 5
LIST_FETCH_TIMEOUT_SEC = 5
STATUS_FETCH_TIMEOUT_SEC = 3
HEARTBEAT_TS_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


@dataclass
class OneShotDeps:
    next_frame: Callable
    wake: object
    endpointer: object
    endpointer_factory: Callable
    transcribe: Callable
    extract_intent: Callable
    execute: Callable
    speak: Callable
    post_state: Callable
    post_audit: Callable
    utterance_id: Callable[[], str]
    muted: Callable[[], bool]
    # Mic is fully closed during playback (TTS or clip) — the pw-record pipe
    # would otherwise buffer playback echo and cascade post-reply wakes.
    mic_off: Callable
    mic_on: Callable
    play_clip: Callable
    # LAN sidecar TTS + play-bytes (added for the fallback ladder).
    # speak_lan: (text) -> (bytes, int) | raises  — cfg is captured in the lambda
    # speak_cloud: existing cloud TTS path (bool return); aliased from `speak`
    # play_bytes: (audio: bytes, format: str) -> None
    # cfg: passed so _speak can call _under_tts_cap without re-reading env vars.
    speak_lan: Callable
    speak_cloud: Callable
    play_bytes: Callable
    cfg: object


def _intent_payload(intent: IntentResult) -> dict:
    return {"intent": intent.intent, **intent.fields, "confidence": intent.confidence}


# Whisper sentinel outputs on silence/noise; never real speech.
_BLANK_TRANSCRIPTS = {"", "[blank_audio]", "[ blank_audio ]"}

# Whisper's parenthesised stage directions ("(wind blowing)", "[silence]") are
# artefacts of training on subtitled video. Whole-string match so "(yes)"
# inside a real reply still flows through.
_PAREN_HALLUCINATION = re.compile(r"^\s*[\(\[][^\)\]]+[\)\]]\.?\s*$")

# Cloud audio models (gpt-audio-mini, Voxtral, Gemini Flash) sometimes
# *answer* an audio question instead of transcribing it, or refuse with a
# stock chat reply. These never appear in real spoken commands so we filter
# them before the intent stage — otherwise we waste a Haiku call on the
# refusal text and the audit log can't distinguish hallucination from a
# genuine "unknown intent". Substring match against lowercased transcript;
# patterns chosen from observed live outputs.
_HALLUCINATION_FRAGMENTS = (
    "i'm an assistant",
    "i'm here to help",
    "i'm sorry, but i can",
    "i don't have the capability",
    "i don't have real-time information",
    "please provide the audio",
    "please go ahead and upload",
    "please upload",
    "as an ai",
    "i cannot transcribe",
    "i can't transcribe",
    "i can't listen",
    "no audio is provided",
    "no audio provided",
)


def _is_blank_transcript(t: str) -> bool:
    if not t:
        return True
    norm = t.strip().lower()
    if norm in _BLANK_TRANSCRIPTS:
        return True
    if _PAREN_HALLUCINATION.match(t):
        return True
    return not any(c.isalnum() for c in norm)


def _is_hallucination(t: str) -> bool:
    """True if the transcript matches a known refusal/meta-chat pattern that
    cloud audio models emit instead of transcribing. Run this AFTER the
    blank check (real silence is blank, not a refusal)."""
    if not t:
        return False
    norm = t.strip().lower()
    return any(frag in norm for frag in _HALLUCINATION_FRAGMENTS)


def _is_quiet_hours(now: datetime | None = None) -> bool:
    """Thin shim — delegates to the shared helper in homecal_voice.timezone.

    Kept here so existing call sites (_quiet_safe_play_clip) don't need
    touching; the logic lives in timezone.is_quiet_hours to break the
    main → executor circular import that would result from executor importing
    directly from main."""
    return is_quiet_hours(now)


def _quiet_safe_play_clip(play_clip, path: str) -> bool:
    """Play the clip unless we're inside the quiet window.

    Returns True if the clip actually played, False if the quiet-hours gate
    suppressed it. The caller is responsible for audit + UI honesty when
    False — we must NOT pretend the kid heard a fart noise at 11pm.
    """
    if _is_quiet_hours():
        log.info("quiet hours: suppressed play_clip(%s)", path)
        return False
    play_clip(path)
    return True


def run_once(d: OneShotDeps) -> None:
    """Block until one wake → utterance → confirmation cycle completes."""
    # Mute gates the whole pipeline (STT/intent/TTS), not just TTS — frames
    # still drain so the pw-record pipe doesn't back up.
    while True:
        f = d.next_frame()
        if d.muted():
            # Drop any trigger that arrived while muted — tap-to-talk must not
            # queue up and fire the instant the user unmutes.
            _listen_trigger.clear()
            continue
        if _listen_trigger.is_set():
            _listen_trigger.clear()
            break
        if d.wake.step(f):
            break

    try:
        _run_after_wake(d)
    finally:
        # Reset on EVERY exit (not just TTS) — otherwise paths that skip
        # _speak (blank, unknown, hallucination, error) leave the wake LSTM
        # primed by the user's "Hey Mycroft" and ambient frames cascade.
        reset = getattr(d.wake, "reset", None)
        if callable(reset):
            reset()


def _run_after_wake(d: OneShotDeps) -> None:
    # A tap during this cycle must be dropped, not queued for the next loop.
    _listen_trigger.clear()
    uid = d.utterance_id()
    d.post_state(utterance_id=uid, kind="listening", payload={"vu": 0.0})

    # 2) capture the utterance
    while True:
        f = d.next_frame()
        if d.endpointer.feed(f):
            break
    pcm = d.endpointer.audio()

    started_ms = int(time.time() * 1000)

    def _elapsed() -> int:
        return int(time.time() * 1000) - started_ms

    # Side-channel dict for tts provider/latency captured inside _speak and
    # forwarded to the audit row that immediately follows each _speak call.
    # Closure dict (not a dataclass attr) keeps the coupling local to this
    # frame so other run_once invocations don't bleed state.
    _last_tts: dict = {}

    def _audit(
        transcript: str,
        status: str,
        intent: IntentResult | None,
        error: str | None = None,
        *,
        answer: str | None = None,
        concern: bool | None = None,
        tts_provider: str | None = None,
        tts_latency_ms: int | None = None,
    ) -> None:
        d.post_audit(
            id=uid,
            transcript=transcript,
            status=status,
            intent_json=intent.raw if intent else None,
            confidence=intent.confidence if intent else None,
            duration_ms=_elapsed(),
            error=error,
            source=intent.source if intent else None,
            intent_name=intent.intent if intent else None,
            answer=answer,
            concern=concern,
            tts_provider=tts_provider,
            tts_latency_ms=tts_latency_ms,
        )

    def _speak(text: str) -> None:
        """LAN → cloud (capped) → clip → silent fallback ladder.

        Closes the mic for the entire playback window so the pw-record pipe
        cannot buffer echo and cascade post-reply wakes. try/finally ensures
        mic_on fires even when playback raises.

        Empty/whitespace text is a no-op — matcher-hit handlers like noise_play
        return spoken="" and the cloud path would 400 on an empty body.

        After returning, _last_tts carries {"provider": ..., "latency_ms": ...}
        so the _audit call that follows can tag the row with TTS metadata."""
        if not text or not text.strip():
            return

        d.mic_off()
        provider: str | None = None
        latency_ms: int | None = None
        played = False

        try:
            # 1. LAN sidecar (preferred — lower latency, no cloud spend).
            # Only tried when TTS_BACKEND=lan; cloud-only deploys skip this
            # branch entirely so a missing sidecar doesn't pay a 3s timeout
            # per utterance during the validation window (spec §12.3).
            if d.cfg.tts_backend == "lan" and lan_reachable():
                try:
                    t0 = time.time()
                    audio, _synth_ms = d.speak_lan(text)
                    d.play_bytes(audio, "wav")
                    latency_ms = int((time.time() - t0) * 1000)
                    provider = "kokoro_lan"
                    mark_lan_attempt(success=True)
                    played = True
                except (_requests.RequestException, _requests.exceptions.ConnectionError) as e:
                    log.warning("LAN TTS failed (%s); falling back to cloud", e)
                    mark_lan_attempt(success=False)

            # 2. Cloud fallback (existing speak path), capped per day to
            # prevent a stuck sidecar silently burning the OpenRouter budget.
            if not played and _under_tts_cap(d.cfg):
                ok = d.speak_cloud(text)
                if ok:
                    provider = "openrouter"
                    played = True

            # 3. Clip fallback — always available, no network dependency.
            if not played:
                from homecal_voice.tts import CLIP_DIDNT_CATCH
                d.play_clip(CLIP_DIDNT_CATCH)
                provider = "clip"
                log.warning("TTS produced no audio — fell to didnt_catch for: %r", text[:120])

            time.sleep(2.0)
        finally:
            d.mic_on()

        _last_tts["provider"] = provider
        _last_tts["latency_ms"] = latency_ms

    def _play_didnt_catch() -> None:
        """Audible fallback when STT was blank/hallucinated/unintelligible.
        Same mic-off dance + try/finally guarantee as _speak."""
        from homecal_voice.tts import CLIP_DIDNT_CATCH
        d.mic_off()
        try:
            d.play_clip(CLIP_DIDNT_CATCH)
            time.sleep(2.0)
        finally:
            d.mic_on()

    # We can't gate STT on `had_speech` because Silero is unreliable on the
    # current mic (energy-RMS catches what Silero misses but neither is
    # perfectly trustworthy). Send every wake to STT; let the blank +
    # hallucination filters below drop the noise.
    d.post_state(utterance_id=uid, kind="thinking", payload={"transcript_partial": ""})

    try:
        transcript = d.transcribe(pcm)
    except Exception as e:
        log.warning("STT failed: %s", e)
        d.post_state(utterance_id=uid, kind="failed", payload={"reason": "stt_error"})
        _audit("", "failed", None, error=f"stt:{e}")
        return

    # Backend Zod requires transcript.length >= 1; sentinel-substitute the
    # blank case so the audit row still writes.
    if _is_blank_transcript(transcript):
        d.post_state(utterance_id=uid, kind="idle", payload={})
        _audit(transcript or "[blank]", "silent_low_conf", None)
        _play_didnt_catch()
        return

    # Cloud audio models occasionally answer the user instead of transcribing
    # ("I'm an assistant..."). Stop before Haiku — those calls cost real money
    # and the audit log loses signal if hallucinations are bucketed with
    # genuine low-confidence intents. Status stays in the existing enum
    # (`failed`) but `error="hallucination"` tags the row for cost attribution
    # without needing a backend migration.
    if _is_hallucination(transcript):
        log.info("hallucination filtered: %r", transcript[:80])
        d.post_state(utterance_id=uid, kind="idle", payload={})
        _audit(transcript, "failed", None, error="hallucination")
        _play_didnt_catch()
        return

    # Surface what we heard on the wall band now that STT is done (the earlier
    # thinking post had no transcript yet).
    d.post_state(utterance_id=uid, kind="thinking", payload={"transcript_partial": transcript})

    # extract_intent fetches family/chores from the backend to build the
    # prompt. A backend outage here used to silently return empty lists
    # → Haiku said "I don't know that person" indistinguishably from a
    # real miss. Now we surface the failure as a distinct audible state.
    try:
        intent = d.extract_intent(transcript)
    except Exception as e:
        log.warning("intent extraction failed: %s", e)
        d.post_state(utterance_id=uid, kind="failed", payload={"reason": "intent_error"})
        _audit(transcript, "failed", None, error=f"intent:{e}")
        _speak("Sorry, I couldn't reach the calendar.")
        return

    if intent.intent == "unknown" or intent.confidence < SILENT_FAIL_CONFIDENCE:
        d.post_state(utterance_id=uid, kind="idle", payload={})
        _audit(transcript, "silent_low_conf", intent)
        _play_didnt_catch()
        return

    def _try_execute(audit_status: str) -> None:
        """Call the executor, branch on its `ok` flag, and audit accordingly.

        Three outcomes:
        - exception: backend unreachable; audit `failed`, speak generic error.
        - ok=False:  executor refused (unknown person/chore, feature not
                     built); audit `failed` with the executor's error string,
                     post-state `failed` — must NOT flash the green ✓ or the
                     audit log becomes a false-success oracle.
        - ok=True:   post-state `applied` first (chip's ✓ flash runs while TTS
                     plays), then _speak, then audit with tts_provider tagged.
        """
        try:
            out = d.execute(intent)
        except Exception as e:
            log.warning("executor failed: %s", e)
            d.post_state(utterance_id=uid, kind="failed", payload={"reason": "executor_error"})
            _audit(transcript, "failed", intent, error=f"executor:{e}")
            _speak("Sorry, I couldn't reach the calendar.")
            return
        if not out.get("ok", False):
            # Distinguish "couldn't act" from "did act" — the wall state and
            # audit row both need to reflect the soft failure so hit-rate
            # metrics don't double-count and the dashboard doesn't lie.
            err = out.get("error") or "executor_refused"
            # Quiet-hours suppression is a polite decline, not an error.
            # Use a distinct reason so the wall chip can render appropriately,
            # and avoid the "didn't catch that" copy in the failed-state label.
            state_kind = "failed"
            state_reason = err
            if out.get("quiet_suppressed"):
                state_kind = "failed"
                state_reason = "quiet_hours"
            d.post_state(utterance_id=uid, kind=state_kind, payload={"reason": state_reason})
            _audit(transcript, "failed", intent, error=err)
            _speak(out.get("spoken", ""))
            return
        # ✓ flash fires immediately; TTS plays while the wall is already green.
        d.post_state(utterance_id=uid, kind="applied",
                     payload={"intent": _intent_payload(intent), "reply": out.get("spoken", "")})
        if not out.get("spoken_inline"):
            _speak(out.get("spoken", ""))
        # Prefer the executor's tts_provider hint (set when the catalog played
        # audio directly without going through _speak). Fall back to _last_tts
        # which is populated only when _speak ran. Latency is only meaningful
        # on the _speak path — catalog plays don't have a synthesis round-trip.
        audit_provider = out.get("tts_provider") or _last_tts.get("provider")
        audit_latency = _last_tts.get("latency_ms")
        _audit(
            transcript, audit_status, intent,
            answer=out.get("spoken") or None,
            concern=out.get("concern"),
            error="regex_override" if out.get("regex_override") else None,
            tts_provider=audit_provider,
            tts_latency_ms=audit_latency,
        )

    if intent.confidence >= auto_apply_threshold(intent.intent):
        _try_execute("applied")
        return

    # 6) mid-confidence: confirm card + 5s yes/no listen
    d.post_state(
        utterance_id=uid,
        kind="confirming",
        payload={"intent": _intent_payload(intent), "transcript": transcript},
    )
    _audit(transcript, "pending", intent)

    from homecal_voice.confirm_loop import confirm_listen
    outcome = confirm_listen(
        next_frame=d.next_frame,
        endpointer_factory=d.endpointer_factory,
        transcribe=d.transcribe,
    )

    if outcome.kind == "yes":
        _try_execute("confirmed")
        return

    if outcome.kind == "no":
        _speak("Cancelled.")
        d.post_state(utterance_id=uid, kind="failed", payload={"reason": "no"})
        _audit(transcript, "cancelled", intent)
        return

    if outcome.kind == "timeout":
        # Distinct from "no" so the audit log shows why the action didn't happen.
        # Tell the user out loud — silence + a green confirm card disappearing is
        # the worst possible UX for "did it save or not?".
        _speak("I didn't hear a yes or no — cancelled.")
        d.post_state(utterance_id=uid, kind="failed", payload={"reason": "timeout"})
        _audit(transcript, "cancelled", intent)
        return

    # outcome.kind in ("edit", "ambiguous") → audit stays "pending" from the
    # earlier write. Give a short audible cue so the user knows the system
    # heard them but didn't act. PendingReviewTray (future UI) will surface
    # this row for later resolution; for now the audit log is the trail.
    _speak("I didn't catch that — say yes or no.")
    d.post_state(utterance_id=uid, kind="failed", payload={"reason": outcome.kind})


_shutdown = False

# Set by the SSE thread when the wall taps tap-to-talk; consumed (and cleared)
# by run_once to start a listen cycle without the wake word.
_listen_trigger = threading.Event()


def _on_sigterm(*_):
    global _shutdown
    _shutdown = True
    log.info("SIGTERM received; shutting down")


def _play_audio_bytes(audio: bytes, format: str) -> None:  # noqa: A002
    """Write raw audio bytes to a tempfile and play it with the detected player.

    Mirrors the post-synth playback path in tts.speak() but for raw bytes so
    the LAN sidecar path (which returns WAV bytes directly) doesn't need to
    go through the cloud speak() wrapper. `delete=False` + explicit unlink
    matches the pattern in tts.speak to avoid /tmp leaks."""
    import os
    import subprocess
    import tempfile
    from homecal_voice.tts import _detect_player
    player = _detect_player()
    if player is None:
        log.warning("no audio player available; cannot play %s bytes", len(audio))
        return
    path = None
    try:
        suffix = f".{format}"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(audio)
            path = f.name
        subprocess.run([*player, path], check=False)
    finally:
        if path is not None:
            try:
                os.unlink(path)
            except OSError as e:
                log.debug("could not unlink audio tempfile %s: %s", path, e)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    cfg = load_config()
    signal.signal(signal.SIGTERM, _on_sigterm)
    signal.signal(signal.SIGINT, _on_sigterm)

    from homecal_voice.mic import MicStream
    from homecal_voice.wake import WakeDetector, load_default_model
    from homecal_voice.endpointer import Endpointer, load_silero_vad
    from homecal_voice.stt import transcribe_with_fallback as stt_transcribe
    from homecal_voice.tts import speak as tts_speak, play_file as tts_play_file, synthesize_lan as tts_synthesize_lan, fetch_catalog as tts_fetch_catalog
    from homecal_voice.executor import Executor
    from homecal_voice.server_state import post_state, post_audit, post_heartbeat
    from homecal_voice.patterns_v1 import register_v1
    from homecal_voice.patterns_timer import register_timer
    from homecal_voice.patterns_kid import register_kid

    # Register patterns once at startup against the staged matchers.
    # kid_matcher runs at stage 1 (catalog-only, no backend calls).
    # core_matcher runs at stage 2 (needs family + chores).
    # Order within core_matcher: v1 first so "tonight's dinner is X" beats
    # any future timer pattern that captures the same shape.
    register_kid(kid_matcher)
    register_v1(core_matcher)
    register_timer(core_matcher)

    mic = MicStream(device=cfg.audio_device)
    mic.start()
    # `frame_iter` is rebound whenever we restart pw-record (during TTS) — the
    # old generator becomes invalid once its subprocess dies. Hold it in a
    # one-element list so closures keep seeing the live iterator.
    frame_iter_ref = [mic.frames()]

    def mic_off() -> None:
        mic.stop()

    def mic_on() -> None:
        mic.start()
        frame_iter_ref[0] = mic.frames()
    # load_default_model returns (Model, scoring_key); the versioned key
    # (e.g. 'hey_mycroft_v0.1') is what Model.predict() returns scores under.
    wake_model, wake_key = load_default_model(cfg.wake_word)
    wake = WakeDetector(
        model=wake_model,
        wake_name=wake_key,
        threshold=cfg.wake_threshold,
        trigger_level=cfg.wake_trigger_level,
    )
    endpointer_factory = lambda: Endpointer(
        vad=load_silero_vad(),
        vad_gain=cfg.vad_gain,
        energy_rms_threshold=cfg.energy_rms_threshold,
    )
    executor = Executor(
        base=cfg.homecal_api_base,
        token=cfg.pi_api_token,
        play_clip=lambda path: _quiet_safe_play_clip(tts_play_file, path),
        speak=lambda text: tts_speak(
            text,
            model=cfg.tts_model,
            voice=cfg.tts_voice,
            api_key=cfg.openrouter_api_key,
            muted=is_muted_locally(cfg),
        ),
        sleep=time.sleep,
        play_bytes=lambda audio, fmt: _play_audio_bytes(audio, fmt),
        fetch_catalog=lambda kind, key: tts_fetch_catalog(
            kind, key,
            server_url=cfg.tts_server_url,
            token=cfg.pi_api_token,
            timeout_s=cfg.tts_server_timeout_s,
        ),
    )

    _start_mute_sse(cfg)

    def _hb():
        while not _shutdown:
            try:
                post_heartbeat(
                    base=cfg.homecal_api_base,
                    token=cfg.pi_api_token,
                    at=time.strftime(HEARTBEAT_TS_FORMAT, time.gmtime()),
                )
            except Exception as e:
                log.warning("heartbeat failed: %s", e)
            time.sleep(HEARTBEAT_INTERVAL_SEC)

    threading.Thread(target=_hb, daemon=True).start()

    counter = {"day": "", "count": 0}

    def _under_cap() -> bool:
        today = today_brisbane()
        if counter["day"] != today:
            counter.update(day=today, count=0)
        counter["count"] += 1
        return counter["count"] <= cfg.daily_request_cap

    try:
        while not _shutdown:
            ep = endpointer_factory()
            deps = OneShotDeps(
                next_frame=lambda: next(frame_iter_ref[0]),
                wake=wake,
                endpointer=ep,
                endpointer_factory=endpointer_factory,
                transcribe=lambda pcm: stt_transcribe(
                    pcm,
                    openrouter_api_key=cfg.openrouter_api_key,
                    openrouter_model=cfg.stt_model,
                    whisper_server_url=cfg.whisper_server_url,
                ),
                extract_intent=lambda text: _extract_with_matcher_first(
                    text=text,
                    cfg=cfg,
                ),
                execute=executor.apply,
                speak=lambda text: tts_speak(
                    text,
                    model=cfg.tts_model,
                    voice=cfg.tts_voice,
                    api_key=cfg.openrouter_api_key,
                    muted=is_muted_locally(cfg),
                ),
                post_state=lambda **kw: post_state(base=cfg.homecal_api_base, token=cfg.pi_api_token, **kw),
                post_audit=lambda **kw: post_audit(base=cfg.homecal_api_base, token=cfg.pi_api_token, **kw),
                utterance_id=lambda: str(uuid7()),
                muted=lambda: is_muted_locally(cfg),
                mic_off=mic_off,
                mic_on=mic_on,
                play_clip=tts_play_file,
                # LAN sidecar: cfg fields captured in the lambda so speak_lan
                # receives only `text`; the test mocks just assert called_once().
                speak_lan=lambda text: tts_synthesize_lan(
                    text,
                    server_url=cfg.tts_server_url,
                    token=cfg.pi_api_token,
                    voice=cfg.tts_voice,
                    timeout_s=cfg.tts_server_timeout_s,
                ),
                speak_cloud=lambda text: tts_speak(
                    text,
                    model=cfg.tts_model,
                    voice=cfg.tts_voice,
                    api_key=cfg.openrouter_api_key,
                    muted=is_muted_locally(cfg),
                ),
                play_bytes=lambda audio, format: _play_audio_bytes(audio, format),
                cfg=cfg,
            )
            if not _under_cap():
                log.warning("daily request cap %d reached; sleeping", cfg.daily_request_cap)
                time.sleep(CAP_COOLDOWN_SEC)
                continue
            run_once(deps)
    finally:
        mic.stop()
    return 0


def _list_bare(url: str) -> list:
    """GET a list endpoint and tolerate either a bare array or {data:[...]}.

    Propagates network/HTTP failures so the caller can audit them and tell
    the user we can't reach the calendar. Previously this swallowed errors
    and returned [] — Haiku then saw empty family/chores and reported
    "unknown person/chore" indistinguishably from a real user mistake.
    """
    r = _requests.get(url, timeout=LIST_FETCH_TIMEOUT_SEC)
    r.raise_for_status()
    j = r.json()
    if isinstance(j, list):
        return j
    if isinstance(j, dict) and isinstance(j.get("data"), list):
        return j["data"]
    return []


def _chore_strings_from(family: list, chores: list) -> list:
    """Group chores by family member for the intent prompt.

    Returns one entry per member who has chores, e.g.:
        ["Mia: Bathroom, Dishes", "Tom: Bins"]

    Grouping (vs the older "Bathroom (Mia), Dishes (Tom)" format) lets the
    intent LLM emit `chore="Bathroom"` and `person="Mia"` as separate exact
    matches — the executor's `c.title == chore && c.assignedTo == person.id`
    lookup expects bare titles, not combined strings.
    """
    members = {m["id"]: m["name"] for m in family}
    by_person: dict[str, list[str]] = {}
    for c in chores:
        title = c.get("title", "?")
        name = members.get(c.get("assignedTo"), "?")
        by_person.setdefault(name, []).append(title)
    return [f"{name}: {', '.join(titles)}" for name, titles in by_person.items()]


def _gather_dinner_and_agenda(*, api_base: str, today: str) -> dict:
    """Fetch today's dinner + agenda in parallel for the Haiku prompt.

    Called only on stage 3 (matcher missed). Same error propagation as
    _list_bare: a backend outage here surfaces; we don't pretend the
    dinner is "(none)" when it's actually "we can't reach the calendar".
    """
    tomorrow = (datetime.fromisoformat(today) + timedelta(days=1)).date().isoformat()
    paths = {
        "dinners": f"{api_base}/api/dinners?start={today}&end={tomorrow}",
        "events":  f"{api_base}/api/events?start={today}T00:00:00Z&end={tomorrow}T00:00:00Z",
    }

    def _get(url: str):
        r = _requests.get(url, timeout=LIST_FETCH_TIMEOUT_SEC)
        r.raise_for_status()
        j = r.json()
        if isinstance(j, list):
            return j
        if isinstance(j, dict) and isinstance(j.get("data"), list):
            return j["data"]
        return []

    with ThreadPoolExecutor(max_workers=2) as ex:
        futures = {name: ex.submit(_get, url) for name, url in paths.items()}
        results = {name: f.result() for name, f in futures.items()}

    dinners = results["dinners"]
    events = results["events"]
    return {
        "today_dinner": dinners[0]["meal"] if dinners else "(none)",
        "today_agenda": [
            f"{e.get('title','?')} at {e.get('start','?')[11:16]}"
            for e in events
        ],
    }


def _extract_with_matcher_first(*, text: str, cfg) -> IntentResult:
    """Three-stage routing: try the cheapest matcher first, fetch only the
    context each stage actually needs.

    Stage 1: noise / joke (catalog-only, no backend).
    Stage 2: family + chores fetched in parallel → v1 / timer matchers.
    Stage 3: dinners + events fetched in parallel → Haiku.

    A backend outage on /api/events no longer kills noise_play or joke_tell.
    """
    today = today_brisbane()
    empty_ctx = MatchContext(today=today, family=[], chores=[])

    # Stage 1 — kid matchers (catalog-only, no API call needed).
    matched = kid_matcher.try_match(text, empty_ctx)
    if matched is not None:
        log.info("matcher hit (kid): intent=%s", matched.intent)
        return matched

    # Stage 2 — fetch family + chores, try the core matchers.
    family = _list_bare(f"{cfg.homecal_api_base}/api/family-members")
    chores = _list_bare(f"{cfg.homecal_api_base}/api/chores")
    core_ctx = MatchContext(today=today, family=family, chores=chores)
    matched = core_matcher.try_match(text, core_ctx)
    if matched is not None:
        log.info("matcher hit (core): intent=%s", matched.intent)
        return matched

    # Stage 3 — Haiku fallback. Fetch the remaining context (dinners + events)
    # only now that the cheaper paths are exhausted.
    extra = _gather_dinner_and_agenda(api_base=cfg.homecal_api_base, today=today)
    noise_keys = list(kid_catalog.load_noises().entries.keys())

    return parse_intent_response(
        call_openrouter(
            system=build_system_prompt(
                today_brisbane=today,
                family=[m["name"] for m in family],
                chores=_chore_strings_from(family, chores),
                today_dinner=extra["today_dinner"],
                today_agenda=extra["today_agenda"],
                noise_keys=noise_keys,
            ),
            user=text,
            model=cfg.intent_model,
            api_key=cfg.openrouter_api_key,
        )
    )


_mute_state = {"muted": False, "checked_at": 0.0}


# LAN sidecar reachability cache. Mirrors is_muted_locally — the first /tts
# call after the TTL acts as the probe; failures mark the sidecar down for
# the next LAN_HEALTH_TTL_SEC seconds so subsequent utterances jump straight
# to cloud without paying the timeout each time.
LAN_HEALTH_TTL_SEC = 30
_lan_state = {"reachable": True, "checked_at": 0.0}


def lan_reachable() -> bool:
    """True if we should try the LAN sidecar this turn. Cache-fresh + last
    attempt failed → False (skip LAN). Cache-stale → True (try again)."""
    now = time.time()
    if now - _lan_state["checked_at"] > LAN_HEALTH_TTL_SEC:
        return True
    return bool(_lan_state["reachable"])


def mark_lan_attempt(success: bool) -> None:
    """Record the outcome of a /tts attempt for the health cache."""
    _lan_state["reachable"] = success
    _lan_state["checked_at"] = time.time()


# Cloud-TTS-fallback daily cap. Mirrors _under_cap for the main request flow,
# but tracks TTS-specific calls so a broken sidecar can't quietly burn cloud
# budget. Resets at Brisbane midnight (today_brisbane rolls over).
_tts_cap_state = {"day": "", "count": 0}


def _under_tts_cap(cfg) -> bool:
    today = today_brisbane()
    if _tts_cap_state["day"] != today:
        _tts_cap_state.update(day=today, count=0)
    _tts_cap_state["count"] += 1
    return _tts_cap_state["count"] <= cfg.daily_request_cap


def is_muted_locally(cfg) -> bool:
    """Cached mute check. Fails SAFE: a backend outage returns True so we
    don't burn cloud STT/intent calls on every wake while operators can't
    reach the API to flip the mute switch. Cache timestamp only updates on
    a successful response so the next call retries instead of waiting out
    a full TTL on stale data."""
    now = time.time()
    if now - _mute_state["checked_at"] > MUTE_CACHE_TTL_SEC:
        try:
            r = _requests.get(
                f"{cfg.homecal_api_base}/api/voice/status",
                timeout=STATUS_FETCH_TIMEOUT_SEC,
            ).json()
            _mute_state["muted"] = bool(r.get("muted"))
            _mute_state["checked_at"] = now
        except Exception as e:
            log.warning("mute status fetch failed (%s); assuming muted", e)
            return True
    return _mute_state["muted"]


def _start_mute_sse(cfg) -> None:
    """Subscribe to /api/stream so mute changes from wall/phone propagate
    to the Pi within one round-trip. Without this, the 5-second local
    cache (`is_muted_locally`) means a tap-to-mute can be ignored for up
    to MUTE_CACHE_TTL_SEC. The outer while-loop survives EventSource
    reconnects.
    """
    def loop():
        while not _shutdown:
            try:
                with _requests.get(
                    f"{cfg.homecal_api_base}/api/stream", stream=True, timeout=None
                ) as r:
                    for line in r.iter_lines():
                        if line and line.startswith(b"data: "):
                            try:
                                import json as _json
                                from homecal_voice.poke_handlers import classify_poke
                                action = classify_poke(_json.loads(line[6:].decode()))
                                if action == "listen":
                                    _listen_trigger.set()
                                elif action == "mute":
                                    _mute_state["checked_at"] = 0.0
                            except Exception:
                                pass
            except Exception as e:
                log.warning("SSE client error: %s; reconnecting in %ds", e, SSE_RECONNECT_DELAY_SEC)
                time.sleep(SSE_RECONNECT_DELAY_SEC)

    threading.Thread(target=loop, daemon=True).start()


if __name__ == "__main__":
    sys.exit(main())
