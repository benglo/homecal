from homecal_voice.patterns_kid import (
    _extract_noise, _extract_joke,
    NOISE_RE, JOKE_RE,
    register_kid,
)
from homecal_voice.matcher import Matcher, MatchContext


_CTX = MatchContext(today="2026-06-06")


def test_noise_catalog_hit():
    text = "make a chicken noise"
    m = NOISE_RE.search(text)
    assert m is not None
    result = _extract_noise(m, text, _CTX)
    assert result is not None
    assert result.intent == "noise_play"
    assert result.fields["catalog_key"] == "chicken"
    assert result.confidence == 1.0


def test_noise_catalog_synonym():
    text = "do a doggy noise"
    m = NOISE_RE.search(text)
    assert m is not None
    result = _extract_noise(m, text, _CTX)
    assert result is not None
    assert result.fields["catalog_key"] == "dog"


def test_noise_miss_returns_none():
    """Catalog miss — fall through to Haiku."""
    text = "make a dolphin noise"
    m = NOISE_RE.search(text)
    assert m is not None
    result = _extract_noise(m, text, _CTX)
    assert result is None


def test_noise_no_match_on_bare_word():
    """'chicken' alone shouldn't match — needs make/do/play verb."""
    text = "chicken"
    m = NOISE_RE.search(text)
    assert m is None


def test_noise_play_verb_works():
    text = "play a chicken noise"
    m = NOISE_RE.search(text)
    assert m is not None
    result = _extract_noise(m, text, _CTX)
    assert result is not None
    assert result.fields["catalog_key"] == "chicken"


def test_noise_optional_sound_word():
    """'make a chicken' without 'noise' should still hit."""
    text = "make a chicken"
    m = NOISE_RE.search(text)
    assert m is not None
    result = _extract_noise(m, text, _CTX)
    assert result is not None
    assert result.fields["catalog_key"] == "chicken"


def test_joke_pattern_emits_intent():
    text = "tell me a joke"
    m = JOKE_RE.search(text)
    assert m is not None
    result = _extract_joke(m, text, _CTX)
    assert result is not None
    assert result.intent == "joke_tell"
    assert result.confidence == 1.0
    assert "joke_id" in result.fields
    assert "setup" in result.fields
    assert "punchline" in result.fields


def test_joke_riddle_synonym():
    text = "tell me a riddle"
    m = JOKE_RE.search(text)
    assert m is not None
    result = _extract_joke(m, text, _CTX)
    assert result is not None
    assert result.intent == "joke_tell"


def test_joke_without_me():
    text = "tell a joke"
    m = JOKE_RE.search(text)
    assert m is not None


def test_register_kid_appends_two_patterns():
    matcher = Matcher()
    before = len(matcher.patterns())
    register_kid(matcher)
    after = len(matcher.patterns())
    assert after - before == 2
    # Names should be discoverable for log/dedup purposes.
    names = {p.name for p in matcher.patterns()}
    assert any(n.startswith("noise") for n in names)
    assert any(n.startswith("joke") for n in names)


def test_register_kid_integrates_with_try_match():
    matcher = Matcher()
    register_kid(matcher)
    result = matcher.try_match("make a chicken noise", _CTX)
    assert result is not None
    assert result.intent == "noise_play"
    assert result.source == "matcher"  # matcher stamps source centrally
