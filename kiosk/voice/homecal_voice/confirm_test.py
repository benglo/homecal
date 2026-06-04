import pytest
from homecal_voice.confirm import classify_confirmation

YES = ["yes", "yeah", "yep", "correct", "confirm", "do it", "right", "ok", "okay", "sure"]
NO = ["no", "nope", "cancel", "stop", "scratch that", "never mind", "abort"]
EDIT = ["no, change time to six", "actually make it taco tuesday", "edit dinner to pasta"]

# Phrases that LOOK like yes/no but must NOT classify as such.
NEGATIVE_YES = [
    "yesterday I was busy",      # 'yes' prefix but not a confirmation
    "yesterday",
    "yes I think we should also order pizza maybe",  # too long, ambiguous
]
NEGATIVE_NO = [
    "northern lights",            # 'no' prefix but not a cancel
    "nothing planned tonight",
    "stopwatch broken",           # 'stop' prefix
]


@pytest.mark.parametrize("phrase", YES)
def test_yes(phrase):
    assert classify_confirmation(phrase).kind == "yes"


@pytest.mark.parametrize("phrase", NO)
def test_no(phrase):
    assert classify_confirmation(phrase).kind == "no"


@pytest.mark.parametrize("phrase", EDIT)
def test_edit(phrase):
    r = classify_confirmation(phrase)
    assert r.kind == "edit"
    assert r.hint


def test_ambiguous_or_long_falls_through():
    r = classify_confirmation("yes I think we should also order pizza maybe")
    assert r.kind == "ambiguous"


@pytest.mark.parametrize("phrase", NEGATIVE_YES)
def test_phrases_starting_with_yes_prefix_are_not_yes(phrase):
    assert classify_confirmation(phrase).kind != "yes"


@pytest.mark.parametrize("phrase", NEGATIVE_NO)
def test_phrases_starting_with_no_prefix_are_not_no(phrase):
    assert classify_confirmation(phrase).kind != "no"


def test_empty_string_is_ambiguous():
    assert classify_confirmation("").kind == "ambiguous"


def test_whitespace_only_is_ambiguous():
    assert classify_confirmation("   \n\t").kind == "ambiguous"


def test_punctuation_only_is_ambiguous():
    assert classify_confirmation("!@#$%").kind == "ambiguous"


def test_edit_hint_beats_short_no():
    """'no, change ...' starts with 'no' but is an edit; must not classify as no."""
    r = classify_confirmation("no, change time to six")
    assert r.kind == "edit"


def test_uppercase_normalised():
    assert classify_confirmation("YES").kind == "yes"
    assert classify_confirmation("Yes!").kind == "yes"
    assert classify_confirmation("NOPE").kind == "no"
