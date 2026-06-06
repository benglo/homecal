"""Timer patterns are registered as no-op recognisers: the matcher extracts
duration + label correctly and emits a timer_* intent, but the executor
returns 'Timers aren't ready yet' until the feature lands. The audit log
captures the failed intent so we can count missed timer requests.
"""

from homecal_voice.matcher import MatchContext, Matcher
from homecal_voice.patterns_timer import register_timer


def _matcher() -> Matcher:
    m = Matcher()
    register_timer(m)
    return m


def _ctx() -> MatchContext:
    return MatchContext(today="2026-06-05", family=[], chores=[])


# timer_set


def test_timer_set_minutes():
    r = _matcher().try_match("set a timer for 10 minutes", _ctx())
    assert r is not None
    assert r.intent == "timer_set"
    assert r.fields["duration_sec"] == 600
    assert r.fields["label"] is None


def test_timer_set_with_label():
    r = _matcher().try_match("set a pasta timer for 10 minutes", _ctx())
    assert r is not None
    assert r.intent == "timer_set"
    assert r.fields == {"duration_sec": 600, "label": "pasta"}


def test_timer_set_duration_before_label():
    r = _matcher().try_match("set a 25 minute pasta timer", _ctx())
    assert r is not None
    assert r.fields == {"duration_sec": 1500, "label": "pasta"}


def test_timer_set_word_number():
    r = _matcher().try_match("set a timer for ten minutes", _ctx())
    assert r is not None
    assert r.fields["duration_sec"] == 600


def test_timer_set_an_hour():
    r = _matcher().try_match("set a timer for an hour", _ctx())
    assert r is not None
    assert r.fields["duration_sec"] == 3600


def test_timer_set_no_duration_falls_through():
    """'set a timer' alone has no duration — LLM may clarify."""
    assert _matcher().try_match("set a timer", _ctx()) is None


# timer_query


def test_timer_query_how_long():
    r = _matcher().try_match("how long left on the timer", _ctx())
    assert r is not None
    assert r.intent == "timer_query"


def test_timer_query_with_label():
    r = _matcher().try_match("how long on the pasta timer", _ctx())
    assert r is not None
    assert r.intent == "timer_query"
    assert r.fields["label"] == "pasta"


def test_timer_query_time_left():
    r = _matcher().try_match("time left on the timer", _ctx())
    assert r is not None
    assert r.intent == "timer_query"


# timer_cancel


def test_timer_cancel_plain():
    r = _matcher().try_match("cancel the timer", _ctx())
    assert r is not None
    assert r.intent == "timer_cancel"


def test_timer_cancel_with_label():
    r = _matcher().try_match("cancel the pasta timer", _ctx())
    assert r is not None
    assert r.intent == "timer_cancel"
    assert r.fields["label"] == "pasta"


def test_timer_cancel_stop_verb():
    r = _matcher().try_match("stop the timer", _ctx())
    assert r is not None
    assert r.intent == "timer_cancel"


# timer_extend


def test_timer_extend():
    r = _matcher().try_match("add 2 more minutes to the timer", _ctx())
    assert r is not None
    assert r.intent == "timer_extend"
    assert r.fields["duration_sec"] == 120


def test_timer_extend_with_label():
    r = _matcher().try_match("add 5 minutes to the pasta timer", _ctx())
    assert r is not None
    assert r.intent == "timer_extend"
    assert r.fields == {"duration_sec": 300, "label": "pasta"}


# Unrelated text falls through


def test_no_timer_word_no_match():
    assert _matcher().try_match("what's for dinner", _ctx()) is None
    assert _matcher().try_match("10 minutes from now we eat", _ctx()) is None


def test_timer_word_without_actionable_intent_falls_through():
    """Bare 'timer' with no verb + no duration — too thin to act on."""
    assert _matcher().try_match("the timer", _ctx()) is None
