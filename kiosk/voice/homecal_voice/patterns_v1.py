"""Regex patterns for the v1 voice intents: dinner_set, query_dinner,
query_agenda, chore_complete.

Patterns are registered against a Matcher via register_v1(matcher). The
production singleton (`default_matcher`) is wired in main.py at startup so
tests can use their own isolated Matcher.

Registration order matters — rigid templates (dinner_set with a captured
meal) register before permissive queries that could otherwise eat them.
"""

import re

from homecal_voice.aliases import match_chore, match_person
from homecal_voice.date_phrase import parse_date_phrase
from homecal_voice.intent import IntentResult
from homecal_voice.matcher import IntentPattern, Matcher


# All date phrases parse_date_phrase recognises. Multi-word ones (next/this
# Monday) come first in each alternation so the regex prefers the longer match.
_DATE_WORDS = (
    r"next\s+monday|next\s+tuesday|next\s+wednesday|next\s+thursday|"
    r"next\s+friday|next\s+saturday|next\s+sunday|"
    r"this\s+monday|this\s+tuesday|this\s+wednesday|this\s+thursday|"
    r"this\s+friday|this\s+saturday|this\s+sunday|"
    r"today|tonight|tomorrow|yesterday|"
    r"monday|tuesday|wednesday|thursday|friday|saturday|sunday"
)

# Trailing characters STT and casual speakers append. Stripped from meal/
# chore/title captures so "curry." and "curry" produce the same audit row.
_TRAILING_PUNCT = ".!?,;:"


# --- dinner_set ---------------------------------------------------------

_DINNER_SET_IS_RE = re.compile(
    rf"\b(?P<date>{_DATE_WORDS})(?:['’]s)?\s+dinner\s+(?:is|will\s+be)\s+(?P<meal>.+?)\s*$",
    re.IGNORECASE,
)
_DINNER_SET_HAVING_RE = re.compile(
    rf"\b(?P<date>{_DATE_WORDS})\s+we['’]?re\s+having\s+(?P<meal>.+?)\s*$",
    re.IGNORECASE,
)
_DINNER_SET_VERB_RE = re.compile(
    rf"\bset\s+(?P<date>{_DATE_WORDS})(?:['’]s)?\s+dinner\s+(?:to|as)\s+(?P<meal>.+?)\s*$",
    re.IGNORECASE,
)


def _extract_dinner_set(m, text, ctx):
    iso = parse_date_phrase(m.group("date"), ctx.today)
    if not iso:
        return None
    meal = m.group("meal").strip().rstrip(_TRAILING_PUNCT).strip()
    if not meal:
        return None
    return IntentResult("dinner_set", {"date": iso, "meal": meal}, 1.0, text)


# --- query_dinner -------------------------------------------------------

_QUERY_DINNER_WHATS_RE = re.compile(
    rf"\bwhat['’]?s\s+for\s+dinner(?:\s+(?:on\s+)?(?P<date>{_DATE_WORDS}))?\b",
    re.IGNORECASE,
)
_QUERY_DINNER_HAVING_RE = re.compile(
    rf"\bwhat\s+are\s+we\s+having\s+for\s+dinner(?:\s+(?:on\s+)?(?P<date>{_DATE_WORDS}))?\b",
    re.IGNORECASE,
)


def _extract_query_dinner(m, text, ctx):
    iso = parse_date_phrase(m.groupdict().get("date") or "today", ctx.today)
    if not iso:
        return None
    return IntentResult("query_dinner", {"date": iso}, 1.0, text)


# --- query_agenda ------------------------------------------------------

# Trailing anchor required: without it, "whats on netflix" / "anything on the
# menu" all match and falsely trigger an agenda lookup defaulted to today.
# Allowed tail: optional date phrase, optional sentence punctuation, EOL.
_QUERY_AGENDA_ON_RE = re.compile(
    rf"\b(?:what['’]?s|whats|anything)\s+(?:on|happening|scheduled)"
    rf"(?:\s+(?:on\s+)?(?P<date>{_DATE_WORDS}))?\s*[?.!]?\s*$",
    re.IGNORECASE,
)
_QUERY_AGENDA_DAY_RE = re.compile(
    r"\bwhat\s+(?:does|is)\s+(?:my|the)\s+day\s+look\s+like\b",
    re.IGNORECASE,
)


def _extract_query_agenda(m, text, ctx):
    iso = parse_date_phrase(m.groupdict().get("date") or "today", ctx.today)
    if not iso:
        return None
    return IntentResult("query_agenda", {"date": iso}, 1.0, text)


# --- chore_complete ----------------------------------------------------

# Deliberately permissive: any past-tense completion verb fires this
# pattern. The extractor relies entirely on match_person + match_chore
# returning None to reject false positives like "I finished work" or
# "we did the shopping". Tightening the regex (e.g. requiring a known
# name before the verb) loses real utterances like "Mia's bathroom is
# done" — let the aliases do the work.
_CHORE_COMPLETE_RE = re.compile(
    r"\b(?:did|done|finished|completed|complete)\b",
    re.IGNORECASE,
)


def _extract_chore_complete(m, text, ctx):
    person = match_person(text, ctx.family)
    if not person:
        return None
    chore = match_chore(text, person, ctx.chores)
    if not chore:
        return None
    # 0.8 (below main.py's AUTO_APPLY_DEFAULT=0.85) because the verb
    # regex is permissive: "did Mia do the bathroom?" (a question) matches
    # the same shape as "Mia did the bathroom". Sub-threshold routes through
    # the confirm card so questions don't silently award a star.
    return IntentResult(
        "chore_complete",
        {"person": person["name"], "chore": chore["title"]},
        0.8,
        text,
    )


def register_v1(matcher: Matcher) -> None:
    """Attach all v1 patterns in priority order."""
    matcher.register(IntentPattern("dinner_set", _DINNER_SET_VERB_RE, _extract_dinner_set, "dinner_set:verb"))
    matcher.register(IntentPattern("dinner_set", _DINNER_SET_IS_RE, _extract_dinner_set, "dinner_set:is"))
    matcher.register(IntentPattern("dinner_set", _DINNER_SET_HAVING_RE, _extract_dinner_set, "dinner_set:having"))
    matcher.register(IntentPattern("query_dinner", _QUERY_DINNER_WHATS_RE, _extract_query_dinner, "query_dinner:whats"))
    matcher.register(IntentPattern("query_dinner", _QUERY_DINNER_HAVING_RE, _extract_query_dinner, "query_dinner:having"))
    matcher.register(IntentPattern("query_agenda", _QUERY_AGENDA_ON_RE, _extract_query_agenda, "query_agenda:on"))
    matcher.register(IntentPattern("query_agenda", _QUERY_AGENDA_DAY_RE, _extract_query_agenda, "query_agenda:day"))
    matcher.register(IntentPattern("chore_complete", _CHORE_COMPLETE_RE, _extract_chore_complete, "chore_complete:verb"))
