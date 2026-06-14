from homecal_voice.executor import Executor, _canon_meal, _unwrap, _speak_time, _join_natural
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
    # Times render TTS-friendly (5pm) not 24h (17:00).
    assert "5pm" in out["spoken"]
    # Final item joined with "and" — reads naturally.
    assert " and " in out["spoken"]


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


# --- _speak_time + _join_natural ------------------------------------------


def test_speak_time_on_the_hour():
    assert _speak_time("17:00") == "5pm"
    assert _speak_time("09:00") == "9am"
    assert _speak_time("00:00") == "12am"
    assert _speak_time("12:00") == "12pm"


def test_speak_time_with_minutes():
    assert _speak_time("15:30") == "3:30pm"
    assert _speak_time("09:15") == "9:15am"


def test_speak_time_falls_back_on_garbage():
    assert _speak_time("garbage") == "garbage"
    assert _speak_time("") == ""


def test_join_natural_zero_one_two_three():
    assert _join_natural([]) == ""
    assert _join_natural(["a"]) == "a"
    assert _join_natural(["a", "b"]) == "a and b"
    assert _join_natural(["a", "b", "c"]) == "a, b, and c"


# --- query_dinner natural phrasing ----------------------------------------


def test_query_dinner_uses_possessive_for_today(requests_mock):
    """'Today's dinner is curry' reads naturally; the old colon form
    ('Today dinner: curry') sounded like a header, not a sentence."""
    from homecal_voice.timezone import today_brisbane
    today = today_brisbane()
    requests_mock.get(
        "http://api/api/dinners",
        json=[{"date": today, "meal": "Curry"}],
    )
    ex = Executor(base="http://api", token="t")
    res = IntentResult("query_dinner", {"date": today}, 0.95, "")
    out = ex.apply(res)
    assert out["spoken"] == "Tonight's dinner is Curry."


def test_query_dinner_empty_uses_natural_phrasing(requests_mock):
    from homecal_voice.timezone import today_brisbane
    today = today_brisbane()
    requests_mock.get("http://api/api/dinners", json=[])
    ex = Executor(base="http://api", token="t")
    res = IntentResult("query_dinner", {"date": today}, 0.95, "")
    out = ex.apply(res)
    # No colon, reads as a sentence.
    assert ":" not in out["spoken"]
    assert "nothing planned for dinner today" in out["spoken"].lower()


# --- dispatch fallback -----------------------------------------------------


def test_apply_returns_friendly_fallback_for_unknown_intent():
    ex = Executor(base="http://api", token="t")
    res = IntentResult("unknown", {"reason": "no_json"}, 0.0, "")
    out = ex.apply(res)
    assert out["ok"] is False
    assert "didn't catch" in out["spoken"].lower()


from homecal_voice.executor import humanise_duration, _remaining_seconds
from datetime import datetime, timezone


# --- humanise_duration -----------------------------------------------------


def test_humanise_duration_sub_minute_uses_seconds():
    assert humanise_duration(45) == "45 seconds"
    assert humanise_duration(1) == "1 second"


def test_humanise_duration_whole_minutes():
    assert humanise_duration(60) == "1 minute"
    assert humanise_duration(600) == "10 minutes"


def test_humanise_duration_hours_and_minutes():
    assert humanise_duration(3600) == "1 hour"
    assert humanise_duration(3660) == "1 hour and 1 minute"
    assert humanise_duration(7800) == "2 hours and 10 minutes"


def test_humanise_duration_drops_seconds_when_minutes_present():
    # 90s -> "1 minute" not "1 minute and 30 seconds" — TTS reads cleaner
    # for kitchen-timer use; sub-minute precision only matters for sub-minute
    # timers themselves.
    assert humanise_duration(90) == "1 minute"


def test_remaining_seconds_floors_at_zero():
    now = datetime(2026, 6, 6, 10, 0, 0, tzinfo=timezone.utc)
    assert _remaining_seconds("2026-06-06T10:05:00Z", now) == 300
    assert _remaining_seconds("2026-06-06T09:55:00Z", now) == 0  # already expired


# --- timer_set -------------------------------------------------------------


def test_timer_set_posts_to_timers_with_label(requests_mock):
    posted = []

    def cb(request, _ctx):
        posted.append(request.json())
        return {"id": "t1", "label": "pasta", "durationSec": 600, "expiresAt": "2026-06-06T10:10:00Z"}

    requests_mock.post("http://api/api/timers", json=cb)
    ex = Executor(base="http://api", token="t")
    out = ex.apply(IntentResult("timer_set", {"duration_sec": 600, "label": "pasta"}, 1.0, ""))
    assert out["ok"] is True
    assert posted[0] == {"durationSec": 600, "label": "pasta"}
    assert "pasta timer" in out["spoken"].lower()
    assert "10 minutes" in out["spoken"]


def test_timer_set_without_label_says_just_timer(requests_mock):
    requests_mock.post(
        "http://api/api/timers",
        json={"id": "t1", "label": None, "durationSec": 60, "expiresAt": "2026-06-06T10:01:00Z"},
    )
    ex = Executor(base="http://api", token="t")
    out = ex.apply(IntentResult("timer_set", {"duration_sec": 60, "label": None}, 1.0, ""))
    assert out["ok"] is True
    assert "timer set" in out["spoken"].lower()
    assert "1 minute" in out["spoken"]


# --- timer_query -----------------------------------------------------------


def test_timer_query_resolves_by_label_and_speaks_remaining(requests_mock):
    far_future = "2099-01-01T00:10:00Z"  # always plenty left
    requests_mock.get(
        "http://api/api/timers",
        json=[
            {"id": "t1", "label": "pasta", "expiresAt": far_future, "startedAt": "2026-06-06T10:00:00Z"},
            {"id": "t2", "label": "eggs", "expiresAt": far_future, "startedAt": "2026-06-06T10:01:00Z"},
        ],
    )
    ex = Executor(base="http://api", token="t")
    out = ex.apply(IntentResult("timer_query", {"label": "pasta"}, 1.0, ""))
    assert out["ok"] is True
    assert "pasta timer" in out["spoken"].lower()
    assert "left" in out["spoken"]


def test_timer_query_no_label_and_single_timer_picks_it(requests_mock):
    requests_mock.get(
        "http://api/api/timers",
        json=[{"id": "t1", "label": "pasta", "expiresAt": "2099-01-01T00:10:00Z", "startedAt": "2026-06-06T10:00:00Z"}],
    )
    ex = Executor(base="http://api", token="t")
    out = ex.apply(IntentResult("timer_query", {"label": None}, 1.0, ""))
    assert out["ok"] is True
    assert "pasta" in out["spoken"].lower()


def test_timer_query_no_label_and_multiple_timers_is_ambiguous(requests_mock):
    requests_mock.get(
        "http://api/api/timers",
        json=[
            {"id": "t1", "label": "pasta", "expiresAt": "2099-01-01T00:10:00Z", "startedAt": "2026-06-06T10:00:00Z"},
            {"id": "t2", "label": "eggs",  "expiresAt": "2099-01-01T00:10:00Z", "startedAt": "2026-06-06T10:01:00Z"},
        ],
    )
    ex = Executor(base="http://api", token="t")
    out = ex.apply(IntentResult("timer_query", {"label": None}, 1.0, ""))
    assert out["ok"] is False
    assert out["error"] == "ambiguous_timer"


def test_timer_query_no_active_timers(requests_mock):
    requests_mock.get("http://api/api/timers", json=[])
    ex = Executor(base="http://api", token="t")
    out = ex.apply(IntentResult("timer_query", {"label": None}, 1.0, ""))
    assert out["ok"] is True
    assert "no timer" in out["spoken"].lower()


def test_timer_query_unknown_label(requests_mock):
    requests_mock.get(
        "http://api/api/timers",
        json=[{"id": "t1", "label": "pasta", "expiresAt": "2099-01-01T00:10:00Z", "startedAt": "2026-06-06T10:00:00Z"}],
    )
    ex = Executor(base="http://api", token="t")
    out = ex.apply(IntentResult("timer_query", {"label": "lasagna"}, 1.0, ""))
    assert out["ok"] is False
    assert out["error"] == "unknown_label"


# --- timer_cancel ----------------------------------------------------------


def test_timer_cancel_resolves_then_deletes(requests_mock):
    requests_mock.get(
        "http://api/api/timers",
        json=[{"id": "t1", "label": "pasta", "expiresAt": "2099-01-01T00:10:00Z", "startedAt": "2026-06-06T10:00:00Z"}],
    )
    deleted = []

    def cb(request, ctx):
        deleted.append(request.url)
        ctx.status_code = 204
        return ""

    requests_mock.delete("http://api/api/timers/t1", text=cb)
    ex = Executor(base="http://api", token="t")
    out = ex.apply(IntentResult("timer_cancel", {"label": "pasta"}, 1.0, ""))
    assert out["ok"] is True
    assert any("/api/timers/t1" in u for u in deleted)


def test_timer_cancel_no_active_timer(requests_mock):
    requests_mock.get("http://api/api/timers", json=[])
    ex = Executor(base="http://api", token="t")
    out = ex.apply(IntentResult("timer_cancel", {"label": None}, 1.0, ""))
    assert out["ok"] is False
    assert out["error"] == "no_timer"


# --- timer_extend ----------------------------------------------------------


def test_timer_extend_patches_with_addSec(requests_mock):
    requests_mock.get(
        "http://api/api/timers",
        json=[{"id": "t1", "label": "pasta", "expiresAt": "2099-01-01T00:10:00Z", "startedAt": "2026-06-06T10:00:00Z"}],
    )
    patched = []

    def cb(request, _ctx):
        patched.append(request.json())
        return {"id": "t1", "label": "pasta", "expiresAt": "2099-01-01T00:12:00Z"}

    requests_mock.patch("http://api/api/timers/t1", json=cb)
    ex = Executor(base="http://api", token="t")
    out = ex.apply(IntentResult("timer_extend", {"duration_sec": 120, "label": "pasta"}, 1.0, ""))
    assert out["ok"] is True
    assert patched[0] == {"addSec": 120}
    assert "added 2 minutes" in out["spoken"].lower()


def test_timer_extend_requires_duration():
    ex = Executor(base="http://api", token="t")
    out = ex.apply(IntentResult("timer_extend", {"label": "pasta"}, 1.0, ""))
    assert out["ok"] is False
    assert out["error"] == "missing_duration"


def test_timer_extend_no_timer(requests_mock):
    requests_mock.get("http://api/api/timers", json=[])
    ex = Executor(base="http://api", token="t")
    out = ex.apply(IntentResult("timer_extend", {"duration_sec": 60, "label": None}, 1.0, ""))
    assert out["ok"] is False
    assert out["error"] == "no_timer"


def test_timer_extend_ambiguous(requests_mock):
    requests_mock.get(
        "http://api/api/timers",
        json=[
            {"id": "t1", "label": "pasta", "expiresAt": "2099-01-01T00:10:00Z", "startedAt": "2026-06-06T10:00:00Z"},
            {"id": "t2", "label": "eggs",  "expiresAt": "2099-01-01T00:10:00Z", "startedAt": "2026-06-06T10:01:00Z"},
        ],
    )
    ex = Executor(base="http://api", token="t")
    out = ex.apply(IntentResult("timer_extend", {"duration_sec": 60, "label": None}, 1.0, ""))
    assert out["ok"] is False
    assert out["error"] == "ambiguous_timer"


def test_timer_extend_unknown_label(requests_mock):
    requests_mock.get(
        "http://api/api/timers",
        json=[{"id": "t1", "label": "pasta", "expiresAt": "2099-01-01T00:10:00Z", "startedAt": "2026-06-06T10:00:00Z"}],
    )
    ex = Executor(base="http://api", token="t")
    out = ex.apply(IntentResult("timer_extend", {"duration_sec": 60, "label": "lasagna"}, 1.0, ""))
    assert out["ok"] is False
    assert out["error"] == "unknown_label"


def test_timer_extend_without_label_picks_singleton(requests_mock):
    requests_mock.get(
        "http://api/api/timers",
        json=[{"id": "t1", "label": None, "expiresAt": "2099-01-01T00:10:00Z", "startedAt": "2026-06-06T10:00:00Z"}],
    )
    requests_mock.patch(
        "http://api/api/timers/t1",
        json={"id": "t1", "label": None, "expiresAt": "2099-01-01T00:12:00Z"},
    )
    ex = Executor(base="http://api", token="t")
    out = ex.apply(IntentResult("timer_extend", {"duration_sec": 120, "label": None}, 1.0, ""))
    assert out["ok"] is True
    # No label means the spoken reply says just "Timer", not "<label> timer".
    assert "timer has" in out["spoken"].lower()


def test_remaining_seconds_handles_missing_expires_at():
    """Bad payload (None) doesn't crash — logs and returns 0."""
    from datetime import datetime, timezone
    assert _remaining_seconds(None, datetime.now(timezone.utc)) == 0


def test_remaining_seconds_handles_malformed_expires_at():
    from datetime import datetime, timezone
    assert _remaining_seconds("not-a-date", datetime.now(timezone.utc)) == 0


# --- noise_play ------------------------------------------------------------

from unittest.mock import MagicMock
from pathlib import Path
from homecal_voice import catalog as kid_catalog


def test_noise_play_catalog_hit_plays_clip():
    play = MagicMock()
    ex = Executor(base="http://api", token="t", play_clip=play)
    intent = IntentResult("noise_play", {"catalog_key": "chicken"}, 1.0, "make a chicken noise", source="matcher")
    out = ex.apply(intent)
    assert out["ok"] is True
    assert out["spoken"] == ""  # no chip flash; noise IS the feedback
    play.assert_called_once()
    # The played path must resolve under the catalog's clips dir.
    played = play.call_args.args[0]
    assert Path(played).name == "chicken.mp3"


def test_noise_play_haiku_fallback_returns_fallback_text_for_main_to_speak():
    play = MagicMock()
    ex = Executor(base="http://api", token="t", play_clip=play)
    intent = IntentResult(
        "noise_play",
        {"play_catalog": "chicken", "fallback_text": "I don't know dolphin yet, but here's a chicken!"},
        0.9, "make a dolphin noise", source="llm",
    )
    out = ex.apply(intent)
    assert out["ok"] is True
    assert "chicken" in out["spoken"]
    play.assert_called_once()


def test_noise_play_unknown_catalog_key_returns_soft_failure():
    play = MagicMock()
    ex = Executor(base="http://api", token="t", play_clip=play)
    intent = IntentResult("noise_play", {"play_catalog": "nonexistent"}, 0.9, "x", source="llm")
    out = ex.apply(intent)
    assert out["ok"] is False
    assert "unknown_catalog_key" in out.get("error", "")
    play.assert_not_called()


def test_noise_play_missing_both_keys_returns_missing_key_error():
    play = MagicMock()
    ex = Executor(base="http://api", token="t", play_clip=play)
    intent = IntentResult("noise_play", {}, 0.9, "x", source="llm")
    out = ex.apply(intent)
    assert out["ok"] is False
    assert "missing_key" in out.get("error", "")
    play.assert_not_called()


def test_noise_play_works_without_play_clip_dep_returns_failure():
    """Backwards compat: if play_clip wasn't injected (older wiring), fail
    softly rather than crash mid-utterance."""
    ex = Executor(base="http://api", token="t")  # no play_clip
    intent = IntentResult("noise_play", {"catalog_key": "chicken"}, 1.0, "x", source="matcher")
    out = ex.apply(intent)
    assert out["ok"] is False
    assert out.get("error", "").startswith("noise_play_no_player") or "no_player" in out.get("error", "")


# --- joke_tell ----------------------------------------------------------------


def test_joke_tell_speaks_setup_then_pause_then_punchline():
    spoken_calls = []
    sleep_calls = []
    speak = MagicMock(side_effect=lambda text: spoken_calls.append(text))
    sleep = MagicMock(side_effect=lambda s: sleep_calls.append(s))
    ex = Executor(base="http://api", token="t", speak=speak, sleep=sleep)
    intent = IntentResult(
        "joke_tell",
        {"joke_id": "j001", "setup": "Why?", "punchline": "Because!"},
        1.0, "tell me a joke", source="matcher",
    )
    out = ex.apply(intent)
    assert out["ok"] is True
    assert out.get("spoken_inline") is True
    assert spoken_calls == ["Why?", "Because!"]
    assert sleep_calls == [1.5]


def test_joke_tell_returns_combined_answer_for_audit():
    """`spoken` is for the audit log — joke_tell uses it to preserve the full
    setup+punchline string so voice_utterances.answer captures the whole joke.
    `spoken_inline=True` signals main.py NOT to TTS this again."""
    ex = Executor(base="http://api", token="t", speak=MagicMock(), sleep=MagicMock())
    intent = IntentResult(
        "joke_tell",
        {"setup": "Why?", "punchline": "Because!"},
        1.0, "tell me a joke", source="matcher",
    )
    out = ex.apply(intent)
    assert out["spoken"] == "Why? ... Because!"
    assert out.get("spoken_inline") is True


def test_joke_tell_missing_setup_returns_failure():
    ex = Executor(base="http://api", token="t", speak=MagicMock(), sleep=MagicMock())
    intent = IntentResult("joke_tell", {"punchline": "x"}, 0.9, "x", source="llm")
    out = ex.apply(intent)
    assert out["ok"] is False
    assert "missing_fields" in out.get("error", "")


def test_joke_tell_missing_punchline_returns_failure():
    ex = Executor(base="http://api", token="t", speak=MagicMock(), sleep=MagicMock())
    intent = IntentResult("joke_tell", {"setup": "Why?"}, 0.9, "x", source="llm")
    out = ex.apply(intent)
    assert out["ok"] is False
    assert "missing_fields" in out.get("error", "")


def test_joke_tell_without_deps_returns_failure():
    ex = Executor(base="http://api", token="t")  # no speak/sleep deps
    intent = IntentResult(
        "joke_tell",
        {"setup": "Why?", "punchline": "Because!"},
        1.0, "x", source="matcher",
    )
    out = ex.apply(intent)
    assert out["ok"] is False
    assert "joke_tell_no_speaker" in out.get("error", "") or "no_speaker" in out.get("error", "")


# --- ask_question -------------------------------------------------------------


def test_ask_question_speaks_answer():
    ex = Executor(base="http://api", token="t")
    intent = IntentResult(
        "ask_question",
        {"answer": "Because of light scattering!", "concern": False},
        0.95, "why is the sky blue", source="llm",
    )
    out = ex.apply(intent)
    assert out["ok"] is True
    assert out["spoken"] == "Because of light scattering!"
    assert out.get("concern") is False


def test_ask_question_redirects_on_banned_term():
    """Defence-in-depth: if Haiku slips and emits a banned term, the safety
    regex overrides the answer to the redirect line."""
    from homecal_voice.safety import REDIRECT_LINE
    ex = Executor(base="http://api", token="t")
    intent = IntentResult(
        "ask_question",
        {"answer": "That word fuck is not allowed.", "concern": False},
        0.95, "x", source="llm",
    )
    out = ex.apply(intent)
    assert out["ok"] is True
    assert out["spoken"] == REDIRECT_LINE


def test_ask_question_concern_path_uses_disclosure_text():
    """concern=true → speak the LLM-provided answer verbatim (which the
    prompt constrains to the fixed disclosure line) and flag the audit row."""
    ex = Executor(base="http://api", token="t")
    intent = IntentResult(
        "ask_question",
        {
            "answer": "That sounds important. Please tell your mum or dad right now — they want to help.",
            "concern": True,
        },
        0.95, "my tummy hurts and bleeds", source="llm",
    )
    out = ex.apply(intent)
    assert out["ok"] is True
    assert out.get("concern") is True
    assert "mum or dad" in out["spoken"]


def test_ask_question_concern_bypasses_safety_regex():
    """Even if the concern answer somehow contained a banned word (it shouldn't,
    per the prompt), the concern path must not get rewritten to the redirect —
    a child reporting distress should hear the disclosure, not a deflection."""
    from homecal_voice.safety import REDIRECT_LINE
    ex = Executor(base="http://api", token="t")
    # Construct an answer that DOES contain a banned term to assert the bypass.
    intent = IntentResult(
        "ask_question",
        {"answer": "Please tell your mum or dad now — even if it's about fuck.", "concern": True},
        0.95, "x", source="llm",
    )
    out = ex.apply(intent)
    assert out["ok"] is True
    assert out.get("concern") is True
    assert out["spoken"] != REDIRECT_LINE
    assert "mum or dad" in out["spoken"]


def test_ask_question_truncates_long_answer_to_40_words():
    long_answer = " ".join(["word"] * 60)
    ex = Executor(base="http://api", token="t")
    intent = IntentResult("ask_question", {"answer": long_answer, "concern": False}, 0.95, "x", source="llm")
    out = ex.apply(intent)
    assert out["ok"] is True
    word_count = len(out["spoken"].split())
    assert word_count <= 40


def test_ask_question_missing_answer_returns_failure():
    ex = Executor(base="http://api", token="t")
    intent = IntentResult("ask_question", {"confidence": 0.9}, 0.9, "x", source="llm")
    out = ex.apply(intent)
    assert out["ok"] is False
    assert "missing" in out.get("error", "").lower()


def test_ask_question_concern_defaults_to_false_when_absent():
    """When Haiku omits the concern flag, treat as false (normal path)."""
    ex = Executor(base="http://api", token="t")
    intent = IntentResult("ask_question", {"answer": "It's blue!"}, 0.95, "x", source="llm")
    out = ex.apply(intent)
    assert out["ok"] is True
    assert out.get("concern") is False


def test_noise_play_clip_exception_audits_soft_failure():
    """Spec: clip playback failures must not bubble into the wrong-error speak path."""
    play = MagicMock(side_effect=RuntimeError("mpg123 crashed"))
    ex = Executor(base="http://api", token="t", play_clip=play)
    intent = IntentResult("noise_play", {"catalog_key": "chicken"}, 1.0, "make a chicken noise", source="matcher")
    out = ex.apply(intent)
    assert out["ok"] is False
    assert out["spoken"] == ""
    assert "clip_play" in out["error"]
    play.assert_called_once()  # the failure was actually attempted


def test_joke_tell_setup_exception_records_no_partial():
    """If setup TTS raises, the audit answer is empty (nothing was heard)."""
    speak = MagicMock(side_effect=[RuntimeError("tts down"), None])
    ex = Executor(base="http://api", token="t", speak=speak, sleep=MagicMock())
    intent = IntentResult("joke_tell", {"setup": "Why?", "punchline": "Because!"}, 1.0, "x", source="matcher")
    out = ex.apply(intent)
    assert out["ok"] is False
    assert out["spoken"] == ""
    assert "joke_setup_tts" in out["error"]


def test_joke_tell_punchline_exception_records_partial_setup():
    """If setup spoke but punchline TTS raised, audit `spoken` records what the kid heard."""
    speak = MagicMock(side_effect=[None, RuntimeError("tts down")])
    ex = Executor(base="http://api", token="t", speak=speak, sleep=MagicMock())
    intent = IntentResult("joke_tell", {"setup": "Why?", "punchline": "Because!"}, 1.0, "x", source="matcher")
    out = ex.apply(intent)
    assert out["ok"] is False
    assert out["spoken"] == "Why?"
    assert "joke_punchline_tts" in out["error"]


def test_ask_question_regex_override_flag_set_when_safety_fires():
    """Audit must record the regex trip so it's observable."""
    ex = Executor(base="http://api", token="t")
    intent = IntentResult("ask_question", {"answer": "fuck the science", "concern": False}, 0.95, "x", source="llm")
    out = ex.apply(intent)
    assert out["ok"] is True
    assert out.get("regex_override") is True


def test_ask_question_no_regex_override_on_clean_answer():
    ex = Executor(base="http://api", token="t")
    intent = IntentResult("ask_question", {"answer": "It's blue!", "concern": False}, 0.95, "x", source="llm")
    out = ex.apply(intent)
    assert out["ok"] is True
    assert out.get("regex_override") is False


# ---------------------------------------------------------------------------
# Fix B — quiet-hours suppression honesty (noise_play)
# ---------------------------------------------------------------------------
from unittest.mock import MagicMock


def test_noise_play_quiet_hours_suppression_returns_ok_false():
    """When the play_clip wrapper returns False (quiet hours), the executor
    audits the truth: the kid heard nothing. Spec §3.11."""
    play_returning_false = MagicMock(return_value=False)
    ex = Executor(base="http://api", token="t", play_clip=play_returning_false)
    intent = IntentResult("noise_play", {"catalog_key": "chicken"}, 1.0, "make a chicken noise", source="matcher")
    out = ex.apply(intent)
    assert out["ok"] is False
    assert out["error"] == "quiet_hours_suppressed"
    assert out.get("quiet_suppressed") is True
    play_returning_false.assert_called_once()


def test_noise_play_clip_callable_returning_none_still_treated_as_success():
    """Backwards compat: a play_clip that returns None (raw tts_play_file)
    is still a successful play — only explicit False means suppression."""
    play_returning_none = MagicMock(return_value=None)
    ex = Executor(base="http://api", token="t", play_clip=play_returning_none)
    intent = IntentResult("noise_play", {"catalog_key": "chicken"}, 1.0, "x", source="matcher")
    out = ex.apply(intent)
    assert out["ok"] is True


# ---------------------------------------------------------------------------
# Fix E — Group 3a: _truncate_words at exactly 40 words
# ---------------------------------------------------------------------------


def test_ask_question_truncation_at_exactly_40_words_preserves_full_answer():
    """Lock the inclusive boundary: <= max_words → unchanged.
    A future change from <= to < would silently drop the 40th word."""
    answer_40 = " ".join([f"word{i}" for i in range(40)])
    assert len(answer_40.split()) == 40
    ex = Executor(base="http://api", token="t")
    intent = IntentResult("ask_question", {"answer": answer_40, "concern": False}, 0.95, "x", source="llm")
    out = ex.apply(intent)
    assert out["spoken"] == answer_40  # not truncated


# ---------------------------------------------------------------------------
# Fix E — Group 3b: noise_play payload with BOTH catalog_key and play_catalog
# ---------------------------------------------------------------------------


def test_noise_play_prefers_catalog_key_over_play_catalog_when_both_present():
    """Documents the key-selection precedence: `catalog_key` wins over
    `play_catalog` (first truthy value via `or`), so the played clip is
    always `chicken` when both are present.

    NOTE: the current implementation returns `fallback_text` regardless of
    which key resolved — this test pins that observable behaviour so any
    future change to suppress `fallback_text` on the catalog_key path is
    a deliberate, visible diff rather than a silent regression."""
    play = MagicMock()
    ex = Executor(base="http://api", token="t", play_clip=play)
    intent = IntentResult(
        "noise_play",
        {"catalog_key": "chicken", "play_catalog": "dog", "fallback_text": "fallback"},
        1.0, "x", source="matcher",
    )
    out = ex.apply(intent)
    assert out["ok"] is True
    # The played path must be chicken (catalog_key wins in the `or` expression).
    played = play.call_args.args[0]
    from pathlib import Path
    assert Path(played).name == "chicken.mp3"
    # Current behaviour: fallback_text is returned regardless of which key
    # resolved. A future fix that suppresses it on catalog_key paths would
    # change this assertion to `== ""`.
    assert out["spoken"] == "fallback"


# ---------------------------------------------------------------------------
# Task 22 — _noise_play hits sidecar catalog endpoint
# ---------------------------------------------------------------------------


def test_noise_play_uses_catalog_fetch_when_provided(monkeypatch):
    """When fetch_catalog returns bytes, _noise_play plays those bytes and
    returns spoken="" (no TTS dance for matcher hits)."""
    from homecal_voice.executor import Executor
    from homecal_voice.intent import IntentResult

    play_bytes = MagicMock()
    fetch_catalog = MagicMock(return_value=b"RIFFfake")

    ex = Executor(
        base="http://api", token="t",
        play_clip=MagicMock(), speak=MagicMock(),
        play_bytes=play_bytes, fetch_catalog=fetch_catalog,
    )
    out = ex.apply(IntentResult("noise_play", {"catalog_key": "fart"}, 1.0, "raw"))
    assert out["ok"] is True
    assert out["spoken"] == ""
    fetch_catalog.assert_called_once_with("noise", "fart")
    play_bytes.assert_called_once_with(b"RIFFfake", format="wav")


def test_noise_play_falls_through_to_old_path_on_catalog_miss():
    """If fetch_catalog returns None (404), fall through to today's
    play_clip-from-disk behaviour."""
    from homecal_voice.executor import Executor
    from homecal_voice.intent import IntentResult

    play_clip = MagicMock()
    fetch_catalog = MagicMock(return_value=None)
    ex = Executor(
        base="http://api", token="t",
        play_clip=play_clip, speak=MagicMock(),
        play_bytes=MagicMock(), fetch_catalog=fetch_catalog,
    )
    out = ex.apply(IntentResult("noise_play", {"catalog_key": "fart"}, 1.0, "raw"))
    # On a miss, today's behaviour: load the clip file from disk + play_clip it.
    play_clip.assert_called_once()
    assert out["ok"] is True


# ---------------------------------------------------------------------------
# Task 23 — _joke_tell hits sidecar joke catalog endpoint
# ---------------------------------------------------------------------------


def test_joke_tell_uses_catalog_fetch_when_provided():
    from homecal_voice.executor import Executor
    from homecal_voice.intent import IntentResult

    play_bytes = MagicMock()
    fetch_catalog = MagicMock(return_value=b"RIFFjokeaudio")

    ex = Executor(
        base="http://api", token="t",
        play_clip=MagicMock(), speak=MagicMock(), sleep=MagicMock(),
        play_bytes=play_bytes, fetch_catalog=fetch_catalog,
    )
    out = ex.apply(IntentResult(
        "joke_tell",
        {"joke_id": "j001", "setup": "Why X?", "punchline": "Because Y"},
        1.0, "raw",
    ))
    assert out["ok"] is True
    assert out.get("spoken_inline") is True
    fetch_catalog.assert_called_once_with("joke", "j001")
    play_bytes.assert_called_once_with(b"RIFFjokeaudio", format="wav")


def test_joke_tell_falls_through_to_tts_setup_pause_punchline_on_miss():
    """If fetch_catalog returns None (joke not pre-rendered), fall back to
    today's setup → 1.5s pause → punchline via TTS."""
    from homecal_voice.executor import Executor
    from homecal_voice.intent import IntentResult

    speak = MagicMock()
    sleep = MagicMock()
    fetch_catalog = MagicMock(return_value=None)
    ex = Executor(
        base="http://api", token="t",
        play_clip=MagicMock(), speak=speak, sleep=sleep,
        play_bytes=MagicMock(), fetch_catalog=fetch_catalog,
    )
    out = ex.apply(IntentResult(
        "joke_tell",
        {"joke_id": "j999", "setup": "Knock knock", "punchline": "Who's there"},
        1.0, "raw",
    ))
    assert out["ok"] is True
    speak.assert_any_call("Knock knock")
    sleep.assert_called_once_with(1.5)


# ---------------------------------------------------------------------------
# Bug 2 fix — catalog-hit returns include tts_provider="kokoro_lan"
# ---------------------------------------------------------------------------


def test_noise_play_catalog_hit_includes_tts_provider():
    """Catalog-hit path must tag tts_provider='kokoro_lan' so the audit row
    is not NULL — the sidecar played the WAV directly, bypassing _speak."""
    from homecal_voice.executor import Executor
    from homecal_voice.intent import IntentResult

    play_bytes = MagicMock()
    fetch_catalog = MagicMock(return_value=b"RIFFfake")

    ex = Executor(
        base="http://api", token="t",
        play_clip=MagicMock(), speak=MagicMock(),
        play_bytes=play_bytes, fetch_catalog=fetch_catalog,
    )
    out = ex.apply(IntentResult("noise_play", {"catalog_key": "fart"}, 1.0, "raw"))
    assert out["ok"] is True
    assert out.get("tts_provider") == "kokoro_lan"


def test_joke_tell_catalog_hit_includes_tts_provider():
    """Same guarantee for joke_tell: catalog-hit must tag tts_provider='kokoro_lan'."""
    from homecal_voice.executor import Executor
    from homecal_voice.intent import IntentResult

    play_bytes = MagicMock()
    fetch_catalog = MagicMock(return_value=b"RIFFjokeaudio")

    ex = Executor(
        base="http://api", token="t",
        play_clip=MagicMock(), speak=MagicMock(), sleep=MagicMock(),
        play_bytes=play_bytes, fetch_catalog=fetch_catalog,
    )
    out = ex.apply(IntentResult(
        "joke_tell",
        {"joke_id": "j001", "setup": "Why X?", "punchline": "Because Y"},
        1.0, "raw",
    ))
    assert out["ok"] is True
    assert out.get("tts_provider") == "kokoro_lan"
