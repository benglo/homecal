from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient

from app.auth import require_pi_token


def _make_app():
    app = FastAPI()

    @app.get("/probe")
    def probe(_=Depends(require_pi_token)):
        return {"ok": True}

    return TestClient(app)


def test_missing_token_returns_401():
    r = _make_app().get("/probe")
    assert r.status_code == 401


def test_wrong_token_returns_401():
    r = _make_app().get("/probe", headers={"X-Pi-Token": "nope"})
    assert r.status_code == 401


def test_correct_token_returns_200():
    r = _make_app().get("/probe", headers={"X-Pi-Token": "test-token"})
    assert r.status_code == 200
    assert r.json() == {"ok": True}
