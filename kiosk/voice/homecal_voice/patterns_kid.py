"""Kid-intent matcher patterns: noise_play, joke_tell.

ask_question has no matcher entry — Haiku handles all classification for
question-shaped utterances. Spec §3.5, §4.1.

Patterns register via `register_kid(matcher)` from main.py's startup wiring,
mirroring patterns_v1/patterns_timer convention.
"""
import random
import re

from homecal_voice import catalog
from homecal_voice.intent import IntentResult
from homecal_voice.matcher import IntentPattern, Matcher


# 1–3 word "noise name" captured between the verb and the optional
# "noise"/"sound" suffix. Greedy enough to catch "evil laugh", restrictive
# enough that "chicken" alone (without a verb) doesn't accidentally match.
NOISE_RE = re.compile(
    r"\b(?:make|do|play)\s+(?:a|an|the)\s+(?P<name>[a-z]+(?:\s+[a-z]+){0,2}?)(?:\s+(?:noise|sound))?\b",
    re.IGNORECASE,
)

# "tell me a joke" / "tell a joke" / "tell me a riddle" — me is optional.
JOKE_RE = re.compile(r"\btell\s+(?:me\s+)?(?:a|an|the)\s+(?:joke|riddle)\b", re.IGNORECASE)


def _normalise(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip().lower())


def _extract_noise(m, text, ctx):
    """Resolve the captured noise name against the catalog.

    Tries the captured form, then synonym lookup, then progressively shorter
    sub-phrases ("big chicken" → "chicken"). On miss, returns None so the
    main loop falls through to Haiku (catalog-miss path in spec §4.2).
    """
    noises = catalog.load_noises()
    name = _normalise(m.group("name"))
    # Build candidate list: exact, then trailing sub-phrases, then leading
    # sub-phrases. Most specific first.
    candidates = [name]
    parts = name.split()
    if len(parts) > 1:
        candidates.extend([" ".join(parts[i:]) for i in range(1, len(parts))])
        candidates.extend([" ".join(parts[:i]) for i in range(len(parts) - 1, 0, -1)])
    for c in candidates:
        resolved = noises.synonyms.get(c, c)
        if resolved in noises.entries:
            return IntentResult("noise_play", {"catalog_key": resolved}, 1.0, text)
    return None  # catalog miss → fall through to Haiku


def _extract_joke(m, text, ctx):
    """Pick a random catalog joke. catalog.check_integrity() at startup
    ensures the catalog is non-empty, so this can't return None in practice;
    the guard exists as a defensive fallback only."""
    jokes = catalog.load_jokes()
    if not jokes:
        return None
    j = random.choice(jokes)
    return IntentResult(
        "joke_tell",
        {"joke_id": j.id, "setup": j.setup, "punchline": j.punchline},
        1.0,
        text,
    )


def register_kid(matcher: Matcher) -> None:
    matcher.register(IntentPattern("noise_play", NOISE_RE, _extract_noise, "noise:any"))
    matcher.register(IntentPattern("joke_tell", JOKE_RE, _extract_joke, "joke:any"))
