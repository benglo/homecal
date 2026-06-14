from homecal_voice.server_state import post_state, post_audit, post_heartbeat
from unittest.mock import patch, MagicMock


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


def test_post_audit_includes_intent_name_answer_concern():
    with patch("homecal_voice.server_state.requests") as r:
        post_audit(
            base="http://x", token="t", id="u1",
            transcript="why is the sky blue", status="applied",
            intent_json='{"intent":"ask_question"}', confidence=0.95,
            duration_ms=1200, error=None, source="llm",
            intent_name="ask_question",
            answer="Because of light scattering!",
            concern=False,
        )
    body = r.post.call_args.kwargs.get("json")
    assert body["intent_name"] == "ask_question"
    assert body["answer"] == "Because of light scattering!"
    assert body["concern"] is False


def test_post_audit_omits_new_fields_when_absent_backwards_compat():
    """Calls from existing audit paths that don't pass the new kwargs should
    still work — fields default to None and are simply not included in the body."""
    with patch("homecal_voice.server_state.requests") as r:
        post_audit(
            base="http://x", token="t", id="u1",
            transcript="t", status="applied",
            intent_json=None, confidence=None,
            duration_ms=100, error=None,
        )
    body = r.post.call_args.kwargs.get("json")
    # The new fields should NOT appear when their kwargs weren't passed
    # (mirrors the existing source=None behaviour).
    assert "intent_name" not in body
    assert "answer" not in body
    assert "concern" not in body


def test_post_audit_concern_true_serialises_correctly():
    with patch("homecal_voice.server_state.requests") as r:
        post_audit(
            base="http://x", token="t", id="u2",
            transcript="my tummy hurts", status="applied",
            intent_json='{}', confidence=0.95, duration_ms=1100,
            error=None, source="llm",
            intent_name="ask_question",
            answer="That sounds important. Please tell your mum or dad right now.",
            concern=True,
        )
    body = r.post.call_args.kwargs.get("json")
    assert body["concern"] is True


def test_post_audit_sends_tts_provider_and_latency(requests_mock):
    requests_mock.post("http://api/api/voice/audit", json={"ok": True})
    post_audit(
        base="http://api", token="t", id="u1",
        transcript="hello", status="applied",
        intent_json=None, confidence=None, duration_ms=None,
        error=None, source=None, intent_name=None,
        answer=None, concern=None,
        tts_provider="kokoro_lan", tts_latency_ms=234,
    )
    body = requests_mock.last_request.json()
    assert body["tts_provider"] == "kokoro_lan"
    assert body["tts_latency_ms"] == 234


def test_post_audit_omits_tts_fields_when_unset(requests_mock):
    requests_mock.post("http://api/api/voice/audit", json={"ok": True})
    post_audit(
        base="http://api", token="t", id="u1",
        transcript="hello", status="applied",
        intent_json=None, confidence=None, duration_ms=None,
        error=None, source=None, intent_name=None,
        answer=None, concern=None,
    )
    body = requests_mock.last_request.json()
    # Either absent or explicit null — both are valid per voiceAuditBody
    assert body.get("tts_provider") in (None,)
    assert body.get("tts_latency_ms") in (None,)
