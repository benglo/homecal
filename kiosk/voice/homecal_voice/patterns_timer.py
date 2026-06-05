"""Timer intent patterns (recognise-but-don't-execute).

The matcher recognises timer utterances and emits timer_set / timer_query /
timer_cancel / timer_extend so the audit log can quantify missed timer
requests before the feature ships. The executor (executor.py) routes all
four to a 'not built yet' handler.

One permissive pattern (`\\btimer\\b`) drives a single extractor that branches
on the verb shape. Keeps the regex registry tiny and the routing logic in
one readable place.
"""

import re

from homecal_voice.duration import extract_timer_label, parse_duration
from homecal_voice.intent import IntentResult
from homecal_voice.matcher import IntentPattern, Matcher


TIMER_INTENTS = frozenset({"timer_set", "timer_query", "timer_cancel", "timer_extend"})

_TIMER_RE = re.compile(r"\btimer\b", re.IGNORECASE)

_CANCEL_VERB_RE = re.compile(r"\b(?:cancel|stop|kill|delete|remove|end)\b", re.IGNORECASE)
_QUERY_PHRASE_RE = re.compile(
    r"\b(?:how\s+long|how\s+much\s+time|time\s+left|left\s+on|long\s+on)\b",
    re.IGNORECASE,
)
_EXTEND_VERB_RE = re.compile(r"\b(?:add|extend|give)\b", re.IGNORECASE)


def _extract_timer(m, text, ctx):
    """Branch on verb shape; build the matching timer_* intent."""
    label = extract_timer_label(text)
    duration = parse_duration(text)

    if _CANCEL_VERB_RE.search(text):
        return IntentResult("timer_cancel", {"label": label}, 1.0, text)

    if _QUERY_PHRASE_RE.search(text):
        return IntentResult("timer_query", {"label": label}, 1.0, text)

    if _EXTEND_VERB_RE.search(text) and duration is not None:
        return IntentResult(
            "timer_extend",
            {"duration_sec": duration, "label": label},
            1.0,
            text,
        )

    if duration is not None:
        return IntentResult(
            "timer_set",
            {"duration_sec": duration, "label": label},
            1.0,
            text,
        )

    # Bare "timer" with no verb + no duration — too thin to attribute an
    # intent. Fall through to the LLM in case it can disambiguate.
    return None


def register_timer(matcher: Matcher) -> None:
    matcher.register(IntentPattern("timer", _TIMER_RE, _extract_timer, "timer:any"))
