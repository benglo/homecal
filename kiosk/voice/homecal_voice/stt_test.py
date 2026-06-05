import io, wave, base64, numpy as np, pytest
from homecal_voice.stt import (
    transcribe,
    transcribe_local,
    transcribe_openrouter,
    transcribe_with_fallback,
    pcm16_to_wav_bytes,
    OPENROUTER_URL,
)
from homecal_voice.mic import SAMPLE_RATE


def make_audio(seconds: float = 1.0) -> np.ndarray:
    return (np.random.randn(int(seconds * SAMPLE_RATE)) * 1000).astype(np.int16)


def test_pcm16_to_wav_round_trip():
    pcm = make_audio()
    wav = pcm16_to_wav_bytes(pcm)
    with wave.open(io.BytesIO(wav), "rb") as r:
        assert r.getframerate() == SAMPLE_RATE
        assert r.getnchannels() == 1
        assert r.getsampwidth() == 2


def test_transcribe_local_posts_wav_and_parses_response(requests_mock):
    requests_mock.post("http://127.0.0.1:8080/inference", json={"text": "hello world"})
    out = transcribe_local(make_audio(), server_url="http://127.0.0.1:8080/inference", timeout_s=10)
    assert out == "hello world"


def test_transcribe_local_raises_on_non_200(requests_mock):
    requests_mock.post("http://127.0.0.1:8080/inference", status_code=503)
    with pytest.raises(RuntimeError, match="whisper-server"):
        transcribe_local(make_audio(), server_url="http://127.0.0.1:8080/inference", timeout_s=2)


def test_transcribe_alias_points_at_local():
    # Back-compat: existing callers import `transcribe` directly.
    assert transcribe is transcribe_local


def _or_response(content: str) -> dict:
    return {"choices": [{"message": {"content": content}}]}


def test_transcribe_openrouter_parses_content(requests_mock):
    requests_mock.post(OPENROUTER_URL, json=_or_response("Hello world"))
    out = transcribe_openrouter(make_audio(), api_key="sk-test", model="openai/gpt-audio-mini")
    assert out == "Hello world"


def test_transcribe_openrouter_strips_surrounding_quotes(requests_mock):
    requests_mock.post(OPENROUTER_URL, json=_or_response('"What is for dinner tonight?"'))
    out = transcribe_openrouter(make_audio(), api_key="sk-test", model="openai/gpt-audio-mini")
    assert out == "What is for dinner tonight?"


def test_transcribe_openrouter_sends_audio_as_base64_wav(requests_mock):
    requests_mock.post(OPENROUTER_URL, json=_or_response("ok"))
    transcribe_openrouter(make_audio(), api_key="sk-test", model="openai/gpt-audio-mini")
    body = requests_mock.last_request.json()
    assert body["model"] == "openai/gpt-audio-mini"
    parts = body["messages"][0]["content"]
    audio_part = next(p for p in parts if p["type"] == "input_audio")
    assert audio_part["input_audio"]["format"] == "wav"
    # base64 payload must be valid WAV when decoded.
    decoded = base64.b64decode(audio_part["input_audio"]["data"])
    with wave.open(io.BytesIO(decoded), "rb") as r:
        assert r.getframerate() == SAMPLE_RATE


def test_transcribe_openrouter_sets_auth_header(requests_mock):
    requests_mock.post(OPENROUTER_URL, json=_or_response("ok"))
    transcribe_openrouter(make_audio(), api_key="sk-test-key", model="openai/gpt-audio-mini")
    assert requests_mock.last_request.headers["Authorization"] == "Bearer sk-test-key"


def test_transcribe_openrouter_raises_on_http_error(requests_mock):
    requests_mock.post(OPENROUTER_URL, status_code=429, text="rate limited")
    with pytest.raises(RuntimeError, match="openrouter stt 429"):
        transcribe_openrouter(make_audio(), api_key="sk-test", model="openai/gpt-audio-mini")


def test_transcribe_openrouter_raises_on_malformed_response(requests_mock):
    requests_mock.post(OPENROUTER_URL, json={"unexpected": "shape"})
    with pytest.raises(RuntimeError, match="malformed"):
        transcribe_openrouter(make_audio(), api_key="sk-test", model="openai/gpt-audio-mini")


def test_transcribe_with_fallback_uses_openrouter_on_success(requests_mock):
    requests_mock.post(OPENROUTER_URL, json=_or_response("from openrouter"))
    # Local mock would only be hit on fallback.
    requests_mock.post("http://127.0.0.1:8080/inference", json={"text": "from local"})
    out = transcribe_with_fallback(
        make_audio(),
        openrouter_api_key="sk-test",
        openrouter_model="openai/gpt-audio-mini",
        whisper_server_url="http://127.0.0.1:8080/inference",
    )
    assert out == "from openrouter"


def test_transcribe_with_fallback_falls_back_on_openrouter_failure(requests_mock):
    requests_mock.post(OPENROUTER_URL, status_code=500, text="upstream error")
    requests_mock.post("http://127.0.0.1:8080/inference", json={"text": "from local"})
    out = transcribe_with_fallback(
        make_audio(),
        openrouter_api_key="sk-test",
        openrouter_model="openai/gpt-audio-mini",
        whisper_server_url="http://127.0.0.1:8080/inference",
    )
    assert out == "from local"


def test_transcribe_with_fallback_propagates_local_failure(requests_mock):
    requests_mock.post(OPENROUTER_URL, status_code=500, text="upstream error")
    requests_mock.post("http://127.0.0.1:8080/inference", status_code=503)
    with pytest.raises(RuntimeError, match="whisper-server"):
        transcribe_with_fallback(
            make_audio(),
            openrouter_api_key="sk-test",
            openrouter_model="openai/gpt-audio-mini",
            whisper_server_url="http://127.0.0.1:8080/inference",
        )


def test_transcribe_with_fallback_does_not_mask_auth_errors(requests_mock):
    """A 401 is a broken-API-key config bug, not a transient outage. If we
    silently fall back to local Whisper the bug stays hidden indefinitely
    and the operator only notices when the OpenRouter dashboard goes
    quiet."""
    requests_mock.post(OPENROUTER_URL, status_code=401, text="invalid key")
    requests_mock.post("http://127.0.0.1:8080/inference", json={"text": "from local"})
    with pytest.raises(RuntimeError, match="openrouter stt 401"):
        transcribe_with_fallback(
            make_audio(),
            openrouter_api_key="sk-bad",
            openrouter_model="openai/gpt-audio-mini",
            whisper_server_url="http://127.0.0.1:8080/inference",
        )


def test_transcribe_with_fallback_does_not_mask_quota_errors(requests_mock):
    requests_mock.post(OPENROUTER_URL, status_code=429, text="rate limited")
    requests_mock.post("http://127.0.0.1:8080/inference", json={"text": "from local"})
    with pytest.raises(RuntimeError, match="openrouter stt 429"):
        transcribe_with_fallback(
            make_audio(),
            openrouter_api_key="sk-test",
            openrouter_model="openai/gpt-audio-mini",
            whisper_server_url="http://127.0.0.1:8080/inference",
        )


def test_transcribe_with_fallback_falls_back_on_network_error(requests_mock):
    import requests
    requests_mock.post(OPENROUTER_URL, exc=requests.ConnectionError("dns fail"))
    requests_mock.post("http://127.0.0.1:8080/inference", json={"text": "from local"})
    out = transcribe_with_fallback(
        make_audio(),
        openrouter_api_key="sk-test",
        openrouter_model="openai/gpt-audio-mini",
        whisper_server_url="http://127.0.0.1:8080/inference",
    )
    assert out == "from local"
