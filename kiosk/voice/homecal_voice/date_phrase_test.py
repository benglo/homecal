from homecal_voice.date_phrase import parse_date_phrase


# All tests anchor on 2026-06-05 (a Friday) — covers every weekday wrap case
# without depending on the system clock. weekday() Mon=0..Sun=6, so Fri=4.
TODAY = "2026-06-05"


def test_today():
    assert parse_date_phrase("today", TODAY) == "2026-06-05"


def test_tonight_resolves_to_today():
    assert parse_date_phrase("tonight", TODAY) == "2026-06-05"


def test_tomorrow():
    assert parse_date_phrase("tomorrow", TODAY) == "2026-06-06"


def test_yesterday():
    """chore_complete supports 'Mia did her bathroom yesterday' for late entry."""
    assert parse_date_phrase("yesterday", TODAY) == "2026-06-04"


def test_bare_day_name_today_is_that_day():
    """'Friday's dinner is X' on a Friday → today, not next week."""
    assert parse_date_phrase("friday", TODAY) == "2026-06-05"


def test_bare_day_name_next_in_week():
    assert parse_date_phrase("saturday", TODAY) == "2026-06-06"
    assert parse_date_phrase("sunday", TODAY) == "2026-06-07"
    assert parse_date_phrase("monday", TODAY) == "2026-06-08"


def test_bare_day_name_earlier_in_week_wraps():
    """Thursday from a Friday → next Thursday (6 days)."""
    assert parse_date_phrase("thursday", TODAY) == "2026-06-11"


def test_this_day_name_same_as_bare():
    assert parse_date_phrase("this monday", TODAY) == "2026-06-08"
    assert parse_date_phrase("this friday", TODAY) == "2026-06-05"


def test_next_day_name_strictly_future():
    """'next monday' from a Friday — colloquially means the upcoming Monday,
    not Monday of next week. Same resolution as bare 'monday' UNLESS today
    is already that day."""
    assert parse_date_phrase("next monday", TODAY) == "2026-06-08"
    assert parse_date_phrase("next saturday", TODAY) == "2026-06-06"


def test_next_day_name_skips_today_when_today_is_that_day():
    """'next Friday' on a Friday → 7 days ahead, never today."""
    assert parse_date_phrase("next friday", TODAY) == "2026-06-12"


def test_possessive_straight_apostrophe():
    assert parse_date_phrase("tonight's", TODAY) == "2026-06-05"
    assert parse_date_phrase("friday's", TODAY) == "2026-06-05"
    assert parse_date_phrase("tomorrow's", TODAY) == "2026-06-06"


def test_possessive_curly_apostrophe():
    """STT and some keyboards emit U+2019 (’) not U+0027 (')."""
    assert parse_date_phrase("tonight’s", TODAY) == "2026-06-05"
    assert parse_date_phrase("friday’s", TODAY) == "2026-06-05"


def test_case_and_whitespace_insensitive():
    assert parse_date_phrase("  TOMORROW  ", TODAY) == "2026-06-06"
    assert parse_date_phrase("Friday", TODAY) == "2026-06-05"
    assert parse_date_phrase("Next  Monday", TODAY) == "2026-06-08"


def test_unknown_phrase_returns_none():
    """Unknown phrases fall through to the LLM — don't guess."""
    assert parse_date_phrase("xyzzy", TODAY) is None
    assert parse_date_phrase("the day after tomorrow", TODAY) is None
    assert parse_date_phrase("next week", TODAY) is None
    assert parse_date_phrase("this weekend", TODAY) is None


def test_empty_returns_none():
    assert parse_date_phrase("", TODAY) is None
    assert parse_date_phrase("   ", TODAY) is None


def test_none_phrase_returns_none():
    assert parse_date_phrase(None, TODAY) is None  # type: ignore[arg-type]


def test_bad_today_returns_none():
    """Malformed today defends against a future change that breaks the
    contract — we'd rather return None than throw and crash main loop."""
    assert parse_date_phrase("tomorrow", "not-a-date") is None
    assert parse_date_phrase("tomorrow", "") is None
    assert parse_date_phrase("tomorrow", None) is None  # type: ignore[arg-type]


def test_resolves_across_month_boundary():
    """Date arithmetic must use real date math, not string slicing."""
    # 2026-06-30 is a Tuesday. Bare "wednesday" → 2026-07-01.
    assert parse_date_phrase("wednesday", "2026-06-30") == "2026-07-01"
    assert parse_date_phrase("tomorrow", "2026-06-30") == "2026-07-01"


def test_resolves_across_year_boundary():
    # 2026-12-31 is a Thursday. "tomorrow" → 2027-01-01.
    assert parse_date_phrase("tomorrow", "2026-12-31") == "2027-01-01"
    assert parse_date_phrase("friday", "2026-12-31") == "2027-01-01"
