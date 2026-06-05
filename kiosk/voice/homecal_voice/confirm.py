"""Tiny grammar classifier for yes/no/edit responses after a confirm card.

The classifier runs on the whisper transcript of a short post-card listen.
Token-based matching (`words[0] in YES_TOKENS`) was chosen so e.g.
"yesterday" doesn't classify as "yes" (the previous `startswith` check
fired on the prefix).
"""

import re
from dataclasses import dataclass
from typing import Literal

ConfirmKind = Literal["yes", "no", "edit", "ambiguous"]


@dataclass(frozen=True)
class ConfirmResult:
    kind: ConfirmKind
    hint: str = ""  # for `edit`: the residual phrase fed back into intent extraction


YES_TOKENS = {"yes", "yeah", "yep", "yup", "correct", "confirm", "right", "ok", "okay", "sure"}
NO_TOKENS = {"no", "nope", "cancel", "stop", "abort", "nevermind"}

MULTI_WORD_YES = ("do it", "go ahead", "sounds good")
MULTI_WORD_NO = ("scratch that", "never mind", "no thanks")

# Substrings that signal an edit intent. Checked before short yes/no so
# "no, change time to six" classifies as edit, not no.
EDIT_HINTS = ("change ", "actually ", "edit ", "make it ", "no, change", "no change")


def classify_confirmation(text: str) -> ConfirmResult:
    t = text.strip().lower()
    if not t:
        return ConfirmResult("ambiguous")
    words = re.findall(r"[a-z]+", t)
    if not words:
        return ConfirmResult("ambiguous")

    # Edit hints win over short yes/no (e.g. "no, change ..." → edit, not no).
    if any(h in t for h in EDIT_HINTS):
        return ConfirmResult("edit", hint=t)

    # Multi-word exact phrases.
    if t in MULTI_WORD_YES:
        return ConfirmResult("yes")
    if t in MULTI_WORD_NO:
        return ConfirmResult("no")

    # Short utterances: first word decides. Prevents "yesterday" → yes,
    # "northern lights" → no, "stopwatch" → no, etc.
    if len(words) <= 3:
        first = words[0]
        if first in YES_TOKENS:
            return ConfirmResult("yes")
        if first in NO_TOKENS:
            return ConfirmResult("no")

    return ConfirmResult("ambiguous")
