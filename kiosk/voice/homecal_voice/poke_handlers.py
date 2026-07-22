"""Pure classification of SSE pokes for the Pi voice service.

Kept side-effect-free so the SSE thread's reaction (set a trigger Event /
invalidate the mute cache) is trivially testable without a live stream.
"""
from typing import Literal, Optional

PokeAction = Literal["listen", "mute", "volume"]

# Speaker audio settings changed on the server -> re-fetch /status and re-apply
# the sink volume/mute. Both endpoints share one action (the applier writes both
# volume and mute every time), so a change to either reconciles the sink fully.
_AUDIO_KINDS = frozenset({"volume_changed", "audio_mute_changed"})


def classify_poke(poke: object) -> Optional[PokeAction]:
    """Return what a received poke means to the Pi, or None to ignore it.

    - "listen": the wall tapped tap-to-talk -> start a listen cycle.
    - "volume": speaker volume / audio-mute changed -> re-apply to the sink.
    - "mute":   any other voice poke -> re-check the mute cache (existing
                behaviour; mute_changed and state echoes both land here).
    """
    if not isinstance(poke, dict):
        return None
    if poke.get("kind") != "voice":
        return None
    payload = poke.get("payload")
    if isinstance(payload, dict):
        pk = payload.get("kind")
        if pk == "listen_request":
            return "listen"
        if pk in _AUDIO_KINDS:
            return "volume"
    return "mute"
