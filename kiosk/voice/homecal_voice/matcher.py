"""Regex-first intent matcher.

Short-circuits the Haiku LLM call for utterances that fit a known shape
("tonight's dinner is X", "what's for dinner", "Mia did the bathroom").
On a hit, returns the same IntentResult the LLM path produces, so main.py
treats the two sources identically downstream.

Patterns are registered against a Matcher instance. Production code uses the
module-level `default_matcher` singleton; tests instantiate their own to
stay isolated.

Order of registration is precedence — first match wins. A permissive
`\\btimer\\b` pattern registered before `dinner_set:is` would swallow
"tonight's dinner is timer cake" before the dinner_set extractor ever
sees it. Register the rigid templates first.
"""

import logging
import re
from dataclasses import dataclass, field, replace
from typing import Pattern, Protocol, TypedDict

from homecal_voice.intent import IntentResult

log = logging.getLogger("homecal_voice.matcher")


# Structural types — the family/chores endpoints return whatever shape
# `_list_bare` unwraps; TypedDict documents the keys the matcher actually
# reads without forcing copies or runtime validation.
class FamilyMember(TypedDict, total=False):
    id: str
    name: str


class Chore(TypedDict, total=False):
    id: str
    title: str
    assignedTo: str


@dataclass(frozen=True)
class MatchContext:
    today: str
    family: list[FamilyMember] = field(default_factory=list)
    chores: list[Chore] = field(default_factory=list)


class Extractor(Protocol):
    """Extractor protocol — explicit args catch arity drift at type-check
    time. Returning None means 'regex matched but slot-fill failed; try the
    next pattern' — the regex-miss case is handled separately."""
    def __call__(
        self, match: "re.Match[str]", text: str, ctx: MatchContext
    ) -> "IntentResult | None": ...


@dataclass(frozen=True)
class IntentPattern:
    intent: str
    regex: Pattern[str]
    extractor: Extractor
    # Required (no default) — every pattern is referenced by name in logs +
    # tests, and an unnamed registration would silently bypass debug aids
    # and break the dedup guard in main_test.py.
    name: str


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
            # Pattern fired but the extractor couldn't fill the slots. Log so
            # a misfiring regex (matches but never extracts) is debuggable
            # from the service log instead of presenting as "matcher hit
            # rate dropped to 0" with no root cause.
            log.debug("matcher: pattern %r matched but extractor returned None", p.name)
        return None


# Module-level singleton for production wiring. Pattern modules call
# `default_matcher.register(...)` at import time; main.py imports this
# singleton and uses it on the hot path.
default_matcher = Matcher()
