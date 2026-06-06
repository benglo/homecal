"""Brisbane-local date phrase parser for the regex matcher.

Resolves bare phrases like "tonight", "tomorrow", "friday", "next Monday"
to ISO YYYY-MM-DD against a supplied `today` anchor. Returns None for
anything it doesn't recognise — the caller falls through to the LLM.

Brisbane is fixed UTC+10 with no DST (spec §0), so a single `today` string
is enough; no zoneinfo dance.
"""

from datetime import date as Date, timedelta

# weekday() encoding: Mon=0..Sun=6.
_DAY_NAMES: dict[str, int] = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}

_RELATIVE: dict[str, int] = {
    "today": 0,
    "tonight": 0,
    "tomorrow": 1,
    "yesterday": -1,
}


def _strip_possessive(text: str) -> str:
    # STT and curly-quote keyboards both appear in the audit log.
    for suffix in ("'s", "’s"):
        if text.endswith(suffix):
            return text[: -len(suffix)]
    return text


def parse_date_phrase(phrase, today):
    """Resolve a date phrase to ISO YYYY-MM-DD or return None."""
    if not phrase or not today:
        return None
    p = _strip_possessive(phrase.strip().lower())
    p = " ".join(p.split())  # collapse internal whitespace
    if not p:
        return None
    try:
        today_d = Date.fromisoformat(today)
    except (ValueError, TypeError):
        return None

    if p in _RELATIVE:
        return (today_d + timedelta(days=_RELATIVE[p])).isoformat()

    if p.startswith("next "):
        target = _DAY_NAMES.get(p[5:].strip())
        if target is None:
            return None
        days = (target - today_d.weekday()) % 7
        if days == 0:
            # "next Friday" said on a Friday means a week from today, never today.
            days = 7
        return (today_d + timedelta(days=days)).isoformat()

    if p.startswith("this "):
        target = _DAY_NAMES.get(p[5:].strip())
        if target is None:
            return None
        return (today_d + timedelta(days=(target - today_d.weekday()) % 7)).isoformat()

    target = _DAY_NAMES.get(p)
    if target is not None:
        return (today_d + timedelta(days=(target - today_d.weekday()) % 7)).isoformat()

    return None
