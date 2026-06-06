import re

from homecal_voice.intent import IntentResult
from homecal_voice.matcher import IntentPattern, MatchContext, Matcher


def _ctx() -> MatchContext:
    return MatchContext(today="2026-06-05", family=[], chores=[])


def _always(intent: str, fields: dict | None = None, conf: float = 1.0) -> IntentPattern:
    """Pattern that fires on any non-empty input."""
    def extract(m, text, ctx):
        return IntentResult(intent, fields or {}, conf, text)
    return IntentPattern(intent=intent, regex=re.compile(r".+"), extractor=extract, name=f"always:{intent}")


def test_empty_matcher_returns_none():
    m = Matcher()
    assert m.try_match("anything", _ctx()) is None


def test_empty_transcript_returns_none():
    m = Matcher()
    m.register(_always("dinner_set"))
    assert m.try_match("", _ctx()) is None
    assert m.try_match("   ", _ctx()) is None


def test_none_transcript_returns_none():
    m = Matcher()
    m.register(_always("dinner_set"))
    assert m.try_match(None, _ctx()) is None  # type: ignore[arg-type]


def test_registered_pattern_match_returns_intent_result():
    m = Matcher()
    m.register(_always("dinner_set", {"date": "2026-06-05", "meal": "tacos"}, 0.95))
    r = m.try_match("tonight's dinner is tacos", _ctx())
    assert r is not None
    assert r.intent == "dinner_set"
    assert r.fields == {"date": "2026-06-05", "meal": "tacos"}
    assert r.confidence == 0.95


def test_first_matching_pattern_wins():
    """Registration order is precedence — rigid patterns register before permissive ones."""
    m = Matcher()
    m.register(_always("dinner_set", {"meal": "first"}))
    m.register(_always("dinner_set", {"meal": "second"}))
    r = m.try_match("anything", _ctx())
    assert r is not None
    assert r.fields["meal"] == "first"


def test_extractor_returning_none_falls_through_to_next_pattern():
    """An extractor that signals 'matched but couldn't extract' must not stop
    the loop — the next pattern gets a chance."""
    m = Matcher()
    skipped = IntentPattern(
        intent="dinner_set",
        regex=re.compile(r".+"),
        extractor=lambda mtch, text, ctx: None,
        name="skip",
    )
    m.register(skipped)
    m.register(_always("query_dinner", {"date": "2026-06-05"}))
    r = m.try_match("tonight's dinner is tacos", _ctx())
    assert r is not None
    assert r.intent == "query_dinner"


def test_regex_that_doesnt_match_is_skipped():
    m = Matcher()
    never = IntentPattern(
        intent="never",
        regex=re.compile(r"this_will_never_appear"),
        extractor=lambda mtch, text, ctx: IntentResult("never", {}, 1.0, text),
        name="never",
    )
    m.register(never)
    m.register(_always("query_dinner", {"date": "2026-06-05"}))
    r = m.try_match("hello there", _ctx())
    assert r is not None
    assert r.intent == "query_dinner"


def test_no_pattern_matches_returns_none():
    m = Matcher()
    only = IntentPattern(
        intent="never",
        regex=re.compile(r"xyzzy"),
        extractor=lambda mtch, text, ctx: IntentResult("never", {}, 1.0, text),
        name="only",
    )
    m.register(only)
    assert m.try_match("hello there", _ctx()) is None


def test_transcript_is_lowered_and_stripped_for_matching():
    """Patterns are authored in lowercase; the matcher normalises the
    transcript before regex search."""
    m = Matcher()
    captured: list[str] = []

    def extract(mtch, text, ctx):
        captured.append(text)
        return IntentResult("dinner_set", {}, 1.0, text)

    m.register(IntentPattern(
        intent="dinner_set",
        regex=re.compile(r"tacos"),
        extractor=extract,
        name="tacos",
    ))
    r = m.try_match("  TONIGHT'S DINNER IS TACOS  ", _ctx())
    assert r is not None
    # The extractor sees the normalised text — confirms whitespace + case handled.
    assert captured == ["tonight's dinner is tacos"]


def test_extractor_receives_context():
    """Date/person/chore extractors all need today + family + chores —
    confirm the context object passes through unchanged."""
    m = Matcher()
    seen: list[MatchContext] = []

    def extract(mtch, text, ctx):
        seen.append(ctx)
        return IntentResult("query_dinner", {"date": ctx.today}, 1.0, text)

    m.register(IntentPattern(
        intent="query_dinner",
        regex=re.compile(r"dinner"),
        extractor=extract,
        name="dinner",
    ))
    ctx = MatchContext(
        today="2026-06-05",
        family=[{"id": "fm1", "name": "Mia"}],
        chores=[{"id": "ch1", "title": "Bathroom", "assignedTo": "fm1"}],
    )
    r = m.try_match("what's for dinner", ctx)
    assert r is not None
    assert seen == [ctx]
    assert r.fields == {"date": "2026-06-05"}


def test_patterns_snapshot_is_independent_of_internal_list():
    """patterns() returns a copy so callers can't mutate the registry."""
    m = Matcher()
    m.register(_always("dinner_set"))
    snap = m.patterns()
    snap.clear()
    assert len(m.patterns()) == 1


def test_default_matcher_is_module_singleton():
    """Production code imports `default_matcher` and registers against it
    at module load. Confirm the singleton exists and is a Matcher."""
    from homecal_voice import matcher
    assert isinstance(matcher.default_matcher, Matcher)
