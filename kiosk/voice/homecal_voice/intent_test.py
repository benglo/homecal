from homecal_voice.intent import (
    build_system_prompt,
    parse_intent_response,
    IntentResult,
)


def test_system_prompt_includes_today_and_lists():
    p = build_system_prompt(
        today_brisbane="2026-06-04",
        family=["Mia", "Tom", "Sam"],
        chores=["Mia: Bathroom, Dishes", "Tom: Bins"],
    )
    assert "2026-06-04" in p
    assert "Mia" in p and "Tom" in p and "Sam" in p
    assert "Mia: Bathroom, Dishes" in p
    assert "Active chores by family member" in p
    assert "- Mia: Bathroom, Dishes" in p
    # Prompt must instruct the LLM that `chore` is a bare title, not "Title (Name)".
    assert "bare title" in p


def test_system_prompt_with_no_chores_or_family():
    p = build_system_prompt(today_brisbane="2026-06-04", family=[], chores=[])
    assert "(none)" in p


def test_parse_good_dinner_set():
    raw = '{"intent":"dinner_set","date":"2026-06-04","meal":"tacos","confidence":0.92}'
    r = parse_intent_response(raw)
    assert r.intent == "dinner_set"
    assert r.fields == {"date": "2026-06-04", "meal": "tacos"}
    assert r.confidence == 0.92


def test_parse_good_chore_complete_with_bare_title():
    raw = '{"intent":"chore_complete","person":"Mia","chore":"Bathroom","confidence":0.95}'
    r = parse_intent_response(raw)
    assert r.intent == "chore_complete"
    assert r.fields == {"person": "Mia", "chore": "Bathroom"}


def test_parse_malformed_returns_unknown():
    r = parse_intent_response("this is not json")
    assert r.intent == "unknown"
    assert r.confidence == 0.0
    assert r.fields["reason"] == "no_json"


def test_parse_empty_string_returns_unknown_no_json():
    r = parse_intent_response("")
    assert r.intent == "unknown"
    assert r.fields["reason"] == "no_json"


def test_parse_none_returns_unknown_no_json():
    r = parse_intent_response(None)  # type: ignore[arg-type]
    assert r.intent == "unknown"


def test_parse_off_schema_returns_unknown():
    raw = '{"intent":"smash_keyboard","confidence":1.0}'
    r = parse_intent_response(raw)
    assert r.intent == "unknown"
    assert r.fields["reason"] == "unknown_intent"


def test_parse_dinner_set_missing_date_returns_unknown():
    raw = '{"intent":"dinner_set","meal":"tacos","confidence":0.9}'
    r = parse_intent_response(raw)
    assert r.intent == "unknown"
    assert r.fields["reason"].startswith("missing_fields:")
    assert "date" in r.fields["reason"]


def test_parse_dinner_set_missing_meal_returns_unknown():
    raw = '{"intent":"dinner_set","date":"2026-06-04","confidence":0.9}'
    r = parse_intent_response(raw)
    assert r.intent == "unknown"
    assert "meal" in r.fields["reason"]


def test_parse_chore_complete_missing_person_returns_unknown():
    raw = '{"intent":"chore_complete","chore":"Bathroom","confidence":0.9}'
    r = parse_intent_response(raw)
    assert r.intent == "unknown"
    assert "person" in r.fields["reason"]


def test_parse_bad_confidence_type_returns_unknown():
    """LLM occasionally emits 'high' instead of a number — we'd previously
    crash with ValueError mid-utterance."""
    raw = '{"intent":"dinner_set","date":"2026-06-04","meal":"tacos","confidence":"high"}'
    r = parse_intent_response(raw)
    assert r.intent == "unknown"
    assert r.fields["reason"] == "bad_confidence"


def test_parse_null_confidence_returns_unknown():
    raw = '{"intent":"dinner_set","date":"2026-06-04","meal":"tacos","confidence":null}'
    r = parse_intent_response(raw)
    assert r.intent == "unknown"
    assert r.fields["reason"] == "bad_confidence"


class _FakeMessage:
    def __init__(self, content): self.content = content


class _FakeChoice:
    def __init__(self, content): self.message = _FakeMessage(content)


class _FakeResponse:
    def __init__(self, content): self.choices = [_FakeChoice(content)]


class _FakeChat:
    def __init__(self, content="", raise_exc=None):
        self._content = content
        self._raise = raise_exc
        self.last_call = None

    def send(self, **kwargs):
        self.last_call = kwargs
        if self._raise is not None:
            raise self._raise
        return _FakeResponse(self._content)


class _FakeClient:
    def __init__(self, chat): self.chat = chat
    def __enter__(self): return self
    def __exit__(self, *exc): return False


def test_call_openrouter_sends_messages(monkeypatch):
    from homecal_voice import intent
    chat = _FakeChat(content='{"intent":"query_dinner","date":"2026-06-04","confidence":0.95}')
    monkeypatch.setattr(intent, "OpenRouter", lambda api_key: _FakeClient(chat))
    out = intent.call_openrouter(
        system="sys",
        user="what's for dinner",
        model="anthropic/claude-haiku-4.5",
        api_key="sk-or-xxx",
        timeout_s=10,
    )
    assert "query_dinner" in out
    assert chat.last_call["model"] == "anthropic/claude-haiku-4.5"
    assert chat.last_call["messages"][0]["role"] == "system"
    assert "<<<USER>>>" in chat.last_call["messages"][1]["content"]
    assert chat.last_call["temperature"] == 0.0


def test_call_openrouter_propagates_sdk_exceptions(monkeypatch):
    """SDK errors must bubble up so the caller can mark the utterance failed
    instead of silently treating a server outage as 'no intent'."""
    from homecal_voice import intent
    chat = _FakeChat(raise_exc=RuntimeError("upstream 502"))
    monkeypatch.setattr(intent, "OpenRouter", lambda api_key: _FakeClient(chat))
    try:
        intent.call_openrouter(
            system="sys", user="text", model="x", api_key="sk-or-xxx", timeout_s=2,
        )
    except RuntimeError:
        return
    assert False, "expected RuntimeError to propagate from SDK"


def test_call_openrouter_returns_empty_string_for_empty_response(monkeypatch):
    from homecal_voice import intent
    chat = _FakeChat(content="")
    monkeypatch.setattr(intent, "OpenRouter", lambda api_key: _FakeClient(chat))
    out = intent.call_openrouter(
        system="sys", user="hi", model="x", api_key="sk-or-xxx", timeout_s=2,
    )
    assert out == ""
