from homecal_voice.intent import build_system_prompt, parse_intent_response, IntentResult

def test_system_prompt_includes_today_and_lists():
    p = build_system_prompt(
        today_brisbane="2026-06-04",
        family=["Mia", "Tom", "Sam"],
        chores=["Bathroom (Mia)", "Dishes (Tom)", "Bins (Sam)"],
    )
    assert "2026-06-04" in p
    assert "Mia" in p and "Tom" in p and "Sam" in p
    assert "Bathroom (Mia)" in p
    assert "EXACT MATCHES" in p

def test_parse_good_dinner_set():
    raw = '{"intent":"dinner_set","date":"2026-06-04","meal":"tacos","confidence":0.92}'
    r = parse_intent_response(raw)
    assert r.intent == "dinner_set"
    assert r.fields == {"date": "2026-06-04", "meal": "tacos"}
    assert r.confidence == 0.92

def test_parse_malformed_returns_unknown():
    r = parse_intent_response("this is not json")
    assert r.intent == "unknown"
    assert r.confidence == 0.0

def test_parse_off_schema_returns_unknown():
    raw = '{"intent":"smash_keyboard","confidence":1.0}'
    r = parse_intent_response(raw)
    assert r.intent == "unknown"

def test_call_openrouter_posts_messages(requests_mock):
    from homecal_voice.intent import call_openrouter
    requests_mock.post(
        "https://openrouter.ai/api/v1/chat/completions",
        json={"choices": [{"message": {"content": '{"intent":"query_dinner","date":"2026-06-04","confidence":0.95}'}}]},
    )
    out = call_openrouter(
        system="sys", user="what's for dinner",
        model="anthropic/claude-haiku-4.5", api_key="sk-or-xxx", timeout_s=10,
    )
    assert "query_dinner" in out
