"""Per-intent matcher coverage for the v1 surface.

Patterns are registered against a fresh Matcher per test (not the module
singleton) so tests stay independent and order-sensitive failures surface
at registration time.
"""

from homecal_voice.matcher import MatchContext, Matcher
from homecal_voice.patterns_v1 import register_v1


def _matcher() -> Matcher:
    m = Matcher()
    register_v1(m)
    return m


def _ctx(family=None, chores=None) -> MatchContext:
    return MatchContext(today="2026-06-05", family=family or [], chores=chores or [])


MIA = {"id": "fm-mia", "name": "Mia"}
LEO = {"id": "fm-leo", "name": "Leo"}
BATHROOM_MIA = {"id": "ch1", "title": "Bathroom", "assignedTo": "fm-mia"}
DISHES_MIA = {"id": "ch2", "title": "Dishes", "assignedTo": "fm-mia"}
BINS_LEO = {"id": "ch3", "title": "Bins", "assignedTo": "fm-leo"}


# dinner_set


def test_dinner_set_tonight_possessive():
    r = _matcher().try_match("tonight's dinner is curry", _ctx())
    assert r is not None
    assert r.intent == "dinner_set"
    assert r.fields == {"date": "2026-06-05", "meal": "curry"}
    assert r.confidence == 1.0


def test_dinner_set_no_possessive():
    r = _matcher().try_match("tomorrow dinner is pasta", _ctx())
    assert r is not None
    assert r.intent == "dinner_set"
    assert r.fields["date"] == "2026-06-06"
    assert r.fields["meal"] == "pasta"


def test_dinner_set_day_name():
    r = _matcher().try_match("friday's dinner is tacos", _ctx())
    assert r is not None
    assert r.fields["date"] == "2026-06-05"
    assert r.fields["meal"] == "tacos"


def test_dinner_set_next_day():
    r = _matcher().try_match("next monday's dinner is roast", _ctx())
    assert r is not None
    assert r.fields["date"] == "2026-06-08"
    assert r.fields["meal"] == "roast"


def test_dinner_set_were_having():
    r = _matcher().try_match("tomorrow we're having pizza", _ctx())
    assert r is not None
    assert r.intent == "dinner_set"
    assert r.fields == {"date": "2026-06-06", "meal": "pizza"}


def test_dinner_set_set_verb():
    r = _matcher().try_match("set tomorrow's dinner to pasta bake", _ctx())
    assert r is not None
    assert r.intent == "dinner_set"
    assert r.fields == {"date": "2026-06-06", "meal": "pasta bake"}


def test_dinner_set_multi_word_meal():
    r = _matcher().try_match("tonight's dinner is roast chicken and veg", _ctx())
    assert r is not None
    assert r.fields["meal"] == "roast chicken and veg"


def test_dinner_set_trailing_punctuation_stripped():
    r = _matcher().try_match("tonight's dinner is curry.", _ctx())
    assert r is not None
    assert r.fields["meal"] == "curry"


def test_dinner_set_unknown_date_falls_through():
    """'this weekend' isn't in the date-phrase whitelist — matcher returns
    None so the LLM gets the utterance."""
    assert _matcher().try_match("this weekend's dinner is roast", _ctx()) is None


def test_dinner_set_empty_meal_returns_none():
    """'tonight's dinner is' with no meal — let the LLM ask for clarification."""
    assert _matcher().try_match("tonight's dinner is ", _ctx()) is None


# query_dinner


def test_query_dinner_default_today():
    r = _matcher().try_match("what's for dinner", _ctx())
    assert r is not None
    assert r.intent == "query_dinner"
    assert r.fields == {"date": "2026-06-05"}


def test_query_dinner_explicit_date():
    r = _matcher().try_match("what's for dinner tomorrow", _ctx())
    assert r is not None
    assert r.fields["date"] == "2026-06-06"


def test_query_dinner_on_prefix():
    r = _matcher().try_match("what's for dinner on friday", _ctx())
    assert r is not None
    assert r.fields["date"] == "2026-06-05"


def test_query_dinner_what_are_we_having():
    r = _matcher().try_match("what are we having for dinner tonight", _ctx())
    assert r is not None
    assert r.intent == "query_dinner"
    assert r.fields["date"] == "2026-06-05"


def test_query_dinner_no_dinner_word():
    """'What are we having' without 'dinner' — too ambiguous, fall through."""
    assert _matcher().try_match("what are we doing", _ctx()) is None


# query_agenda


def test_query_agenda_whats_on_today():
    r = _matcher().try_match("what's on today", _ctx())
    assert r is not None
    assert r.intent == "query_agenda"
    assert r.fields == {"date": "2026-06-05"}


def test_query_agenda_whats_on_no_date():
    """Bare 'what's on' defaults to today."""
    r = _matcher().try_match("what's on", _ctx())
    assert r is not None
    assert r.fields["date"] == "2026-06-05"


def test_query_agenda_whats_happening():
    r = _matcher().try_match("what's happening tomorrow", _ctx())
    assert r is not None
    assert r.fields["date"] == "2026-06-06"


def test_query_agenda_anything_on():
    r = _matcher().try_match("anything on friday", _ctx())
    assert r is not None
    assert r.fields["date"] == "2026-06-05"


def test_query_agenda_rejects_whats_on_with_trailing_noun():
    """The 'on' branch must NOT swallow non-agenda utterances. Pinned because
    code-review flagged 'whats on netflix' triggering a wrong agenda lookup."""
    assert _matcher().try_match("whats on netflix", _ctx()) is None
    assert _matcher().try_match("what's on the menu", _ctx()) is None
    assert _matcher().try_match("anything on the table", _ctx()) is None


def test_query_agenda_accepts_trailing_punctuation():
    r = _matcher().try_match("what's on today?", _ctx())
    assert r is not None
    assert r.fields["date"] == "2026-06-05"


def test_query_agenda_day_looking_like():
    r = _matcher().try_match("what does my day look like", _ctx())
    assert r is not None
    assert r.intent == "query_agenda"
    assert r.fields["date"] == "2026-06-05"


# chore_complete


def test_chore_complete_did_verb():
    r = _matcher().try_match("mia did the bathroom", _ctx([MIA], [BATHROOM_MIA]))
    assert r is not None
    assert r.intent == "chore_complete"
    assert r.fields == {"person": "Mia", "chore": "Bathroom"}
    # Confidence below AUTO_APPLY so questions like "did Mia do the bathroom?"
    # land in the confirm card rather than auto-awarding a star.
    assert r.confidence < 0.85


def test_chore_complete_finished_verb():
    r = _matcher().try_match("mia finished her dishes", _ctx([MIA], [BATHROOM_MIA, DISHES_MIA]))
    assert r is not None
    assert r.fields == {"person": "Mia", "chore": "Dishes"}


def test_chore_complete_possessive_done():
    r = _matcher().try_match("mia's bathroom is done", _ctx([MIA], [BATHROOM_MIA]))
    assert r is not None
    assert r.fields == {"person": "Mia", "chore": "Bathroom"}


def test_chore_complete_routes_to_owners_chore():
    """When two people exist, the chore must belong to the named person —
    'Leo did the bathroom' fails because the bathroom is Mia's."""
    r = _matcher().try_match("leo did the bathroom", _ctx([MIA, LEO], [BATHROOM_MIA, BINS_LEO]))
    assert r is None


def test_chore_complete_no_person_falls_through():
    """No name in the text → fall through to LLM (which has stronger context)."""
    assert _matcher().try_match("did the bathroom", _ctx([MIA], [BATHROOM_MIA])) is None


def test_chore_complete_no_chore_falls_through():
    """Verb + person but no recognised chore — LLM may know the synonym."""
    assert _matcher().try_match("mia did her chores", _ctx([MIA], [BATHROOM_MIA])) is None


def test_chore_complete_unrelated_done_falls_through():
    """'Mia is done with school' — done verb fires but no chore matches."""
    assert _matcher().try_match("mia is done with school", _ctx([MIA], [BATHROOM_MIA])) is None


# Cross-intent (registry ordering)


def test_dinner_set_beats_query_dinner_on_same_text():
    """'tonight's dinner is curry' must match dinner_set, not be derailed by
    the query_dinner permissive pattern."""
    r = _matcher().try_match("tonight's dinner is curry", _ctx())
    assert r is not None
    assert r.intent == "dinner_set"


def test_unknown_text_returns_none():
    assert _matcher().try_match("please play some music", _ctx()) is None
    assert _matcher().try_match("turn on the lights", _ctx()) is None
