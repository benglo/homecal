import time, logging
from dataclasses import dataclass
from typing import Callable, Literal
from homecal_voice.confirm import classify_confirmation, ConfirmResult

log = logging.getLogger("homecal_voice.confirm_loop")

@dataclass(frozen=True)
class ConfirmOutcome:
    kind: Literal["yes", "no", "edit", "ambiguous", "timeout"]
    hint: str = ""

def confirm_listen(*, next_frame: Callable, endpointer_factory: Callable,
                   transcribe: Callable, timeout_s: float = 5.0) -> ConfirmOutcome:
    """Open a short listening window after a confirming card is shown."""
    ep = endpointer_factory()
    started = time.time()
    while time.time() - started < timeout_s:
        f = next_frame()
        if ep.feed(f):
            break
    if not ep.audio().size:
        return ConfirmOutcome("timeout")
    text = transcribe(ep.audio())
    r: ConfirmResult = classify_confirmation(text)
    return ConfirmOutcome(r.kind, r.hint)
