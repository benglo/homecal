import requests

def _hdrs(t): return {"X-Pi-Token": t, "Content-Type": "application/json"}

def post_state(*, base, token, utterance_id, kind, payload=None):
    r = requests.post(f"{base}/api/voice/state",
                      json={"utterance_id": utterance_id, "kind": kind, "payload": payload},
                      headers=_hdrs(token), timeout=5)
    r.raise_for_status()

def post_audit(
    *, base, token, id, transcript, status, intent_json, confidence,
    duration_ms, error, source=None,
    intent_name=None, answer=None, concern=None,
    tts_provider=None, tts_latency_ms=None,
):
    body = {
        "id": id, "transcript": transcript, "status": status,
        "intent_json": intent_json, "confidence": confidence,
        "duration_ms": duration_ms, "error": error,
    }
    if source is not None:
        body["source"] = source
    # The Pi may not know the intent name on every path (silent_low_conf,
    # blank STT, hallucination); only attach when meaningful so the Zod
    # schema's `.optional()` continues to work.
    if intent_name is not None:
        body["intent_name"] = intent_name
    if answer is not None:
        body["answer"] = answer
    if concern is not None:
        body["concern"] = concern
    if tts_provider is not None:
        body["tts_provider"] = tts_provider
    if tts_latency_ms is not None:
        body["tts_latency_ms"] = tts_latency_ms
    r = requests.post(f"{base}/api/voice/audit", json=body, headers=_hdrs(token), timeout=5)
    r.raise_for_status()

def post_heartbeat(*, base, token, at):
    r = requests.post(f"{base}/api/voice/heartbeat",
                      json={"at": at}, headers=_hdrs(token), timeout=5)
    r.raise_for_status()
