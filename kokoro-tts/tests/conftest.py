"""Shared fixtures. Real Kokoro model is too heavy to load per test, so
service-level tests mock it. Audio helper tests run against numpy directly."""
import os
import pytest


@pytest.fixture(autouse=True)
def _test_env(monkeypatch):
    """Set predictable env so config.from_env() is deterministic in tests."""
    monkeypatch.setenv("PI_API_TOKEN", "test-token")
    monkeypatch.setenv("KOKORO_MODEL_PATH", "/fake/model.onnx")
    monkeypatch.setenv("KOKORO_VOICES_PATH", "/fake/voices.bin")
    monkeypatch.setenv("KOKORO_CATALOG_DIR", "/fake/cache")
    yield
