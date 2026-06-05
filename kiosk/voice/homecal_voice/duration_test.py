from homecal_voice.duration import extract_timer_label, parse_duration


# parse_duration


def test_digit_minutes():
    assert parse_duration("10 minutes") == 600
    assert parse_duration("1 minute") == 60
    assert parse_duration("90 minutes") == 5400


def test_digit_seconds():
    assert parse_duration("30 seconds") == 30
    assert parse_duration("1 second") == 1


def test_digit_hours():
    assert parse_duration("2 hours") == 7200
    assert parse_duration("1 hour") == 3600


def test_combined_hours_and_minutes():
    """The classic '2 hours and 30 minutes' shape — slow-cook timers."""
    assert parse_duration("2 hours and 30 minutes") == 9000
    assert parse_duration("1 hour 15 minutes") == 4500


def test_abbreviations():
    """STT lower-cases and sometimes drops the 's'. 'mins' and 'min' both appear."""
    assert parse_duration("10 min") == 600
    assert parse_duration("10 mins") == 600
    assert parse_duration("2 hrs") == 7200
    assert parse_duration("1 hr") == 3600
    assert parse_duration("30 secs") == 30
    assert parse_duration("30 sec") == 30


def test_word_numbers():
    """STT often emits 'ten minutes' for short utterances."""
    assert parse_duration("ten minutes") == 600
    assert parse_duration("five minutes") == 300
    assert parse_duration("two hours") == 7200
    assert parse_duration("twenty minutes") == 1200


def test_a_minute_an_hour():
    """'set a timer for an hour' / 'for a minute' — common phrasings."""
    assert parse_duration("a minute") == 60
    assert parse_duration("an hour") == 3600


def test_embedded_in_sentence():
    assert parse_duration("set a timer for 10 minutes") == 600
    assert parse_duration("give me 5 minutes") == 300
    assert parse_duration("remind me in 90 seconds") == 90


def test_filler_word_between_number_and_unit():
    """Timer extends commonly say 'add 2 more minutes' / 'another 5 minutes' —
    the filler word must not block parsing."""
    assert parse_duration("add 2 more minutes") == 120
    assert parse_duration("another 5 minutes") == 300
    assert parse_duration("3 additional hours") == 10800


def test_no_duration_returns_none():
    assert parse_duration("set a timer") is None
    assert parse_duration("how long left") is None
    assert parse_duration("") is None
    assert parse_duration(None) is None  # type: ignore[arg-type]


def test_unparseable_unit_returns_none():
    """We don't guess units — 'set a timer for 10' is ambiguous; pass to LLM."""
    assert parse_duration("set a timer for 10") is None


def test_case_insensitive():
    assert parse_duration("10 MINUTES") == 600
    assert parse_duration("Ten Minutes") == 600


# extract_timer_label


def test_label_with_set_a_X_timer_for():
    assert extract_timer_label("set a pasta timer for 10 minutes") == "pasta"
    assert extract_timer_label("set the rice timer for 15 minutes") == "rice"


def test_label_with_X_timer_for():
    assert extract_timer_label("pasta timer for 10 minutes") == "pasta"


def test_label_with_timer_for_X():
    """When the duration is implicit ('timer for pasta'), the label trails."""
    assert extract_timer_label("set a timer for pasta") == "pasta"


def test_label_with_remind_me_about_X_in_N():
    assert extract_timer_label("remind me about pasta in 10 minutes") == "pasta"
    assert extract_timer_label("remind me to flip the steak in 5 minutes") == "flip the steak"


def test_label_with_duration_before_label():
    """'set a 10 minute pasta timer' — duration leads, label trails before
    the word 'timer'."""
    assert extract_timer_label("set a 10 minute pasta timer") == "pasta"
    assert extract_timer_label("10 minute pasta timer") == "pasta"


def test_multi_word_label():
    """Two-word kitchen labels are common ('boiled egg', 'roast chicken')."""
    assert extract_timer_label("set a boiled egg timer for 4 minutes") == "boiled egg"


def test_no_label_when_only_duration():
    """'set a 10 minute timer' has no label noun — return None."""
    assert extract_timer_label("set a 10 minute timer") is None
    assert extract_timer_label("set a timer for 10 minutes") is None
    assert extract_timer_label("10 minute timer") is None


def test_no_label_in_query_or_cancel():
    assert extract_timer_label("how long left") is None
    assert extract_timer_label("cancel the timer") is None


def test_excluded_words_not_returned_as_label():
    """The filter prevents 'a', 'the', 'set' etc. from leaking through as labels."""
    assert extract_timer_label("set the timer") is None
    assert extract_timer_label("set a timer") is None


def test_empty_and_none():
    assert extract_timer_label("") is None
    assert extract_timer_label(None) is None  # type: ignore[arg-type]


def test_case_insensitive_label():
    assert extract_timer_label("Set a PASTA timer for 10 Minutes") == "pasta"
