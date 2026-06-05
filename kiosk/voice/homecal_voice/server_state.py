import requests

def _hdrs(t): return {"X-Pi-Token": t, "Content-Type": "application/json"}

def post_state(*, base, token, utterance_id, kind, payload=None):
    r = requests.post(f"{base}/api/voice/state",
                      json={"utterance_id": utterance_id, "kind": kind, "payload": payload},
                      headers=_hdrs(token), timeout=5)
    r.raise_for_status()

def post_audit(*, base, token, id, transcript, status, intent_json, confidence, duration_ms, error):
    r = requests.post(f"{base}/api/voice/audit",
                      json={"id": id, "transcript": transcript, "status": status,
                            "intent_json": intent_json, "confidence": confidence,
                            "duration_ms": duration_ms, "error": error},
                      headers=_hdrs(token), timeout=5)
    r.raise_for_status()

def post_heartbeat(*, base, token, at):
    r = requests.post(f"{base}/api/voice/heartbeat",
                      json={"at": at}, headers=_hdrs(token), timeout=5)
    r.raise_for_status()
