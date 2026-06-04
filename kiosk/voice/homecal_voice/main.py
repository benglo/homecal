import logging, signal, time, sys
from dataclasses import dataclass
from typing import Callable
from uuid_utils import uuid7
from homecal_voice.config import load_config
from homecal_voice.intent import IntentResult, build_system_prompt, parse_intent_response, call_openrouter

log = logging.getLogger("homecal_voice.main")

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

def run_once(d: OneShotDeps) -> None:
    """Block until one wake → utterance → confirmation cycle completes."""
    while True:
        f = d.next_frame()
        if d.wake.step(f):
            break
    uid = d.utterance_id()
    d.post_state(utterance_id=uid, kind="listening", payload={"vu": 0.0})
    while True:
        f = d.next_frame()
        if d.endpointer.feed(f):
            break
    pcm = d.endpointer.audio()
    d.post_state(utterance_id=uid, kind="thinking", payload={"transcript_partial": ""})
    started_ms = int(time.time() * 1000)
    try:
        transcript = d.transcribe(pcm)
    except Exception as e:
        log.warning("STT failed: %s", e)
        d.post_state(utterance_id=uid, kind="failed", payload={"reason": "stt_error"})
        d.post_audit(id=uid, transcript="", status="failed", intent_json=None, confidence=None,
                     duration_ms=int(time.time()*1000)-started_ms, error=f"stt:{e}")
        return
    intent = d.extract_intent(transcript)
    auto_apply = intent.confidence >= 0.85 and intent.intent != "unknown"
    if intent.intent == "unknown" or intent.confidence < 0.6:
        d.post_state(utterance_id=uid, kind="failed", payload={"reason": "low_confidence"})
        d.post_audit(id=uid, transcript=transcript, status="silent_low_conf",
                     intent_json=intent.raw, confidence=intent.confidence,
                     duration_ms=int(time.time()*1000)-started_ms, error=None)
        return
    if auto_apply:
        out = d.execute(intent)
        d.speak(out.get("spoken", ""))
        d.post_state(utterance_id=uid, kind="applied",
                     payload={"intent": {"intent": intent.intent, **intent.fields, "confidence": intent.confidence}})
        d.post_audit(id=uid, transcript=transcript, status="applied",
                     intent_json=intent.raw, confidence=intent.confidence,
                     duration_ms=int(time.time()*1000)-started_ms, error=None)
    else:
        d.post_state(utterance_id=uid, kind="confirming",
                     payload={"intent": {"intent": intent.intent, **intent.fields, "confidence": intent.confidence},
                              "transcript": transcript})
        d.post_audit(id=uid, transcript=transcript, status="pending",
                     intent_json=intent.raw, confidence=intent.confidence,
                     duration_ms=int(time.time()*1000)-started_ms, error=None)
        # T20b — listen for a yes/no/edit
        from homecal_voice.confirm_loop import confirm_listen
        outcome = confirm_listen(
            next_frame=d.next_frame,
            endpointer_factory=d.endpointer_factory,
            transcribe=d.transcribe,
        )
        if outcome.kind == "yes":
            out = d.execute(intent)
            d.speak(out.get("spoken", ""))
            d.post_state(utterance_id=uid, kind="applied",
                         payload={"intent": {"intent": intent.intent, **intent.fields, "confidence": intent.confidence}})
            d.post_audit(id=uid, transcript=transcript, status="confirmed",
                         intent_json=intent.raw, confidence=intent.confidence,
                         duration_ms=int(time.time()*1000)-started_ms, error=None)
        elif outcome.kind in ("no", "timeout"):
            d.post_state(utterance_id=uid, kind="failed", payload={"reason": outcome.kind})
            d.post_audit(id=uid, transcript=transcript, status="cancelled",
                         intent_json=intent.raw, confidence=intent.confidence,
                         duration_ms=int(time.time()*1000)-started_ms, error=None)
        # else: edit | ambiguous → keep status=pending (PendingReviewTray)

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
    import threading

    mic = MicStream(device=cfg.audio_device); mic.start()
    frame_iter = mic.frames()
    # BUG FIX — load_default_model returns (Model, scoring_key) per T13 R13.
    wake_model, wake_key = load_default_model(cfg.wake_word)
    wake = WakeDetector(model=wake_model, wake_name=wake_key, threshold=cfg.wake_threshold)
    endpointer_factory = lambda: Endpointer(vad=load_silero_vad())
    executor = Executor(base=cfg.homecal_api_base, token=cfg.pi_api_token)

    _start_mute_sse(cfg)

    def _hb():
        while not _shutdown:
            try:
                post_heartbeat(base=cfg.homecal_api_base, token=cfg.pi_api_token,
                               at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
            except Exception as e:
                log.warning("heartbeat failed: %s", e)
            time.sleep(30)
    threading.Thread(target=_hb, daemon=True).start()

    counter = {"day": "", "count": 0}
    def _under_cap() -> bool:
        today = time.strftime("%Y-%m-%d", time.gmtime(time.time() + 10 * 3600))
        if counter["day"] != today: counter.update(day=today, count=0)
        counter["count"] += 1
        return counter["count"] <= cfg.daily_request_cap

    try:
        while not _shutdown:
            ep = endpointer_factory()
            deps = OneShotDeps(
                next_frame=lambda: next(frame_iter),
                wake=wake, endpointer=ep,
                endpointer_factory=endpointer_factory,
                transcribe=lambda pcm: stt_transcribe(pcm, server_url=cfg.whisper_server_url),
                extract_intent=lambda text: parse_intent_response(
                    call_openrouter(
                        system=build_system_prompt(
                            today_brisbane=time.strftime("%Y-%m-%d", time.gmtime(time.time() + 10 * 3600)),
                            family=[m["name"] for m in _list_bare(f"{cfg.homecal_api_base}/api/family-members")],
                            chores=_chore_strings(cfg.homecal_api_base),
                        ),
                        user=text, model=cfg.intent_model, api_key=cfg.openrouter_api_key,
                    )
                ),
                execute=executor.apply,
                speak=lambda text: tts_speak(text, model=cfg.tts_model,
                                              api_key=cfg.openrouter_api_key,
                                              muted=is_muted_locally(cfg)),
                post_state=lambda **kw: post_state(base=cfg.homecal_api_base, token=cfg.pi_api_token, **kw),
                post_audit=lambda **kw: post_audit(base=cfg.homecal_api_base, token=cfg.pi_api_token, **kw),
                utterance_id=lambda: str(uuid7()),
                muted=lambda: is_muted_locally(cfg),
            )
            if not _under_cap():
                log.warning("daily request cap %d reached; sleeping", cfg.daily_request_cap)
                time.sleep(60); continue
            run_once(deps)
    finally:
        mic.stop()
    return 0

import requests as _requests

def _list_bare(url: str) -> list:
    """R3 — homecal list endpoints return bare arrays. Tolerate {data:[...]} too."""
    try:
        r = _requests.get(url, timeout=5); r.raise_for_status(); j = r.json()
        if isinstance(j, list): return j
        if isinstance(j, dict) and isinstance(j.get("data"), list): return j["data"]
        return []
    except Exception as e:
        log.warning("GET %s failed: %s", url, e); return []

def _chore_strings(base: str) -> list:
    """Return ['Bathroom (Mia)', ...] by joining chores → members in-process. R4."""
    members = {m["id"]: m["name"] for m in _list_bare(f"{base}/api/family-members")}
    out = []
    for c in _list_bare(f"{base}/api/chores"):
        title = c.get("title", "?")
        assigned = c.get("assignedTo")
        out.append(f"{title} ({members.get(assigned, '?')})")
    return out

_mute_state = {"muted": False, "checked_at": 0.0}

def is_muted_locally(cfg) -> bool:
    now = time.time()
    if now - _mute_state["checked_at"] > 5:
        try:
            r = _requests.get(f"{cfg.homecal_api_base}/api/voice/status", timeout=3).json()
            _mute_state["muted"] = bool(r.get("muted"))
        except Exception:
            pass
        _mute_state["checked_at"] = now
    return _mute_state["muted"]

def _start_mute_sse(cfg) -> None:
    """R16 — open an SSE client to /api/stream and clear the mute cache when a
    voice poke arrives. Survives reconnects via the outer while-loop."""
    import threading
    def loop():
        while not _shutdown:
            try:
                with _requests.get(f"{cfg.homecal_api_base}/api/stream", stream=True, timeout=None) as r:
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
                log.warning("SSE client error: %s; reconnecting in 5s", e)
                time.sleep(5)
    threading.Thread(target=loop, daemon=True).start()

if __name__ == "__main__":
    sys.exit(main())
