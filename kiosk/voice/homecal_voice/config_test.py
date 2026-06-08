import os, pytest
from homecal_voice.config import load_config, ConfigError

def test_load_config_from_env(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-xxx")
    monkeypatch.setenv("HOMECAL_API_BASE", "http://192.168.1.94:8787")
    monkeypatch.setenv("PI_API_TOKEN", "abc123")
    c = load_config()
    assert c.openrouter_api_key == "sk-or-xxx"
    assert c.homecal_api_base == "http://192.168.1.94:8787"
    assert c.pi_api_token == "abc123"
    assert c.wake_word == "hey_luna"
    assert c.wake_threshold == 0.7
    assert c.wake_trigger_level == 2
    assert c.whisper_model == "small.en-q5_1"
    assert c.stt_model == "google/gemini-3-flash-preview"
    assert c.vad_gain == 5.0
    assert c.energy_rms_threshold == 5500.0
    assert c.daily_request_cap == 200

def test_load_config_missing_required(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("HOMECAL_API_BASE", raising=False)
    monkeypatch.delenv("PI_API_TOKEN", raising=False)
    with pytest.raises(ConfigError, match="OPENROUTER_API_KEY"):
        load_config()

def test_tts_backend_defaults_to_cloud(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-xxx")
    monkeypatch.setenv("HOMECAL_API_BASE", "http://192.168.1.94:8787")
    monkeypatch.setenv("PI_API_TOKEN", "abc123")
    monkeypatch.delenv("TTS_BACKEND", raising=False)
    cfg = load_config()
    assert cfg.tts_backend == "cloud"

def test_tts_backend_reads_env(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-xxx")
    monkeypatch.setenv("HOMECAL_API_BASE", "http://192.168.1.94:8787")
    monkeypatch.setenv("PI_API_TOKEN", "abc123")
    monkeypatch.setenv("TTS_BACKEND", "lan")
    cfg = load_config()
    assert cfg.tts_backend == "lan"

def test_tts_backend_rejects_invalid_value(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-xxx")
    monkeypatch.setenv("HOMECAL_API_BASE", "http://192.168.1.94:8787")
    monkeypatch.setenv("PI_API_TOKEN", "abc123")
    monkeypatch.setenv("TTS_BACKEND", "wrong")
    try:
        load_config()
    except ValueError as e:
        assert "TTS_BACKEND" in str(e)
    else:
        raise AssertionError("expected ValueError")

def test_tts_server_url_default_and_override(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-xxx")
    monkeypatch.setenv("HOMECAL_API_BASE", "http://192.168.1.94:8787")
    monkeypatch.setenv("PI_API_TOKEN", "abc123")
    monkeypatch.delenv("TTS_SERVER_URL", raising=False)
    cfg = load_config()
    assert cfg.tts_server_url == "http://192.168.1.94:8789"
    monkeypatch.setenv("TTS_SERVER_URL", "http://10.0.0.5:8000")
    assert load_config().tts_server_url == "http://10.0.0.5:8000"

def test_tts_server_timeout_default_is_3s(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-xxx")
    monkeypatch.setenv("HOMECAL_API_BASE", "http://192.168.1.94:8787")
    monkeypatch.setenv("PI_API_TOKEN", "abc123")
    monkeypatch.delenv("TTS_SERVER_TIMEOUT_S", raising=False)
    cfg = load_config()
    assert cfg.tts_server_timeout_s == 3
