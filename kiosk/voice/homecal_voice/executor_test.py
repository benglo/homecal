from homecal_voice.executor import Executor, _canon_meal, _unwrap
from homecal_voice.intent import IntentResult


# --- _unwrap helper --------------------------------------------------------


def test_unwrap_bare_array():
    assert _unwrap([{"x": 1}, {"x": 2}]) == [{"x": 1}, {"x": 2}]


def test_unwrap_data_envelope():
    """Tolerance for the legacy envelope shape — defensive against a future
    backend migration that would otherwise silently produce []."""
    assert _unwrap({"data": [{"x": 1}]}) == [{"x": 1}]


def test_unwrap_unexpected_shape_returns_empty():
    assert _unwrap({"items": [{"x": 1}]}) == []
    assert _unwrap("nope") == []
    assert _unwrap(None) == []


# --- dinner_set ------------------------------------------------------------


def test_dinner_set_posts_to_dinners(requests_mock):
    posted = []

    def cb(request, _ctx):
        posted.append(request.json())
        return {"ok": True}

    requests_mock.put("http://api/api/dinners/2026-06-04", json=cb)
    ex = Executor(base="http://api", token="t")
    res = IntentResult("dinner_set", {"date": "2026-06-04", "meal": "tacos"}, 0.92, "")
    out = ex.apply(res)
    assert out["ok"] is True
    # STT returns "tacos"; we canonicalise to "Tacos" before storage AND speech
    # so the wall display matches the spoken confirmation.
    assert posted[0]["meal"] == "Tacos"
    assert "Tacos" in out["spoken"]


def test_canon_meal_title_cases_lowercase():
    assert _canon_meal("tacos") == "Tacos"
    assert _canon_meal("mac and cheese") == "Mac And Cheese"


def test_canon_meal_preserves_all_caps_acronyms():
    """Plain .title() would mangle 'BBQ' to 'Bbq'."""
    assert _canon_meal("BBQ chicken") == "BBQ Chicken"
    assert _canon_meal("PB&J") == "PB&J"


def test_canon_meal_strips_and_handles_empty():
    assert _canon_meal("  tacos  ") == "Tacos"
    assert _canon_meal("") == ""
    assert _canon_meal("   ") == ""


# --- chore_complete --------------------------------------------------------


def test_chore_complete_resolves_then_posts(requests_mock):
    requests_mock.get(
        "http://api/api/family-members",
        json=[{"id": "fm1", "name": "Mia", "icon": ""}],
    )
    requests_mock.get(
        "http://api/api/chores",
        json=[{"id": "c1", "title": "Bathroom", "assignedTo": "fm1"}],
    )
    posted = []

    def post_cb(request, _ctx):
        posted.append(request.json())
        return {"ok": True}

    requests_mock.post("http://api/api/chores/c1/complete", json=post_cb)
    ex = Executor(base="http://api", token="t")
    res = IntentResult("chore_complete", {"person": "Mia", "chore": "Bathroom"}, 0.95, "")
    out = ex.apply(res)
    assert out["ok"] is True
    assert posted and "date" in posted[0]


def test_chore_complete_unknown_person_returns_friendly_error(requests_mock):
    requests_mock.get("http://api/api/family-members", json=[{"id": "fm1", "name": "Mia"}])
    requests_mock.get("http://api/api/chores", json=[])
    ex = Executor(base="http://api", token="t")
    res = IntentResult("chore_complete", {"person": "Stranger", "chore": "Bathroom"}, 0.95, "")
    out = ex.apply(res)
    assert out["ok"] is False
    assert "Stranger" in out["spoken"]


def test_chore_complete_unknown_chore_for_person(requests_mock):
    requests_mock.get("http://api/api/family-members", json=[{"id": "fm1", "name": "Mia"}])
    requests_mock.get("http://api/api/chores", json=[{"id": "c1", "title": "Dishes", "assignedTo": "fm1"}])
    ex = Executor(base="http://api", token="t")
    res = IntentResult("chore_complete", {"person": "Mia", "chore": "Bathroom"}, 0.95, "")
    out = ex.apply(res)
    assert out["ok"] is False
    assert "Mia" in out["spoken"]


def test_chore_complete_disambiguates_via_assignedTo(requests_mock):
    """Two chores share a title but are assigned to different members.
    The executor MUST pick the one matching the named person's id —
    a regression dropping the assignedTo check would silently complete
    the wrong family member's chore."""
    requests_mock.get(
        "http://api/api/family-members",
        json=[{"id": "fm1", "name": "Mia"}, {"id": "fm2", "name": "Tom"}],
    )
    requests_mock.get(
        "http://api/api/chores",
        json=[
            {"id": "c-mia", "title": "Bathroom", "assignedTo": "fm1"},
            {"id": "c-tom", "title": "Bathroom", "assignedTo": "fm2"},
        ],
    )
    called = []

    def post_cb(request, _ctx):
        called.append(request.url)
        return {"ok": True}

    requests_mock.post("http://api/api/chores/c-tom/complete", json=post_cb)
    requests_mock.post("http://api/api/chores/c-mia/complete", json=post_cb)
    ex = Executor(base="http://api", token="t")
    res = IntentResult("chore_complete", {"person": "Tom", "chore": "Bathroom"}, 0.95, "")
    out = ex.apply(res)
    assert out["ok"] is True
    assert any("c-tom" in u for u in called)
    assert not any("c-mia" in u for u in called)


def test_chore_complete_case_insensitive_name_and_title(requests_mock):
    requests_mock.get("http://api/api/family-members", json=[{"id": "fm1", "name": "Mia"}])
    requests_mock.get("http://api/api/chores", json=[{"id": "c1", "title": "Bathroom", "assignedTo": "fm1"}])
    requests_mock.post("http://api/api/chores/c1/complete", json={"ok": True})
    ex = Executor(base="http://api", token="t")
    res = IntentResult("chore_complete", {"person": "mia", "chore": "BATHROOM"}, 0.95, "")
    out = ex.apply(res)
    assert out["ok"] is True


# --- query_dinner ----------------------------------------------------------


def test_query_dinner_returns_meal(requests_mock):
    requests_mock.get(
        "http://api/api/dinners",
        json=[{"date": "2026-06-04", "meal": "tacos"}],
    )
    ex = Executor(base="http://api", token="t")
    res = IntentResult("query_dinner", {"date": "2026-06-04"}, 0.95, "")
    out = ex.apply(res)
    assert "tacos" in out["spoken"].lower()


def test_query_dinner_returns_nothing_when_empty(requests_mock):
    requests_mock.get("http://api/api/dinners", json=[])
    ex = Executor(base="http://api", token="t")
    res = IntentResult("query_dinner", {"date": "2026-06-04"}, 0.95, "")
    out = ex.apply(res)
    assert out["ok"] is True
    assert "nothing" in out["spoken"].lower()


def test_query_dinner_accepts_data_envelope(requests_mock):
    """Future-proofing: backend could envelope responses; we must still parse."""
    requests_mock.get(
        "http://api/api/dinners",
        json={"data": [{"date": "2026-06-04", "meal": "pasta"}]},
    )
    ex = Executor(base="http://api", token="t")
    res = IntentResult("query_dinner", {"date": "2026-06-04"}, 0.95, "")
    out = ex.apply(res)
    assert "pasta" in out["spoken"].lower()


# --- query_agenda ----------------------------------------------------------


def test_query_agenda_empty(requests_mock):
    requests_mock.get("http://api/api/events", json=[])
    ex = Executor(base="http://api", token="t")
    res = IntentResult("query_agenda", {"date": "2026-06-04"}, 0.95, "")
    out = ex.apply(res)
    assert "nothing" in out["spoken"].lower()


def test_query_agenda_caps_at_three_items_and_includes_HHmm(requests_mock):
    items = [
        {"title": "Soccer", "start": "2026-06-04T17:00:00+10:00"},
        {"title": "Dentist", "start": "2026-06-04T09:00:00+10:00"},
        {"title": "Pickup", "start": "2026-06-04T15:30:00+10:00"},
        {"title": "Extra one", "start": "2026-06-04T20:00:00+10:00"},
    ]
    requests_mock.get("http://api/api/events", json=items)
    ex = Executor(base="http://api", token="t")
    res = IntentResult("query_agenda", {"date": "2026-06-04"}, 0.95, "")
    out = ex.apply(res)
    assert "Soccer" in out["spoken"]
    assert "Dentist" in out["spoken"]
    assert "Pickup" in out["spoken"]
    assert "Extra one" not in out["spoken"]  # capped at AGENDA_MAX_ITEMS
    assert "17:00" in out["spoken"]


def test_query_agenda_handles_all_day_event_without_time_string(requests_mock):
    """All-day events have date-only `start` (no 'T'); time slice must be skipped."""
    requests_mock.get(
        "http://api/api/events",
        json=[{"title": "Public holiday", "start": "2026-06-04"}],
    )
    ex = Executor(base="http://api", token="t")
    res = IntentResult("query_agenda", {"date": "2026-06-04"}, 0.95, "")
    out = ex.apply(res)
    assert "Public holiday" in out["spoken"]
    assert " at " not in out["spoken"]


def test_query_agenda_uses_brisbane_window(requests_mock):
    """Brisbane is UTC+10 (spec §0). The executor must send the local-day
    window with offset, not a naive Z-suffixed range — otherwise a 7pm
    Brisbane query at the end of day misses events."""
    captured = []

    def get_cb(request, _ctx):
        captured.append(request.qs)
        return []

    requests_mock.get("http://api/api/events", json=get_cb)
    ex = Executor(base="http://api", token="t")
    res = IntentResult("query_agenda", {"date": "2026-06-04"}, 0.95, "")
    ex.apply(res)
    assert captured
    qs = captured[0]
    # requests-mock lower-cases keys
    assert "+10:00" in qs["start"][0]
    assert "+10:00" in qs["end"][0]


# --- dispatch fallback -----------------------------------------------------


def test_apply_returns_friendly_fallback_for_unknown_intent():
    ex = Executor(base="http://api", token="t")
    res = IntentResult("unknown", {"reason": "no_json"}, 0.0, "")
    out = ex.apply(res)
    assert out["ok"] is False
    assert "didn't catch" in out["spoken"].lower()
