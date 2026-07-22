from homecal_voice.audio import apply_audio, mute_argv, volume_argv


def test_volume_argv_converts_percent_to_fraction():
    assert volume_argv("@DEFAULT_AUDIO_SINK@", 65) == [
        "wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", "0.65",
    ]
    assert volume_argv("alsa_output.usb", 0)[-1] == "0.00"
    assert volume_argv("alsa_output.usb", 100)[-1] == "1.00"


def test_volume_argv_clamps_above_unity():
    # Never boost cheap speakers past 1.0 even if a bad value slips through.
    assert volume_argv("s", 150)[-1] == "1.00"
    assert volume_argv("s", -10)[-1] == "0.00"


def test_mute_argv():
    assert mute_argv("s", True) == ["wpctl", "set-mute", "s", "1"]
    assert mute_argv("s", False) == ["wpctl", "set-mute", "s", "0"]


def test_apply_audio_runs_volume_then_mute():
    calls = []

    def fake_run(argv, **kwargs):
        calls.append(argv)

    ok = apply_audio(40, True, "@DEFAULT_AUDIO_SINK@", run=fake_run)
    assert ok is True
    assert calls == [
        ["wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", "0.40"],
        ["wpctl", "set-mute", "@DEFAULT_AUDIO_SINK@", "1"],
    ]


def test_apply_audio_swallows_missing_wpctl():
    def fake_run(argv, **kwargs):
        raise FileNotFoundError("wpctl")

    # No raise; returns False so callers can log/skip.
    assert apply_audio(50, False, "s", run=fake_run) is False


def test_apply_audio_swallows_wpctl_failure():
    def fake_run(argv, **kwargs):
        raise RuntimeError("no such sink")

    assert apply_audio(50, False, "s", run=fake_run) is False
