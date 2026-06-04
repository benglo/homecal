import re
from dataclasses import dataclass
from typing import Literal

ConfirmKind = Literal["yes", "no", "edit", "ambiguous"]

@dataclass(frozen=True)
class ConfirmResult:
    kind: ConfirmKind
    hint: str = ""

YES_TOKENS = {"yes", "yeah", "yep", "yup", "correct", "confirm", "right", "ok", "okay", "do it"}
NO_TOKENS  = {"no", "nope", "cancel", "stop", "scratch", "abort", "nevermind"}
EDIT_HINTS = ["change ", "actually ", "edit ", "make it ", "no, change", "no change"]

def classify_confirmation(text: str) -> ConfirmResult:
    t = text.strip().lower()
    if not t: return ConfirmResult("ambiguous")
    words = re.findall(r"[a-z]+", t)

    if len(words) <= 3:
        if any(t.startswith(y) for y in YES_TOKENS): return ConfirmResult("yes")
        if any(t.startswith(n) for n in NO_TOKENS):  return ConfirmResult("no")
        if t in ("scratch that", "never mind"): return ConfirmResult("no")

    if any(h in t for h in EDIT_HINTS):
        return ConfirmResult("edit", hint=t)

    return ConfirmResult("ambiguous")
