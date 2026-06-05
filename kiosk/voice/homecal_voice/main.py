"""Top-level orchestration loop for the Pi voice service.

Per utterance:
    wake -> record -> STT -> intent -> (auto-apply | confirm | silent-fail)
    Confirmation loop listens 5s for yes/no/edit/ambiguous.

Heartbeat thread + mute SSE listener run as daemons; SIGTERM drains the
mic and exits cleanly.
"""

import logging
import signal
import sys
import time
import threading
from dataclasses import dataclass
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
from homecal_voice.timezone import today_brisbane

log = logging.getLogger("homecal_voice.main")

# Tunables centralised at the top so future operators don't grep the file.
AUTO_APPLY_CONFIDENCE = 0.85
SILENT_FAIL_CONFIDENCE = 0.6
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


def _intent_payload(intent: IntentResult) -> dict:
    return {"intent": intent.intent, **intent.fields, "confidence": intent.confidence}


# Whisper returns these literally for silence/noise — they are not real
# transcriptions and should never reach the LLM. Punctuation-only outputs
# get the same treatment (".", "!", "?", "[", etc.).
_BLANK_TRANSCRIPTS = {"", "[blank_audio]", "[ blank_audio ]"}


def _is_blank_transcript(t: str) -> bool:
    if not t:
        return True
    norm = t.strip().lower()
    if norm in _BLANK_TRANSCRIPTS:
        return True
    return not any(c.isalnum() for c in norm)


def run_once(d: OneShotDeps) -> None:
    """Block until one wake → utterance → confirmation cycle completes."""
    # 1) wait for a wake event
    while True:
        f = d.next_frame()
        if d.wake.step(f):
            break

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

    def _audit(transcript: str, status: str, intent: IntentResult | None, error: str | None = None) -> None:
        d.post_audit(
            id=uid,
            transcript=transcript,
            status=status,
            intent_json=intent.raw if intent else None,
            confidence=intent.confidence if intent else None,
            duration_ms=_elapsed(),
            error=error,
        )

    # 2a) Empty wake: VAD never crossed threshold during the capture window.
    # This is the dominant false-positive mode (TV, dishwasher, conversation).
    # Match Alexa/Siri/Google: silently revert to idle, skip the STT round-trip
    # AND the chip's thinking flash. No audible/visual "didn't catch that".
    # `had_speech` is exposed by Endpointer; legacy fixtures without the
    # property fall through to the STT path (treated as if speech was heard).
    # Audit a sentinel ("[no_speech]") rather than the empty string the backend
    # schema rejects — keeps the FP-rate row queryable and the type contract clean.
    if not getattr(d.endpointer, "had_speech", True):
        d.post_state(utterance_id=uid, kind="idle", payload={})
        _audit("[no_speech]", "silent_low_conf", None)
        return

    d.post_state(utterance_id=uid, kind="thinking", payload={"transcript_partial": ""})

    # 3) speech-to-text
    try:
        transcript = d.transcribe(pcm)
    except Exception as e:
        log.warning("STT failed: %s", e)
        d.post_state(utterance_id=uid, kind="failed", payload={"reason": "stt_error"})
        _audit("", "failed", None, error=f"stt:{e}")
        return

    # 3a) Whisper hallucination guard: silence sometimes round-trips as "",
    # "[BLANK_AUDIO]", or pure punctuation. Skip Haiku — same silent revert.
    # Substitute an empty-string transcript with a sentinel for the same reason
    # as the no-speech path: backend Zod requires transcript.length >= 1.
    if _is_blank_transcript(transcript):
        d.post_state(utterance_id=uid, kind="idle", payload={})
        _audit(transcript or "[blank]", "silent_low_conf", None)
        return

    # 4) intent extraction (parse_intent_response never raises; returns unknown on failure)
    intent = d.extract_intent(transcript)

    # 5) confidence routing. Unknown intent / low confidence happens most when
    # wake fires mid-conversation and Haiku can't shoehorn the talk into our
    # schema. Treat the same as no-speech: silent revert. The user didn't
    # address the wall, the wall stays out of the way. The audit log still
    # captures it for later review.
    if intent.intent == "unknown" or intent.confidence < SILENT_FAIL_CONFIDENCE:
        d.post_state(utterance_id=uid, kind="idle", payload={})
        _audit(transcript, "silent_low_conf", intent)
        return

    if intent.confidence >= AUTO_APPLY_CONFIDENCE:
        out = d.execute(intent)
        d.speak(out.get("spoken", ""))
        d.post_state(utterance_id=uid, kind="applied", payload={"intent": _intent_payload(intent)})
        _audit(transcript, "applied", intent)
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
        out = d.execute(intent)
        d.speak(out.get("spoken", ""))
        d.post_state(utterance_id=uid, kind="applied", payload={"intent": _intent_payload(intent)})
        _audit(transcript, "confirmed", intent)
        return

    if outcome.kind == "no":
        d.speak("Cancelled.")
        d.post_state(utterance_id=uid, kind="failed", payload={"reason": "no"})
        _audit(transcript, "cancelled", intent)
        return

    if outcome.kind == "timeout":
        # Distinct from "no" so the audit log shows why the action didn't happen.
        # Tell the user out loud — silence + a green confirm card disappearing is
        # the worst possible UX for "did it save or not?".
        d.speak("I didn't hear a yes or no — cancelled.")
        d.post_state(utterance_id=uid, kind="failed", payload={"reason": "timeout"})
        _audit(transcript, "cancelled", intent)
        return

    # outcome.kind in ("edit", "ambiguous") → audit stays "pending" from the
    # earlier write. Give a short audible cue so the user knows the system
    # heard them but didn't act. PendingReviewTray (future UI) will surface
    # this row for later resolution; for now the audit log is the trail.
    d.speak("I didn't catch that — say yes or no.")
    d.post_state(utterance_id=uid, kind="failed", payload={"reason": outcome.kind})


_shutdown = False


def _on_sigterm(*_):
    global _shutdown
    _shutdown = True
    log.info("SIGTERM received; shutting down")


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    cfg = load_config()
    signal.signal(signal.SIGTERM, _on_sigterm)
    signal.signal(signal.SIGINT, _on_sigterm)

    from homecal_voice.mic import MicStream
    from homecal_voice.wake import WakeDetector, load_default_model
    from homecal_voice.endpointer import Endpointer, load_silero_vad
    from homecal_voice.stt import transcribe as stt_transcribe
    from homecal_voice.tts import speak as tts_speak
    from homecal_voice.executor import Executor
    from homecal_voice.server_state import post_state, post_audit, post_heartbeat

    mic = MicStream(device=cfg.audio_device)
    mic.start()
    frame_iter = mic.frames()
    # load_default_model returns (Model, scoring_key); the versioned key
    # (e.g. 'hey_mycroft_v0.1') is what Model.predict() returns scores under.
    wake_model, wake_key = load_default_model(cfg.wake_word)
    wake = WakeDetector(model=wake_model, wake_name=wake_key, threshold=cfg.wake_threshold)
    endpointer_factory = lambda: Endpointer(vad=load_silero_vad())
    executor = Executor(base=cfg.homecal_api_base, token=cfg.pi_api_token)

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
                next_frame=lambda: next(frame_iter),
                wake=wake,
                endpointer=ep,
                endpointer_factory=endpointer_factory,
                transcribe=lambda pcm: stt_transcribe(pcm, server_url=cfg.whisper_server_url),
                extract_intent=lambda text: parse_intent_response(
                    call_openrouter(
                        system=build_system_prompt(
                            today_brisbane=today_brisbane(),
                            family=[
                                m["name"]
                                for m in _list_bare(f"{cfg.homecal_api_base}/api/family-members")
                            ],
                            chores=_chore_strings(cfg.homecal_api_base),
                        ),
                        user=text,
                        model=cfg.intent_model,
                        api_key=cfg.openrouter_api_key,
                    )
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

    Returns [] on any network/HTTP failure so the prompt-builder still
    runs (with an empty family/chore list) instead of crashing the
    whole utterance.
    """
    try:
        r = _requests.get(url, timeout=LIST_FETCH_TIMEOUT_SEC)
        r.raise_for_status()
        j = r.json()
        if isinstance(j, list):
            return j
        if isinstance(j, dict) and isinstance(j.get("data"), list):
            return j["data"]
        return []
    except Exception as e:
        log.warning("GET %s failed: %s", url, e)
        return []


def _chore_strings(base: str) -> list:
    """Group chores by family member for the intent prompt.

    Returns one entry per member who has chores, e.g.:
        ["Mia: Bathroom, Dishes", "Tom: Bins"]

    Grouping (vs the older "Bathroom (Mia), Dishes (Tom)" format) lets the
    intent LLM emit `chore="Bathroom"` and `person="Mia"` as separate exact
    matches — the executor's `c.title == chore && c.assignedTo == person.id`
    lookup expects bare titles, not combined strings.
    """
    members = {m["id"]: m["name"] for m in _list_bare(f"{base}/api/family-members")}
    by_person: dict[str, list[str]] = {}
    for c in _list_bare(f"{base}/api/chores"):
        title = c.get("title", "?")
        name = members.get(c.get("assignedTo"), "?")
        by_person.setdefault(name, []).append(title)
    return [f"{name}: {', '.join(titles)}" for name, titles in by_person.items()]


_mute_state = {"muted": False, "checked_at": 0.0}


def is_muted_locally(cfg) -> bool:
    now = time.time()
    if now - _mute_state["checked_at"] > MUTE_CACHE_TTL_SEC:
        try:
            r = _requests.get(
                f"{cfg.homecal_api_base}/api/voice/status",
                timeout=STATUS_FETCH_TIMEOUT_SEC,
            ).json()
            _mute_state["muted"] = bool(r.get("muted"))
        except Exception:
            pass
        _mute_state["checked_at"] = now
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
                                poke = _json.loads(line[6:].decode())
                                if poke.get("kind") == "voice":
                                    _mute_state["checked_at"] = 0.0
                            except Exception:
                                pass
            except Exception as e:
                log.warning("SSE client error: %s; reconnecting in %ds", e, SSE_RECONNECT_DELAY_SEC)
                time.sleep(SSE_RECONNECT_DELAY_SEC)

    threading.Thread(target=loop, daemon=True).start()


if __name__ == "__main__":
    sys.exit(main())
