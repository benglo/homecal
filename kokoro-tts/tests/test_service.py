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
