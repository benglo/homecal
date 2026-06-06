"""Defence-in-depth regex tripwire on Haiku's answer.

This is a sanity net, not a content filter. The system prompt is the primary
defence; this catches Haiku's worst lapses. Every term must be word-boundary-
safe (no benign substring overlap) — see safety_test.py for the canonical
counterexamples ("grape" not matching "rape", "scraped" not matching, etc).
"""
import re

from homecal_voice import catalog

REDIRECT_LINE = "I don't talk about that — let's ask about something fun instead!"


def _build_pattern() -> re.Pattern[str]:
    terms = catalog.load_safety_terms()
    if not terms:
        # Match nothing — the empty alternation `\b(?:)\b` matches every position,
        # which is the opposite of what we want.
        return re.compile(r"(?!x)x")
    alt = "|".join(re.escape(t) for t in terms)
    return re.compile(rf"\b(?:{alt})\b", re.IGNORECASE)


_PATTERN = _build_pattern()


def check_answer(answer: str) -> str:
    """Return the original answer, or REDIRECT_LINE if a banned term hit.

    Word-boundary-anchored so common false positives never trigger:
    "grape" doesn't match "rape", "I scraped my knee" doesn't match.
    Case-insensitive — Haiku occasionally uses caps for emphasis.
    """
    if _PATTERN.search(answer):
        return REDIRECT_LINE
    return answer
