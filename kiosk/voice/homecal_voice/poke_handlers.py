"""Pure classification of SSE pokes for the Pi voice service.

Kept side-effect-free so the SSE thread's reaction (set a trigger Event /
invalidate the mute cache) is trivially testable without a live stream.
"""
from typing import Literal, Optional

PokeAction = Literal["listen", "mute"]


def classify_poke(poke: object) -> Optional[PokeAction]:
    """Return what a received poke means to the Pi, or None to ignore it.

    - "listen": the wall tapped tap-to-talk -> start a listen cycle.
    - "mute":   any other voice poke -> re-check the mute cache (existing
                behaviour; mute_changed and state echoes both land here).
    """
    if not isinstance(poke, dict):
        return None
    if poke.get("kind") != "voice":
        return None
    payload = poke.get("payload")
    if isinstance(payload, dict) and payload.get("kind") == "listen_request":
        return "listen"
    return "mute"
