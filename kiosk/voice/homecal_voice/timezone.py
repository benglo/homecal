"""Brisbane timezone helpers.

Spec §0 locks Brisbane to a fixed UTC+10 offset (no DST). Centralising the
math here keeps every consumer (executor, main loop, daily-cap counter,
prompt-builder) honest. If Queensland ever adopts DST, this is the one
file to swap to a real tz library — the rest of the Pi service then picks
it up by recompile.
"""

import time

BRISBANE_OFFSET_SECONDS = 10 * 3600


def now_brisbane_epoch() -> float:
    """Wall-clock seconds since the epoch, shifted into Brisbane local time."""
    return time.time() + BRISBANE_OFFSET_SECONDS


def today_brisbane() -> str:
    """Today's date in Brisbane (UTC+10) as YYYY-MM-DD."""
    return time.strftime("%Y-%m-%d", time.gmtime(now_brisbane_epoch()))
