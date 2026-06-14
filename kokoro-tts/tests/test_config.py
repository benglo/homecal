from app.config import Config, from_env


def test_from_env_reads_required_fields(monkeypatch):
    monkeypatch.setenv("PI_API_TOKEN", "abc")
    monkeypatch.setenv("KOKORO_MODEL_PATH", "/m.onnx")
    monkeypatch.setenv("KOKORO_VOICES_PATH", "/v.bin")
    monkeypatch.setenv("KOKORO_CATALOG_DIR", "/c")
    cfg = from_env()
    assert cfg.pi_api_token == "abc"
    assert cfg.model_path == "/m.onnx"
    assert cfg.voices_path == "/v.bin"
    assert cfg.catalog_dir == "/c"


def test_default_voice_and_max_text_length():
    cfg = from_env()
    assert cfg.default_voice == "af_bella"
    assert cfg.max_text_chars == 500


def test_missing_required_env_raises(monkeypatch):
    monkeypatch.delenv("PI_API_TOKEN", raising=False)
    try:
        from_env()
    except RuntimeError as e:
        assert "PI_API_TOKEN" in str(e)
    else:
        raise AssertionError("expected RuntimeError")
