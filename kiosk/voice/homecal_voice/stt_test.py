import io, wave, numpy as np
from homecal_voice.stt import transcribe, pcm16_to_wav_bytes
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

def test_transcribe_posts_wav_and_parses_response(requests_mock):
    pcm = make_audio()
    requests_mock.post("http://127.0.0.1:8080/inference",
                       json={"text": "hello world"})
    out = transcribe(pcm, server_url="http://127.0.0.1:8080/inference", timeout_s=10)
    assert out == "hello world"

def test_transcribe_raises_on_non_200(requests_mock):
    pcm = make_audio()
    requests_mock.post("http://127.0.0.1:8080/inference", status_code=503)
    import pytest
    with pytest.raises(RuntimeError, match="whisper-server"):
        transcribe(pcm, server_url="http://127.0.0.1:8080/inference", timeout_s=2)
