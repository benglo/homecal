from unittest.mock import patch, MagicMock
from homecal_voice.tts import speak, synthesize

def test_synthesize_returns_audio_bytes(requests_mock):
    fake_mp3 = b"ID3\x03\x00\x00\x00fakebytes"
    requests_mock.post(
        "https://openrouter.ai/api/v1/audio/speech",
        content=fake_mp3,
        headers={"content-type": "audio/mpeg"},
    )
    out = synthesize("hello", model="google/gemini-3.1-flash-tts-preview", api_key="sk-or-xxx")
    assert out == fake_mp3

def test_speak_skips_when_muted(tmp_path):
    with patch("subprocess.run") as run:
        speak("hi", model="x", api_key="x", muted=True)
        run.assert_not_called()
