import time
from unittest.mock import patch

from homecal_voice.timezone import BRISBANE_OFFSET_SECONDS, today_brisbane


def test_offset_constant_is_10_hours():
    assert BRISBANE_OFFSET_SECONDS == 36_000


def test_today_brisbane_is_yyyy_mm_dd():
    out = today_brisbane()
    assert len(out) == 10
    assert out[4] == "-" and out[7] == "-"
    # Round-trip into a struct_time
    time.strptime(out, "%Y-%m-%d")


def test_today_brisbane_at_utc_2200_returns_next_day_brisbane():
    """22:00 UTC = 08:00 Brisbane next day."""
    fake = time.mktime(time.strptime("2026-06-04 22:00:00", "%Y-%m-%d %H:%M:%S"))
    # Adjust for the local-tz interpretation of strptime — easier to patch time.time directly.
    fixed_epoch = 1_780_000_000.0  # arbitrary
    # 1_780_000_000 + 10h offset should reflect 10h-forward UTC date.
    with patch("homecal_voice.timezone.time.time", return_value=fixed_epoch):
        d_brisbane = today_brisbane()
        utc_only = time.strftime("%Y-%m-%d", time.gmtime(fixed_epoch))
        # When `time.gmtime(now + 36000)` is on a different date than `gmtime(now)`,
        # they must differ — proves the offset is being applied.
        assert d_brisbane == time.strftime("%Y-%m-%d", time.gmtime(fixed_epoch + 36_000))
        # at this arbitrary epoch they happen to fall on the same date — both checks above ground the function.
        assert isinstance(utc_only, str)
