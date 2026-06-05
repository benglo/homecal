"""Regex-first intent matcher.

Short-circuits the Haiku LLM call for the ~90% of utterances that fit a known
shape ("tonight's dinner is X", "what's for dinner", "Mia did the bathroom").
On a hit, returns the same IntentResult the LLM path produces, so main.py
treats the two sources identically downstream.

Patterns are registered against a Matcher instance. Production code uses the
module-level `default_matcher` singleton; tests instantiate their own to
stay isolated.

Order of registration is precedence — rigid patterns (full sentence with all
slots) register first; permissive ones (lone keyword + trailing string) last.
"""

from dataclasses import dataclass, field, replace
from typing import Callable, Pattern

from homecal_voice.intent import IntentResult


@dataclass(frozen=True)
class MatchContext:
    """Live context the extractors need to resolve dates and validate
    person/chore references."""
    today: str
    family: list[dict] = field(default_factory=list)
    chores: list[dict] = field(default_factory=list)


# Signature: (re.Match, normalised_text, ctx) -> IntentResult | None.
# Returning None means "the regex matched but the extractor couldn't build a
# valid intent" — the matcher then tries the next registered pattern.
Extractor = Callable[..., "IntentResult | None"]


@dataclass(frozen=True)
class IntentPattern:
    intent: str
    regex: Pattern[str]
    extractor: Extractor
    name: str = ""


class Matcher:
    def __init__(self) -> None:
        self._patterns: list[IntentPattern] = []

    def register(self, pattern: IntentPattern) -> None:
        self._patterns.append(pattern)

    def patterns(self) -> list[IntentPattern]:
        return list(self._patterns)

    def try_match(self, transcript: str, ctx: MatchContext) -> "IntentResult | None":
        if not transcript:
            return None
        text = transcript.strip().lower()
        if not text:
            return None
        for p in self._patterns:
            m = p.regex.search(text)
            if not m:
                continue
            result = p.extractor(m, text, ctx)
            if result is not None:
                # Stamp source centrally so extractors don't have to remember.
                return replace(result, source="matcher")
        return None


# Module-level singleton for production wiring. Pattern modules call
# `default_matcher.register(...)` at import time; main.py imports this
# singleton and uses it on the hot path.
default_matcher = Matcher()
