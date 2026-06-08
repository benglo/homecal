from unittest.mock import patch

import pytest
import requests

from homecal_voice.tts import speak, synthesize, _detect_player, synthesize_lan, fetch_catalog


def test_synthesize_returns_audio_bytes(requests_mock):
    fake_mp3 = b"ID3\x03\x00\x00\x00fakebytes"
    requests_mock.post(
        "https://openrouter.ai/api/v1/audio/speech",
        content=fake_mp3,
        headers={"content-type": "audio/mpeg"},
    )
    out = synthesize("hello", model="hexgrad/kokoro-82m", voice="af_bella", api_key="sk-or-xxx")
    assert out == fake_mp3


def test_synthesize_sends_required_fields(requests_mock):
    """OpenRouter SpeechRequest schema requires input+model+voice; sending a
    bare {model,input,voice:'default'} returned an opaque 500 in production
    until we started sending a real voice + response_format."""
    requests_mock.post(
        "https://openrouter.ai/api/v1/audio/speech",
        content=b"audio",
        headers={"content-type": "audio/mpeg"},
    )
    synthesize("hello", model="hexgrad/kokoro-82m", voice="af_bella", api_key="sk-or-xxx")
    body = requests_mock.last_request.json()
    assert body["model"] == "hexgrad/kokoro-82m"
    assert body["input"] == "hello"
    assert body["voice"] == "af_bella"
    assert body["response_format"] == "mp3"


def test_speak_skips_when_muted():
    with patch("subprocess.run") as run, patch("homecal_voice.tts.synthesize") as synth:
        result = speak("hi", model="x", voice="v", api_key="x", muted=True)
        run.assert_not_called()
        synth.assert_not_called()
        assert result is False


def test_speak_swallows_synthesize_exception_and_does_not_play(requests_mock):
    requests_mock.post("https://openrouter.ai/api/v1/audio/speech", status_code=502)
    with patch("subprocess.run") as run:
        result = speak("hi", model="x", voice="v", api_key="x", muted=False)
        run.assert_not_called()
        # False return is the signal main._speak uses to log a WARNING; pin it
        # so a future refactor that suppresses the bool can't silently regress
        # the "user heard nothing" detection.
        assert result is False


def test_speak_uses_detected_player_not_aplay(requests_mock):
    """aplay can NOT play MP3. Verify we pick from mpg123/ffplay/pw-play/paplay."""
    requests_mock.post(
        "https://openrouter.ai/api/v1/audio/speech",
        content=b"ID3fake",
        headers={"content-type": "audio/mpeg"},
    )
    with patch("homecal_voice.tts.shutil.which") as which, patch("subprocess.run") as run:
        which.side_effect = lambda binary: "/usr/bin/mpg123" if binary == "mpg123" else None
        result = speak("hi", model="x", voice="v", api_key="sk-or-xxx", muted=False)
        assert run.called
        cmd = run.call_args[0][0]
        assert cmd[0] == "mpg123"
        assert "aplay" not in cmd
        assert result is True


def test_speak_no_player_available_logs_and_skips(requests_mock, caplog):
    requests_mock.post(
        "https://openrouter.ai/api/v1/audio/speech",
        content=b"ID3fake",
        headers={"content-type": "audio/mpeg"},
    )
    with patch("homecal_voice.tts.shutil.which", return_value=None), patch("subprocess.run") as run:
        result = speak("hi", model="x", voice="v", api_key="sk-or-xxx", muted=False)
        run.assert_not_called()
        assert result is False


def test_synthesize_retries_on_read_timeout_and_returns_audio_on_recovery(requests_mock):
    """Live journals show OpenRouter /audio/speech timing out mid-utterance;
    a single retry recovers most cases. Pin the contract so a refactor that
    drops the retry doesn't silently regress the 'wake stopped working'
    user-facing symptom we just fixed."""
    requests_mock.post(
        "https://openrouter.ai/api/v1/audio/speech",
        [
            {"exc": requests.exceptions.ReadTimeout("Read timed out.")},
            {"content": b"ID3recovered", "headers": {"content-type": "audio/mpeg"}},
        ],
    )
    out = synthesize("hi", model="x", voice="v", api_key="k", backoff_s=0)
    assert out == b"ID3recovered"
    assert requests_mock.call_count == 2


def test_synthesize_retries_on_5xx_and_returns_audio_on_recovery(requests_mock):
    """OpenRouter intermittently returns 502/503 under load. 5xx is transient
    by definition — retry. Distinguished from 4xx in the next test."""
    requests_mock.post(
        "https://openrouter.ai/api/v1/audio/speech",
        [
            {"status_code": 503},
            {"status_code": 200, "content": b"ID3recovered", "headers": {"content-type": "audio/mpeg"}},
        ],
    )
    out = synthesize("hi", model="x", voice="v", api_key="k", backoff_s=0)
    assert out == b"ID3recovered"
    assert requests_mock.call_count == 2


def test_synthesize_does_not_retry_on_4xx(requests_mock):
    """A 400 means we sent something the server can never accept (empty input,
    unknown voice). Retrying just wastes budget + clutters the journal. Bail
    on first response. Today the empty-text guard in main._speak should
    prevent this firing in practice — this is the belt to that suspenders."""
    requests_mock.post("https://openrouter.ai/api/v1/audio/speech", status_code=400)
    with pytest.raises(requests.exceptions.HTTPError):
        synthesize("hi", model="x", voice="v", api_key="k", backoff_s=0)
    assert requests_mock.call_count == 1


def test_synthesize_exhausts_attempts_on_persistent_timeout(requests_mock):
    """All attempts hit timeout → re-raise the last exception so speak() can
    log + return False. Pin max_attempts=2 (default) so a future bump to 3+
    is a deliberate decision, not a silent change in wall-clock budget."""
    requests_mock.post(
        "https://openrouter.ai/api/v1/audio/speech",
        exc=requests.exceptions.ReadTimeout("Read timed out."),
    )
    with pytest.raises(requests.exceptions.ReadTimeout):
        synthesize("hi", model="x", voice="v", api_key="k", backoff_s=0)
    assert requests_mock.call_count == 2


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


def test_detect_player_prefers_ffplay_over_mpg123_when_both_present():
    """WAV from the LAN sidecar plays natively in ffplay/paplay; mpg123 is
    MP3-only. With local TTS, prefer the WAV-capable players first."""
    with patch("homecal_voice.tts.shutil.which") as which:
        which.side_effect = lambda b: f"/usr/bin/{b}" if b in ("ffplay", "mpg123") else None
        cmd = _detect_player()
        assert cmd is not None and cmd[0] == "ffplay"


def test_detect_player_falls_back_to_mpg123_when_only_one_available():
    """If only mpg123 is installed, we still use it (cloud MP3 path)."""
    with patch("homecal_voice.tts.shutil.which") as which:
        which.side_effect = lambda b: "/usr/bin/mpg123" if b == "mpg123" else None
        cmd = _detect_player()
        assert cmd is not None and cmd[0] == "mpg123"


# ---------------------------------------------------------------------------
# synthesize_lan
# ---------------------------------------------------------------------------

def test_synthesize_lan_returns_wav_bytes_on_200(requests_mock):
    requests_mock.post(
        "http://test-server:8789/tts",
        content=b"RIFF\x00\x00\x00\x00WAVEdataXYZ",
        headers={"content-type": "audio/wav", "x-synth-ms": "234"},
    )
    audio, latency_ms = synthesize_lan(
        "hello", server_url="http://test-server:8789",
        token="t", voice="af_bella", timeout_s=3,
    )
    assert audio.startswith(b"RIFF")
    assert latency_ms == 234


def test_synthesize_lan_raises_on_5xx(requests_mock):
    requests_mock.post("http://test-server:8789/tts", status_code=503)
    with pytest.raises(requests.exceptions.HTTPError):
        synthesize_lan("hi", server_url="http://test-server:8789", token="t",
                       voice="af_bella", timeout_s=3)


def test_synthesize_lan_raises_on_timeout(requests_mock):
    requests_mock.post("http://test-server:8789/tts",
                       exc=requests.exceptions.ReadTimeout("nope"))
    with pytest.raises(requests.exceptions.ReadTimeout):
        synthesize_lan("hi", server_url="http://test-server:8789", token="t",
                       voice="af_bella", timeout_s=3)


def test_synthesize_lan_sends_token_in_header(requests_mock):
    requests_mock.post(
        "http://test-server:8789/tts",
        content=b"RIFF\x00\x00\x00\x00WAVEdata",
        headers={"x-synth-ms": "10"},
    )
    synthesize_lan("hi", server_url="http://test-server:8789", token="abc",
                   voice="af_bella", timeout_s=3)
    assert requests_mock.last_request.headers["X-Pi-Token"] == "abc"


# ---------------------------------------------------------------------------
# fetch_catalog
# ---------------------------------------------------------------------------

def test_fetch_catalog_returns_bytes_on_200(requests_mock):
    requests_mock.get(
        "http://test-server:8789/catalog/noise/fart",
        content=b"RIFF\x00\x00\x00\x00WAVEdata",
    )
    audio = fetch_catalog("noise", "fart",
                          server_url="http://test-server:8789",
                          token="t", timeout_s=3)
    assert audio.startswith(b"RIFF")


def test_fetch_catalog_returns_none_on_404(requests_mock):
    requests_mock.get("http://test-server:8789/catalog/noise/missing",
                      status_code=404)
    result = fetch_catalog("noise", "missing",
                           server_url="http://test-server:8789",
                           token="t", timeout_s=3)
    assert result is None


def test_fetch_catalog_raises_on_5xx(requests_mock):
    requests_mock.get("http://test-server:8789/catalog/noise/x",
                      status_code=503)
    with pytest.raises(requests.exceptions.HTTPError):
        fetch_catalog("noise", "x", server_url="http://test-server:8789",
                      token="t", timeout_s=3)
