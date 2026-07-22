"""Apply master speaker volume + mute on the Pi's PipeWire sink via `wpctl`.

The speakers are on the Pi (not in the server container), so the homecal-voice
process is where output volume actually gets set. Two footguns handled here:

- The system service has no ``XDG_RUNTIME_DIR``; without it ``wpctl`` can't find
  the running PipeWire and silently no-ops. We inject the user runtime dir.
- Cheap USB speakers clip above unity, so volume is capped at 1.0 (100%).

Kept dependency-free (argv building is pure) so the command construction is
unit-testable without a live PipeWire — inject a fake ``run`` callable.
"""
from __future__ import annotations

import logging
import os
import subprocess
from typing import Callable, List

log = logging.getLogger("homecal_voice.audio")

WPCTL_TIMEOUT_SEC = 5
# The user session that owns PipeWire. hbadmin = uid 1000 on the wall Pi;
# overridable if the service ever runs under a different uid.
_RUNTIME_DIR = os.environ.get("XDG_RUNTIME_DIR") or "/run/user/1000"


def _wpctl_env() -> dict:
    return {**os.environ, "XDG_RUNTIME_DIR": _RUNTIME_DIR}


def volume_argv(sink: str, level: int) -> List[str]:
    """wpctl set-volume argv. ``level`` is 0..100; wpctl takes a 0.0..1.0
    fraction. Clamped to [0, 1.0] — never boost past unity on cheap speakers."""
    frac = max(0, min(100, int(level))) / 100
    return ["wpctl", "set-volume", sink, f"{frac:.2f}"]


def mute_argv(sink: str, muted: bool) -> List[str]:
    return ["wpctl", "set-mute", sink, "1" if muted else "0"]


def apply_audio(
    volume: int,
    muted: bool,
    sink: str,
    run: Callable[..., object] = subprocess.run,
) -> bool:
    """Apply volume + mute to ``sink``. Returns True on success.

    Never raises: a missing ``wpctl`` (WirePlumber not installed) or an absent
    sink logs a warning and no-ops, because the rest of the voice service must
    keep running regardless of the speaker state.
    """
    try:
        run(volume_argv(sink, volume), env=_wpctl_env(), check=True,
            capture_output=True, timeout=WPCTL_TIMEOUT_SEC)
        run(mute_argv(sink, muted), env=_wpctl_env(), check=True,
            capture_output=True, timeout=WPCTL_TIMEOUT_SEC)
        return True
    except FileNotFoundError:
        log.warning("wpctl not found; cannot set volume (install wireplumber)")
    except Exception as e:  # noqa: BLE001 — deliberately swallow; audio is non-critical
        log.warning("wpctl failed to apply volume/mute on sink %s: %s", sink, e)
    return False
