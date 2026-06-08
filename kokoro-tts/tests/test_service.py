"""Tests for the FastAPI service skeleton and /healthz endpoint."""
from unittest.mock import MagicMock
from fastapi.testclient import TestClient

import app.service as service_mod


def _make_client(synth=None, ready=True):
    """Build a TestClient with a mocked Synth. Patch the module-level
    `state` so the real Kokoro never loads."""
    s = synth or MagicMock()
    service_mod.state.synth = s
    service_mod.state.ready = ready
    return TestClient(service_mod.app)


def test_healthz_503_when_not_ready():
    c = _make_client(ready=False)
    r = c.get("/healthz")
    assert r.status_code == 503


def test_healthz_200_when_ready():
    c = _make_client(ready=True)
    r = c.get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body == {"ok": True, "model_loaded": True, "warm": True}


def test_healthz_does_not_require_auth():
    c = _make_client(ready=True)
    r = c.get("/healthz")  # no X-Pi-Token header
    assert r.status_code == 200


def _synth_returning(wav=b"RIFFxxxxWAVEfake", latency_ms=42):
    s = MagicMock()
    s.synthesize.return_value = (wav, latency_ms)
    return s


def test_tts_requires_auth():
    c = _make_client(synth=_synth_returning())
    r = c.post("/tts", json={"text": "hi"})
    assert r.status_code == 401


def test_tts_returns_wav_bytes_with_latency_header():
    s = _synth_returning(wav=b"RIFF\x00\x00\x00\x00WAVEdataXYZ", latency_ms=123)
    c = _make_client(synth=s)
    r = c.post("/tts", json={"text": "hello world"}, headers={"X-Pi-Token": "test-token"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/wav"
    assert r.headers["x-synth-ms"] == "123"
    assert r.content.startswith(b"RIFF")


def test_tts_uses_default_voice_when_omitted():
    s = _synth_returning()
    c = _make_client(synth=s)
    c.post("/tts", json={"text": "hello"}, headers={"X-Pi-Token": "test-token"})
    _, kwargs = s.synthesize.call_args
    assert kwargs["voice"] == "af_bella"


def test_tts_passes_voice_when_provided():
    s = _synth_returning()
    c = _make_client(synth=s)
    c.post("/tts", json={"text": "hello", "voice": "bf_emma"},
           headers={"X-Pi-Token": "test-token"})
    _, kwargs = s.synthesize.call_args
    assert kwargs["voice"] == "bf_emma"


def test_tts_400_on_empty_text():
    c = _make_client(synth=_synth_returning())
    r = c.post("/tts", json={"text": ""}, headers={"X-Pi-Token": "test-token"})
    assert r.status_code == 400


def test_tts_400_on_whitespace_text():
    c = _make_client(synth=_synth_returning())
    r = c.post("/tts", json={"text": "   \n  "}, headers={"X-Pi-Token": "test-token"})
    assert r.status_code == 400


def test_tts_413_when_text_too_long():
    c = _make_client(synth=_synth_returning())
    too_long = "x" * 501
    r = c.post("/tts", json={"text": too_long}, headers={"X-Pi-Token": "test-token"})
    assert r.status_code == 413


def test_tts_503_when_synth_not_loaded():
    c = _make_client(synth=None, ready=False)
    r = c.post("/tts", json={"text": "hi"}, headers={"X-Pi-Token": "test-token"})
    assert r.status_code == 503


def test_catalog_noise_requires_auth():
    c = _make_client()
    r = c.get("/catalog/noise/fart")
    assert r.status_code == 401


def test_catalog_noise_returns_wav_for_existing_key(tmp_path, monkeypatch):
    # Override the catalog dir at runtime via env (cfg.from_env reads env each call).
    cache = tmp_path / "noise"
    cache.mkdir(parents=True)
    (cache / "fart.wav").write_bytes(b"RIFF\x00\x00\x00\x00WAVEdataX")
    monkeypatch.setenv("KOKORO_CATALOG_DIR", str(tmp_path))
    c = _make_client()
    r = c.get("/catalog/noise/fart", headers={"X-Pi-Token": "test-token"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/wav"
    assert r.content.startswith(b"RIFF")


def test_catalog_noise_404_for_missing_key(tmp_path, monkeypatch):
    (tmp_path / "noise").mkdir(parents=True)
    monkeypatch.setenv("KOKORO_CATALOG_DIR", str(tmp_path))
    c = _make_client()
    r = c.get("/catalog/noise/unknown", headers={"X-Pi-Token": "test-token"})
    assert r.status_code == 404


def test_catalog_joke_returns_wav(tmp_path, monkeypatch):
    cache = tmp_path / "joke"
    cache.mkdir(parents=True)
    (cache / "j001.wav").write_bytes(b"RIFF\x00\x00\x00\x00WAVEdataY")
    monkeypatch.setenv("KOKORO_CATALOG_DIR", str(tmp_path))
    c = _make_client()
    r = c.get("/catalog/joke/j001", headers={"X-Pi-Token": "test-token"})
    assert r.status_code == 200
    assert r.content.startswith(b"RIFF")


def test_catalog_rejects_path_traversal(tmp_path, monkeypatch):
    monkeypatch.setenv("KOKORO_CATALOG_DIR", str(tmp_path))
    c = _make_client()
    r = c.get("/catalog/noise/..%2F..%2Fetc%2Fpasswd",
              headers={"X-Pi-Token": "test-token"})
    assert r.status_code in (400, 404)
