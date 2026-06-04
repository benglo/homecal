from homecal_voice.server_state import post_state, post_audit, post_heartbeat

def test_post_state(requests_mock):
    requests_mock.post("http://api/api/voice/state", json={"ok": True})
    post_state(base="http://api", token="t", utterance_id="u1", kind="listening", payload={"vu": 0.1})
    assert requests_mock.last_request.json()["kind"] == "listening"

def test_post_audit(requests_mock):
    requests_mock.post("http://api/api/voice/audit", json={"ok": True})
    post_audit(base="http://api", token="t", id="u1", transcript="hi", status="applied",
               intent_json=None, confidence=None, duration_ms=4200, error=None)
    body = requests_mock.last_request.json()
    assert body["status"] == "applied" and body["duration_ms"] == 4200

def test_post_heartbeat(requests_mock):
    requests_mock.post("http://api/api/voice/heartbeat", json={"ok": True})
    post_heartbeat(base="http://api", token="t", at="2026-06-04T12:00:00Z")
    assert requests_mock.last_request.json()["at"] == "2026-06-04T12:00:00Z"
