"""Brisbane timezone helpers.

Spec §0 locks Brisbane to a fixed UTC+10 offset (no DST). Centralising the
math here keeps every consumer (executor, main loop, daily-cap counter,
prompt-builder) honest. If Queensland ever adopts DST, this is the one
file to swap to a real tz library — the rest of the Pi service then picks
it up by recompile.
"""

import time
from datetime import datetime, timedelta, timezone as _stdlib_tz

BRISBANE_OFFSET_SECONDS = 10 * 3600


def now_brisbane_epoch() -> float:
    """Wall-clock seconds since the epoch, shifted into Brisbane local time."""
    return time.time() + BRISBANE_OFFSET_SECONDS


def today_brisbane() -> str:
    """Today's date in Brisbane (UTC+10) as YYYY-MM-DD."""
    return time.strftime("%Y-%m-%d", time.gmtime(now_brisbane_epoch()))


def is_quiet_hours(now: datetime | None = None) -> bool:
    """Brisbane 20:00 (inclusive) — 07:00 (exclusive) quiet window.

    Mirrors the chore-chime quiet window in the frontend. Used to gate
    noise_play clip playback so a fart noise at 11pm doesn't fire."""
    if now is None:
        now = datetime.now(_stdlib_tz.utc)
    brisbane = now + timedelta(seconds=BRISBANE_OFFSET_SECONDS)
    hour = brisbane.hour
    return hour >= 20 or hour < 7
