from unittest.mock import patch

from homecal_voice.tts import speak, synthesize, _detect_player


def test_synthesize_returns_audio_bytes(requests_mock):
    fake_mp3 = b"ID3\x03\x00\x00\x00fakebytes"
    requests_mock.post(
        "https://openrouter.ai/api/v1/audio/speech",
        content=fake_mp3,
        headers={"content-type": "audio/mpeg"},
    )
    out = synthesize("hello", model="google/gemini-3.1-flash-tts-preview", api_key="sk-or-xxx")
    assert out == fake_mp3


def test_speak_skips_when_muted():
    with patch("subprocess.run") as run, patch("homecal_voice.tts.synthesize") as synth:
        speak("hi", model="x", api_key="x", muted=True)
        run.assert_not_called()
        synth.assert_not_called()


def test_speak_swallows_synthesize_exception_and_does_not_play(requests_mock):
    requests_mock.post("https://openrouter.ai/api/v1/audio/speech", status_code=502)
    with patch("subprocess.run") as run:
        speak("hi", model="x", api_key="x", muted=False)
        run.assert_not_called()


def test_speak_uses_detected_player_not_aplay(requests_mock):
    """aplay can NOT play MP3. Verify we pick from mpg123/ffplay/pw-play/paplay."""
    requests_mock.post(
        "https://openrouter.ai/api/v1/audio/speech",
        content=b"ID3fake",
        headers={"content-type": "audio/mpeg"},
    )
    with patch("homecal_voice.tts.shutil.which") as which, patch("subprocess.run") as run:
        which.side_effect = lambda binary: "/usr/bin/mpg123" if binary == "mpg123" else None
        speak("hi", model="x", api_key="sk-or-xxx", muted=False)
        assert run.called
        cmd = run.call_args[0][0]
        assert cmd[0] == "mpg123"
        assert "aplay" not in cmd


def test_speak_no_player_available_logs_and_skips(requests_mock, caplog):
    requests_mock.post(
        "https://openrouter.ai/api/v1/audio/speech",
        content=b"ID3fake",
        headers={"content-type": "audio/mpeg"},
    )
    with patch("homecal_voice.tts.shutil.which", return_value=None), patch("subprocess.run") as run:
        speak("hi", model="x", api_key="sk-or-xxx", muted=False)
        run.assert_not_called()


def test_detect_player_returns_none_when_nothing_installed():
    with patch("homecal_voice.tts.shutil.which", return_value=None):
        assert _detect_player() is None


def test_detect_player_picks_mpg123_when_present():
    with patch("homecal_voice.tts.shutil.which") as which:
        which.side_effect = lambda b: f"/usr/bin/{b}" if b == "mpg123" else None
        assert _detect_player() == ["mpg123", "-q"]


def test_detect_player_falls_back_to_ffplay():
    with patch("homecal_voice.tts.shutil.which") as which:
        which.side_effect = lambda b: f"/usr/bin/{b}" if b == "ffplay" else None
        cmd = _detect_player()
        assert cmd is not None and cmd[0] == "ffplay"
