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
    assert c.wake_word == "hey_mycroft"
    assert c.wake_threshold == 0.7
    assert c.wake_trigger_level == 2
    assert c.whisper_model == "small.en-q5_1"
    assert c.stt_model == "google/gemini-3-flash-preview"
    assert c.daily_request_cap == 200

def test_load_config_missing_required(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("HOMECAL_API_BASE", raising=False)
    monkeypatch.delenv("PI_API_TOKEN", raising=False)
    with pytest.raises(ConfigError, match="OPENROUTER_API_KEY"):
        load_config()
