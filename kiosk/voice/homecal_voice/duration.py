"""Duration parsing + timer-label extraction.

Both helpers feed the matcher's timer_* patterns. parse_duration must accept
the noisy shapes STT actually produces (word numbers, abbreviations, filler
words like 'more'/'another' between number and unit) — bare regex on
`\\d+\\s+minutes?` misses ~half of natural kitchen utterances.

extract_timer_label uses an exclude-word filter at leading/trailing positions
so query/cancel verbs ("how", "cancel", "what's") and prepositions don't leak
through as bogus labels when the helper is reused from those intents.
"""

import re

# Word-number → integer. Includes "a"/"an" → 1 for "a minute" / "an hour".
_NUM_WORDS: dict[str, int] = {
    "a": 1, "an": 1,
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "ninety": 90,
}

# Longest-first so the regex engine prefers e.g. "fifteen" over "five" when both
# could match at the same position (defensive — \b normally disambiguates).
_NUM_ALT = r"\d+|" + "|".join(sorted(_NUM_WORDS, key=len, reverse=True))
_UNIT_GROUP = r"(hours?|hrs?|minutes?|mins?|seconds?|secs?)"

# Optional filler word ("more"/"extra"/"another"/"additional") between number
# and unit so "add 2 more minutes" and "another 5 minutes" both parse.
_DUR_RE = re.compile(
    rf"\b({_NUM_ALT})\s+(?:more\s+|extra\s+|another\s+|additional\s+)?{_UNIT_GROUP}\b",
    re.IGNORECASE,
)


def _to_int(tok):
    if tok is None:
        return None
    t = tok.lower()
    if t.isdigit():
        return int(t)
    return _NUM_WORDS.get(t)


def _unit_seconds(unit: str) -> int:
    u = unit.lower()
    if u.startswith("h"):
        return 3600
    if u.startswith("m"):
        return 60
    return 1


def parse_duration(text):
    """Sum every (quantity, unit) pair found in `text` and return seconds.

    Returns None when no duration is present — a bare "set a timer for 10"
    with no unit is ambiguous and falls through to the LLM.
    """
    if not text:
        return None
    total = 0
    matched = False
    for m in _DUR_RE.finditer(text):
        n = _to_int(m.group(1))
        if n is None:
            continue
        total += n * _unit_seconds(m.group(2))
        matched = True
    return total if matched else None


# Words that are never the timer label — stripped from leading/trailing
# positions of any candidate. Internal "the"/"and" stay so multi-word phrases
# like "flip the steak" round-trip intact. Includes verbs that fire on
# query/cancel utterances ("cancel the timer", "how long left on the timer")
# so the same helper stays safe when reused from those intent extractors.
_EXCLUDE: set[str] = {
    "timer", "timers",
    "minute", "minutes", "min", "mins",
    "second", "seconds", "sec", "secs",
    "hour", "hours", "hr", "hrs",
    "a", "an", "the",
    "set", "start", "create", "make", "add", "new",
    "cancel", "stop", "pause", "resume", "extend", "delete", "remove", "kill",
    "how", "what", "whats", "long", "left", "much", "time",
    "for", "of", "on", "in", "at", "to", "from", "with", "about",
}

_LABEL_PATTERNS = [
    # "remind me [about|to] LABEL in <digit>..."
    re.compile(r"remind\s+me\s+(?:about\s+|to\s+)?([a-z][\w\s]*?)\s+in\s+\d", re.IGNORECASE),
    # "[set [a|the|new]] [N UNIT] LABEL timer ..." — 1-3 alpha words before "timer".
    re.compile(
        rf"\b(?:set\s+(?:a\s+|the\s+|new\s+)?)?"
        rf"(?:(?:{_NUM_ALT})\s+(?:hours?|hrs?|minutes?|mins?|seconds?|secs?)\s+)?"
        rf"([a-z]+(?:\s+[a-z]+){{0,2}})\s+timer\b",
        re.IGNORECASE,
    ),
    # "set [a|the] timer for LABEL" — trailing-label form (rejects digit start).
    re.compile(
        r"set\s+(?:a\s+|the\s+|new\s+)?timer\s+for\s+([a-z][a-z\s]*?)\s*$",
        re.IGNORECASE,
    ),
]


def _clean_label(raw: str):
    words = raw.lower().split()
    while words and (words[0] in _EXCLUDE or not words[0].isalpha()):
        words.pop(0)
    while words and (words[-1] in _EXCLUDE or not words[-1].isalpha()):
        words.pop()
    if not words or len(words) > 3:
        return None
    return " ".join(words)


def extract_timer_label(text):
    """Pull a label like 'pasta', 'boiled egg', or 'flip the steak' from a
    timer utterance. Returns None when no noun phrase is attached."""
    if not text:
        return None
    t = text.lower()
    for pat in _LABEL_PATTERNS:
        m = pat.search(t)
        if not m:
            continue
        cleaned = _clean_label(m.group(1))
        if cleaned:
            return cleaned
    return None
