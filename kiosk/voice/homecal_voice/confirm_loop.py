"""Post-confirm-card listening loop.

Open a 5-second window of audio after the confirm card is shown on the
wall. If the user says yes/no/edit we route accordingly; if the window
ends with no speech detected, return `timeout` without paying for an STT
call on pure silence.
"""

import logging
import time
from dataclasses import dataclass
from typing import Callable, Literal

from homecal_voice.confirm import classify_confirmation

log = logging.getLogger("homecal_voice.confirm_loop")


@dataclass(frozen=True)
class ConfirmOutcome:
    kind: Literal["yes", "no", "edit", "ambiguous", "timeout"]
    hint: str = ""


def confirm_listen(
    *,
    next_frame: Callable,
    endpointer_factory: Callable,
    transcribe: Callable,
    timeout_s: float = 5.0,
) -> ConfirmOutcome:
    """Open a short listening window after a confirming card is shown.

    Endpointer terminates on silence after speech OR on the 8s hard cap.
    If the whole window elapses without the endpointer firing (typically
    user said nothing), or fires without any speech detected, we return
    `timeout` and skip the STT call.
    """
    ep = endpointer_factory()
    ended = False
    started = time.time()
    while time.time() - started < timeout_s:
        f = next_frame()
        if ep.feed(f):
            ended = True
            break

    had_speech = getattr(ep, "had_speech", True)  # tolerate old endpointer impls
    if not ended or not had_speech:
        log.info("confirm_listen: timeout (ended=%s, had_speech=%s)", ended, had_speech)
        return ConfirmOutcome("timeout")

    text = transcribe(ep.audio())
    log.info("confirm_listen: transcript=%r", text)
    r = classify_confirmation(text)
    return ConfirmOutcome(r.kind, r.hint)
