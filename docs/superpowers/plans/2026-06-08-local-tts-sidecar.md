# Local TTS Sidecar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Python `kokoro-tts` sidecar to the existing `docker-compose.yml` so TTS runs on the home server (LAN, ~1.2 s synth) instead of OpenRouter (cloud, 1-3 s typical with read-timeouts). Wire the Pi voice service to use it via a `lan → cloud → didnt_catch.mp3 → silent` fallback ladder, pre-render the noise + joke catalogs at image build, surface TTS provenance on the wall via an ambient dot on `VoiceChip`.

**Architecture:** FastAPI service in a separate container, WAV-over-LAN, `X-Pi-Token` auth, model + voices baked into the image. Pi side gets a 30 s health-cache (mirrors `is_muted_locally`) and per-day cap on cloud fallback (mirrors `_under_cap`). Backend migration v7 adds `tts_provider` + `tts_latency_ms` to `voice_utterances`; `/api/voice/status` gains `last_tts_provider`.

**Tech Stack:** Python 3.13 + FastAPI + onnxruntime + kokoro-onnx + espeak-ng (sidecar); pytest. TypeScript Fastify + zod + better-sqlite3 (backend); node:test. Python requests + existing voice service (Pi); pytest. React + TanStack Query (frontend); vitest.

**Spec:** `docs/superpowers/specs/2026-06-08-local-tts-sidecar-design.md`. All "spec §N" references in this plan point there.

---

## File map

**New (sidecar):**
- `kokoro-tts/Dockerfile`
- `kokoro-tts/Makefile` — model-pull target
- `kokoro-tts/.gitignore` — exclude `models/`, `.venv/`, `__pycache__/`
- `kokoro-tts/requirements.txt` — pinned deps
- `kokoro-tts/pyproject.toml` — pytest config
- `kokoro-tts/app/__init__.py`
- `kokoro-tts/app/config.py` — env-driven settings
- `kokoro-tts/app/auth.py` — `X-Pi-Token` dependency
- `kokoro-tts/app/audio.py` — int16 conversion + lead silence + peak-normalize + WAV serialize
- `kokoro-tts/app/synth.py` — Kokoro wrapper (load model, synth, return numpy)
- `kokoro-tts/app/service.py` — FastAPI app, all HTTP endpoints
- `kokoro-tts/app/render_catalogs.py` — build-time CLI that renders WAVs into `/app/cache/`
- `kokoro-tts/tests/__init__.py`
- `kokoro-tts/tests/conftest.py`
- `kokoro-tts/tests/test_config.py`
- `kokoro-tts/tests/test_auth.py`
- `kokoro-tts/tests/test_audio.py`
- `kokoro-tts/tests/test_synth.py`
- `kokoro-tts/tests/test_service.py`
- `kokoro-tts/tests/test_render_catalogs.py`

**Modified:**
- `docker-compose.yml` — add `kokoro-tts` service
- `.gitignore` — already covers `_incoming`; nothing new
- `backend/src/db/migrate.ts` — append v7
- `backend/src/db/migrate.test.ts` — pin v7 columns
- `backend/src/schemas.ts` — extend `voiceAuditBody`
- `backend/src/repos/voiceUtterances.ts` — pass through new fields + new `getLastTtsProvider()`
- `backend/src/repos/voiceUtterances.test.ts` — round-trip + lookup tests
- `backend/src/routes/voice.ts` — extend `/api/voice/status`
- `backend/src/routes/voice.test.ts` — status payload test
- `kiosk/voice/homecal_voice/config.py` — `tts_backend`, `tts_server_url`, `tts_server_timeout_s`
- `kiosk/voice/homecal_voice/config_test.py` — env parsing
- `kiosk/voice/homecal_voice/tts.py` — `synthesize_lan`, `fetch_catalog`, player-priority swap
- `kiosk/voice/homecal_voice/tts_test.py` — new tests
- `kiosk/voice/homecal_voice/server_state.py` — `post_audit` accepts `tts_provider`, `tts_latency_ms`
- `kiosk/voice/homecal_voice/server_state_test.py` — extend
- `kiosk/voice/homecal_voice/main.py` — `_lan_state` cache, `_under_tts_cap`, `_speak()` ladder
- `kiosk/voice/homecal_voice/main_test.py` — ladder tests
- `kiosk/voice/homecal_voice/executor.py` — `_noise_play` + `_joke_tell` use catalog endpoints
- `kiosk/voice/homecal_voice/executor_test.py` — extend
- `frontend/src/core/api/client.ts` — `VoiceStatus` type extension
- `frontend/src/components/controls/VoiceChip.tsx` — ambient dot
- `frontend/src/components/controls/VoiceChip.test.ts` — dot colour tests
- `kiosk/voice-install.sh` — env template update
- `docs/superpowers/specs/2026-06-04-voice-commands-design.md` — single-origin one-liner clarification

---

## Task 0: Worktree (only if executing via subagent-driven flow)

**Files:**
- N/A (workspace setup)

- [ ] **Step 1: Create an isolated worktree**

If this plan will be executed with subagents, create a worktree per the `superpowers:using-git-worktrees` skill. If executing inline, skip this task.

```bash
git worktree add -b feat/local-tts-sidecar ../homecal-tts-worktree feat/voice-kid-intents
cd ../homecal-tts-worktree
```

- [ ] **Step 2: Confirm baseline tests pass**

Run from the worktree root:

```bash
npm install
npm --workspace backend test
cd kiosk/voice && .venv/bin/pytest -q && cd -
npm --workspace frontend test
```

Expected: all green (420 pytest, plus existing backend + frontend suites).

---

## Task 1: Scaffold `kokoro-tts/` directory

**Files:**
- Create: `kokoro-tts/.gitignore`
- Create: `kokoro-tts/requirements.txt`
- Create: `kokoro-tts/pyproject.toml`
- Create: `kokoro-tts/app/__init__.py`
- Create: `kokoro-tts/tests/__init__.py`
- Create: `kokoro-tts/tests/conftest.py`

- [ ] **Step 1: Create `kokoro-tts/.gitignore`**

```
.venv/
__pycache__/
*.pyc
.pytest_cache/
models/
app/cache/
```

- [ ] **Step 2: Create `kokoro-tts/requirements.txt`** (pinned)

```
fastapi==0.118.0
uvicorn[standard]==0.32.0
kokoro-onnx==0.5.0
onnxruntime==1.26.0
numpy==2.4.6
requests==2.32.3
```

- [ ] **Step 3: Create `kokoro-tts/pyproject.toml`** (pytest config)

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
```

- [ ] **Step 4: Create empty package files**

```python
# kokoro-tts/app/__init__.py
# kokoro-tts/tests/__init__.py
```

(Both files are empty.)

- [ ] **Step 5: Create `kokoro-tts/tests/conftest.py`**

```python
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
```

- [ ] **Step 6: Create a Python 3.13 venv with the pinned deps**

```bash
cd kokoro-tts
python3.13 -m venv .venv || /snap/bin/uv venv .venv --python 3.13
.venv/bin/pip install -U pip
.venv/bin/pip install -r requirements.txt
.venv/bin/pip install pytest httpx
```

Expected: clean install, no errors. `httpx` is for FastAPI's `TestClient`.

- [ ] **Step 7: Run pytest to confirm wiring**

```bash
cd kokoro-tts && .venv/bin/pytest -q
```

Expected: `no tests ran` (0 collected). Confirms pyproject + conftest are wired.

- [ ] **Step 8: Commit**

```bash
git add kokoro-tts/
git commit -m "chore(kokoro-tts): scaffold sidecar package + venv"
```

---

## Task 2: `app/config.py` — env-driven settings

**Files:**
- Create: `kokoro-tts/app/config.py`
- Test: `kokoro-tts/tests/test_config.py`

- [ ] **Step 1: Write the failing test**

```python
# kokoro-tts/tests/test_config.py
import os
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
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd kokoro-tts && .venv/bin/pytest tests/test_config.py -v
```

Expected: FAIL — `ImportError: cannot import name 'Config'`.

- [ ] **Step 3: Implement `app/config.py`**

```python
"""Env-driven configuration. All required values must be set; missing
required vars raise loudly at startup so a misconfigured container can't
boot and silently serve wrong-voice synth."""
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    pi_api_token: str
    model_path: str
    voices_path: str
    catalog_dir: str
    default_voice: str = "af_bella"
    max_text_chars: int = 500
    listen_host: str = "0.0.0.0"
    listen_port: int = 8789


def _require(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        raise RuntimeError(f"required env var {name} is not set")
    return v


def from_env() -> Config:
    return Config(
        pi_api_token=_require("PI_API_TOKEN"),
        model_path=_require("KOKORO_MODEL_PATH"),
        voices_path=_require("KOKORO_VOICES_PATH"),
        catalog_dir=_require("KOKORO_CATALOG_DIR"),
        listen_host=os.environ.get("KOKORO_LISTEN_HOST", "0.0.0.0"),
        listen_port=int(os.environ.get("KOKORO_LISTEN_PORT", "8789")),
    )
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd kokoro-tts && .venv/bin/pytest tests/test_config.py -v
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add kokoro-tts/app/config.py kokoro-tts/tests/test_config.py
git commit -m "feat(kokoro-tts): env-driven config (loud-fail on missing required)"
```

---

## Task 3: `app/auth.py` — `X-Pi-Token` dependency

**Files:**
- Create: `kokoro-tts/app/auth.py`
- Test: `kokoro-tts/tests/test_auth.py`

- [ ] **Step 1: Write failing tests**

```python
# kokoro-tts/tests/test_auth.py
import pytest
from fastapi import FastAPI, Depends, HTTPException
from fastapi.testclient import TestClient

from app.auth import require_pi_token
from app.config import from_env


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
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd kokoro-tts && .venv/bin/pytest tests/test_auth.py -v
```

Expected: FAIL — `ImportError`.

- [ ] **Step 3: Implement `app/auth.py`**

```python
"""X-Pi-Token verification dependency. Compares against the same token the
Pi voice service uses (PI_API_TOKEN env). Returns 401 on missing/wrong;
never echoes the expected token in the error body."""
from fastapi import Header, HTTPException, status
from app.config import from_env


async def require_pi_token(x_pi_token: str | None = Header(default=None)):
    expected = from_env().pi_api_token
    if not x_pi_token or x_pi_token != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or missing X-Pi-Token",
        )
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd kokoro-tts && .venv/bin/pytest tests/test_auth.py -v
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add kokoro-tts/app/auth.py kokoro-tts/tests/test_auth.py
git commit -m "feat(kokoro-tts): X-Pi-Token dependency (mirrors backend piGuard)"
```

---

## Task 4: `app/audio.py` — WAV serialization + int16 conversion

**Files:**
- Create: `kokoro-tts/app/audio.py`
- Test: `kokoro-tts/tests/test_audio.py`

- [ ] **Step 1: Write failing tests (WAV + int16 only — silence + normalize come in Task 5)**

```python
# kokoro-tts/tests/test_audio.py
import io
import wave
import numpy as np
import pytest

from app.audio import to_wav_bytes, float32_to_int16, SAMPLE_RATE


def _read_wav(buf: bytes):
    with wave.open(io.BytesIO(buf), "rb") as w:
        return {
            "channels": w.getnchannels(),
            "sampwidth": w.getsampwidth(),
            "framerate": w.getframerate(),
            "nframes": w.getnframes(),
            "raw": w.readframes(w.getnframes()),
        }


def test_sample_rate_is_24khz():
    assert SAMPLE_RATE == 24000


def test_float32_to_int16_round_trips_zero():
    out = float32_to_int16(np.zeros(100, dtype=np.float32))
    assert out.dtype == np.int16
    assert np.all(out == 0)


def test_float32_to_int16_clips_out_of_range():
    out = float32_to_int16(np.array([1.5, -1.5, 0.5], dtype=np.float32))
    # 1.0 → 32767; -1.0 → -32768; 0.5 → ~16384
    assert out[0] == 32767
    assert out[1] == -32767  # symmetric clip, not -32768
    assert 16000 < out[2] < 16500


def test_to_wav_bytes_writes_mono_24khz_s16():
    samples = np.zeros(1200, dtype=np.float32)  # 50ms @ 24kHz
    buf = to_wav_bytes(samples)
    parsed = _read_wav(buf)
    assert parsed["channels"] == 1
    assert parsed["sampwidth"] == 2
    assert parsed["framerate"] == SAMPLE_RATE
    assert parsed["nframes"] == 1200
    assert len(parsed["raw"]) == 1200 * 2
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd kokoro-tts && .venv/bin/pytest tests/test_audio.py -v
```

Expected: FAIL — `ImportError`.

- [ ] **Step 3: Implement `app/audio.py` (Task-4 subset)**

```python
"""Audio post-processing for Kokoro output.

Kokoro emits float32 PCM at 24 kHz mono. We convert to int16 + WAV before
sending over LAN because (a) every Linux audio player handles WAV natively,
(b) int16 halves the wire bytes vs fp32 with no audible loss for TTS, (c)
no re-encoding cost (vs MP3/Opus). 100ms leading silence + peak normalize
are applied at synth time (see synth.py) — this module only owns the bytes."""
import io
import wave
import numpy as np

SAMPLE_RATE = 24000  # Kokoro's native rate


def float32_to_int16(samples: np.ndarray) -> np.ndarray:
    """Clip to [-1, 1] and scale to symmetric int16. Symmetric clip (-32767
    not -32768) keeps amplitude balanced — saves a half-LSB DC offset that's
    inaudible but theoretically annoying to a level-meter."""
    clipped = np.clip(samples, -1.0, 1.0)
    return (clipped * 32767.0).astype(np.int16)


def to_wav_bytes(samples: np.ndarray) -> bytes:
    """Wrap float32 PCM samples in a mono/16-bit/24kHz WAV blob."""
    pcm = float32_to_int16(samples)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd kokoro-tts && .venv/bin/pytest tests/test_audio.py -v
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add kokoro-tts/app/audio.py kokoro-tts/tests/test_audio.py
git commit -m "feat(kokoro-tts): WAV serialization (mono 24kHz int16) + symmetric-clip int16 conv"
```

---

## Task 5: `app/audio.py` — leading silence + peak normalize

**Files:**
- Modify: `kokoro-tts/app/audio.py`
- Modify: `kokoro-tts/tests/test_audio.py`

- [ ] **Step 1: Append failing tests**

Add to `kokoro-tts/tests/test_audio.py`:

```python
from app.audio import prepend_silence, peak_normalize, LEAD_SILENCE_MS, PEAK_DBFS


def test_lead_silence_constant_is_100ms():
    assert LEAD_SILENCE_MS == 100


def test_target_peak_is_minus_3_dbfs():
    assert PEAK_DBFS == -3.0


def test_prepend_silence_adds_correct_sample_count():
    samples = np.ones(100, dtype=np.float32) * 0.5
    out = prepend_silence(samples)
    expected_silence = SAMPLE_RATE * LEAD_SILENCE_MS // 1000  # 2400 @ 24kHz
    assert len(out) == 100 + expected_silence
    assert np.all(out[:expected_silence] == 0.0)
    assert np.array_equal(out[expected_silence:], samples)


def test_peak_normalize_to_minus_3_dbfs():
    # Loud signal at 0.9 peak; normalize should pull down to 10^(-3/20) ≈ 0.7079
    samples = np.array([0.9, -0.9, 0.45], dtype=np.float32)
    out = peak_normalize(samples)
    target = 10 ** (PEAK_DBFS / 20)
    assert abs(np.max(np.abs(out)) - target) < 1e-4
    # Ratios preserved
    assert abs(out[2] / out[0] - 0.5) < 1e-6


def test_peak_normalize_silent_returns_unchanged():
    samples = np.zeros(100, dtype=np.float32)
    out = peak_normalize(samples)
    assert np.all(out == 0.0)  # no divide-by-zero blowup
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd kokoro-tts && .venv/bin/pytest tests/test_audio.py -v
```

Expected: FAIL — `ImportError: cannot import name 'prepend_silence'`.

- [ ] **Step 3: Append implementation to `app/audio.py`**

```python
LEAD_SILENCE_MS = 100  # Masks Boom 3 A2DP wake-up clipping the first phoneme
PEAK_DBFS = -3.0       # Headroom for downstream re-encoding (BT codec)


def prepend_silence(samples: np.ndarray) -> np.ndarray:
    """Prepend LEAD_SILENCE_MS of zeros. Bluetooth speakers — Boom 3
    specifically — drop the first 150-400ms of audio after an idle period
    while their amplifier wakes up. The leading zeros become the throwaway
    bytes, the actual speech survives."""
    n = SAMPLE_RATE * LEAD_SILENCE_MS // 1000
    silence = np.zeros(n, dtype=samples.dtype)
    return np.concatenate([silence, samples])


def peak_normalize(samples: np.ndarray) -> np.ndarray:
    """Scale so the peak absolute value sits at PEAK_DBFS.

    Eliminates loudness variance across ONNX runtime / quantization versions
    so the kid never has to ask 'why was that one so quiet?' Silent input
    (all zeros) returns unchanged — no divide-by-zero."""
    peak = float(np.max(np.abs(samples)))
    if peak < 1e-9:
        return samples
    target_linear = 10 ** (PEAK_DBFS / 20)
    return samples * (target_linear / peak)
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd kokoro-tts && .venv/bin/pytest tests/test_audio.py -v
```

Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add kokoro-tts/app/audio.py kokoro-tts/tests/test_audio.py
git commit -m "feat(kokoro-tts): leading silence (BT wake-up mask) + peak normalize to -3 dBFS"
```

---

## Task 6: `app/synth.py` — Kokoro wrapper

**Files:**
- Create: `kokoro-tts/app/synth.py`
- Test: `kokoro-tts/tests/test_synth.py`

- [ ] **Step 1: Write failing tests (Kokoro itself is mocked — real model load goes through `service.py` startup)**

```python
# kokoro-tts/tests/test_synth.py
import numpy as np
from unittest.mock import MagicMock, patch

from app.synth import Synth


def _fake_kokoro(samples=None, sr=24000):
    """Return a mock Kokoro whose .create() returns predictable bytes."""
    k = MagicMock()
    k.create.return_value = (samples if samples is not None else np.linspace(-0.5, 0.5, 24000, dtype=np.float32), sr)
    return k


def test_synth_returns_wav_bytes_with_lead_silence_and_normalized_peak():
    fake_samples = np.array([0.9, -0.9, 0.5, -0.5] * 100, dtype=np.float32)
    with patch("app.synth.Kokoro", return_value=_fake_kokoro(samples=fake_samples)):
        s = Synth(model_path="/x", voices_path="/y")
        wav, latency_ms = s.synthesize("hello", voice="af_bella")
    # WAV header check: starts with "RIFF" + size + "WAVE"
    assert wav[:4] == b"RIFF" and wav[8:12] == b"WAVE"
    # Latency must be measured (> 0)
    assert latency_ms >= 0


def test_synth_passes_voice_param_to_kokoro():
    fake = _fake_kokoro()
    with patch("app.synth.Kokoro", return_value=fake):
        s = Synth(model_path="/x", voices_path="/y")
        s.synthesize("hi", voice="bf_emma")
    args, kwargs = fake.create.call_args
    assert kwargs.get("voice") == "bf_emma"


def test_synth_warmup_runs_one_synth():
    fake = _fake_kokoro()
    with patch("app.synth.Kokoro", return_value=fake):
        s = Synth(model_path="/x", voices_path="/y")
        s.warmup()
    # One warm call after construction
    assert fake.create.call_count == 1
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd kokoro-tts && .venv/bin/pytest tests/test_synth.py -v
```

Expected: FAIL — `ImportError`.

- [ ] **Step 3: Implement `app/synth.py`**

```python
"""Kokoro wrapper. Loads the ONNX model + voices once at construction
(~1.1s on i5-7400), then synth.synthesize() returns ready-to-stream WAV
bytes with lead silence + peak normalize applied.

Construction blocks until the model is loaded. The /healthz endpoint
should only return 200 after warmup() has run successfully — that's the
contract callers rely on to avoid sending traffic before the model is
warm in caches."""
import time
from typing import Tuple

import numpy as np
from kokoro_onnx import Kokoro

from app.audio import to_wav_bytes, prepend_silence, peak_normalize


class Synth:
    def __init__(self, *, model_path: str, voices_path: str):
        self._k = Kokoro(model_path=model_path, voices_path=voices_path)

    def warmup(self) -> None:
        """Run one synth so ONNX runtime allocates its working memory.
        Without this the first real request is 2-3× slower."""
        self._k.create("warm", voice="af_bella", speed=1.0, lang="en-us")

    def synthesize(self, text: str, *, voice: str, speed: float = 1.0) -> Tuple[bytes, int]:
        """Synthesize text → (WAV bytes, server-side wall-clock ms)."""
        t0 = time.monotonic()
        samples, _sr = self._k.create(text, voice=voice, speed=speed, lang="en-us")
        normalized = peak_normalize(samples)
        with_silence = prepend_silence(normalized)
        wav = to_wav_bytes(with_silence)
        latency_ms = int((time.monotonic() - t0) * 1000)
        return wav, latency_ms
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd kokoro-tts && .venv/bin/pytest tests/test_synth.py -v
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add kokoro-tts/app/synth.py kokoro-tts/tests/test_synth.py
git commit -m "feat(kokoro-tts): Synth wrapper — load once, warmup, return WAV + latency"
```

---

## Task 7: `app/service.py` — FastAPI skeleton + `/healthz`

**Files:**
- Create: `kokoro-tts/app/service.py`
- Test: `kokoro-tts/tests/test_service.py`

- [ ] **Step 1: Write failing test**

```python
# kokoro-tts/tests/test_service.py
from unittest.mock import MagicMock, patch
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
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd kokoro-tts && .venv/bin/pytest tests/test_service.py -v
```

Expected: FAIL — `ImportError`.

- [ ] **Step 3: Implement `app/service.py` (skeleton + /healthz only)**

```python
"""FastAPI app for the kokoro-tts sidecar.

State (module-level `state`) holds the loaded Synth. The lifespan handler
loads + warms the model at startup, sets state.ready=True, and tears down
on shutdown. Tests can substitute state.synth with a mock without doing
the lifespan dance."""
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Optional

from fastapi import FastAPI

from app.config import from_env
from app.synth import Synth


@dataclass
class State:
    synth: Optional[Synth] = None
    ready: bool = False


state = State()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    cfg = from_env()
    state.synth = Synth(model_path=cfg.model_path, voices_path=cfg.voices_path)
    state.synth.warmup()
    state.ready = True
    try:
        yield
    finally:
        state.ready = False
        state.synth = None


app = FastAPI(lifespan=lifespan)


@app.get("/healthz")
def healthz():
    if not state.ready or state.synth is None:
        from fastapi import Response
        return Response(status_code=503)
    return {"ok": True, "model_loaded": True, "warm": True}
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd kokoro-tts && .venv/bin/pytest tests/test_service.py -v
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add kokoro-tts/app/service.py kokoro-tts/tests/test_service.py
git commit -m "feat(kokoro-tts): FastAPI skeleton + /healthz (503 until model loaded + warm)"
```

---

## Task 8: `app/service.py` — `POST /tts`

**Files:**
- Modify: `kokoro-tts/app/service.py`
- Modify: `kokoro-tts/tests/test_service.py`

- [ ] **Step 1: Append failing tests**

Add to `kokoro-tts/tests/test_service.py`:

```python
from unittest.mock import MagicMock


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
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd kokoro-tts && .venv/bin/pytest tests/test_service.py -v
```

Expected: FAIL — `404 Not Found` on `/tts`.

- [ ] **Step 3: Add `/tts` to `app/service.py`** (append after `/healthz`)

```python
from fastapi import Depends, HTTPException, Response, status
from pydantic import BaseModel, Field

from app.auth import require_pi_token


class TtsRequest(BaseModel):
    text: str = Field(..., min_length=0)
    voice: str | None = None


@app.post("/tts")
def tts(req: TtsRequest, _=Depends(require_pi_token)):
    if state.synth is None or not state.ready:
        return Response(status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
    text = req.text or ""
    if not text.strip():
        raise HTTPException(status_code=400, detail="text must be non-empty")
    cfg = from_env()
    if len(text) > cfg.max_text_chars:
        raise HTTPException(status_code=413, detail=f"text exceeds {cfg.max_text_chars} chars")
    voice = req.voice or cfg.default_voice
    wav, latency_ms = state.synth.synthesize(text, voice=voice)
    return Response(
        content=wav,
        media_type="audio/wav",
        headers={"X-Synth-Ms": str(latency_ms)},
    )
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd kokoro-tts && .venv/bin/pytest tests/test_service.py -v
```

Expected: PASS (11 tests total).

- [ ] **Step 5: Commit**

```bash
git add kokoro-tts/app/service.py kokoro-tts/tests/test_service.py
git commit -m "feat(kokoro-tts): POST /tts (X-Pi-Token, 400/413/503, X-Synth-Ms header)"
```

---

## Task 9: `app/service.py` — catalog endpoints

**Files:**
- Modify: `kokoro-tts/app/service.py`
- Modify: `kokoro-tts/tests/test_service.py`

- [ ] **Step 1: Append failing tests**

```python
import os
from pathlib import Path


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
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd kokoro-tts && .venv/bin/pytest tests/test_service.py -v -k catalog
```

Expected: FAIL — `404` on `/catalog/noise/...`.

- [ ] **Step 3: Add catalog endpoints to `app/service.py`**

```python
import re
from pathlib import Path

_SAFE_KEY = re.compile(r"^[a-z0-9_-]{1,64}$")


def _read_catalog_clip(kind: str, key: str) -> bytes:
    """Read a pre-rendered WAV from the catalog dir. Key must match a
    strict charset — rejecting anything else closes off path-traversal
    cleanly (no `..`, no `/`, no urlencoded sneakiness)."""
    if not _SAFE_KEY.match(key):
        raise HTTPException(status_code=400, detail="invalid key")
    cfg = from_env()
    path = Path(cfg.catalog_dir) / kind / f"{key}.wav"
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"{kind}:{key} not found")
    return path.read_bytes()


@app.get("/catalog/noise/{key}")
def catalog_noise(key: str, _=Depends(require_pi_token)):
    return Response(content=_read_catalog_clip("noise", key), media_type="audio/wav")


@app.get("/catalog/joke/{joke_id}")
def catalog_joke(joke_id: str, _=Depends(require_pi_token)):
    return Response(content=_read_catalog_clip("joke", joke_id), media_type="audio/wav")
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd kokoro-tts && .venv/bin/pytest tests/test_service.py -v
```

Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
git add kokoro-tts/app/service.py kokoro-tts/tests/test_service.py
git commit -m "feat(kokoro-tts): /catalog/{noise,joke}/{key} pre-rendered WAV endpoints"
```

---

## Task 10: `app/render_catalogs.py` — build-time CLI

**Files:**
- Create: `kokoro-tts/app/render_catalogs.py`
- Test: `kokoro-tts/tests/test_render_catalogs.py`

- [ ] **Step 1: Write failing tests**

```python
# kokoro-tts/tests/test_render_catalogs.py
import json
import wave
import io
import numpy as np
from pathlib import Path
from unittest.mock import MagicMock, patch

from app.render_catalogs import render_all


def _fake_synth():
    s = MagicMock()
    # 50ms of silence per call — keep tests fast.
    fake_wav = io.BytesIO()
    with wave.open(fake_wav, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(np.zeros(1200, dtype=np.int16).tobytes())
    s.synthesize.return_value = (fake_wav.getvalue(), 5)
    return s


def test_render_all_writes_one_wav_per_noise(tmp_path):
    noises = {
        "entries": {"fart": "fart.mp3", "burp": "burp.mp3"},
        "synonyms": {},
    }
    jokes = []
    (tmp_path / "noises.json").write_text(json.dumps(noises))
    (tmp_path / "jokes.json").write_text(json.dumps(jokes))
    out = tmp_path / "cache"
    render_all(catalogs_dir=tmp_path, out_dir=out, synth=_fake_synth())
    assert (out / "noise" / "fart.wav").is_file()
    assert (out / "noise" / "burp.wav").is_file()


def test_render_all_writes_one_wav_per_joke(tmp_path):
    noises = {"entries": {}, "synonyms": {}}
    jokes = [
        {"id": "j001", "setup": "Why did the chicken", "punchline": "to get to the other side"},
        {"id": "j002", "setup": "Knock knock", "punchline": "who's there"},
    ]
    (tmp_path / "noises.json").write_text(json.dumps(noises))
    (tmp_path / "jokes.json").write_text(json.dumps(jokes))
    out = tmp_path / "cache"
    render_all(catalogs_dir=tmp_path, out_dir=out, synth=_fake_synth())
    assert (out / "joke" / "j001.wav").is_file()
    assert (out / "joke" / "j002.wav").is_file()


def test_render_all_skips_existing_files(tmp_path):
    noises = {"entries": {"fart": "fart.mp3"}, "synonyms": {}}
    jokes = []
    (tmp_path / "noises.json").write_text(json.dumps(noises))
    (tmp_path / "jokes.json").write_text(json.dumps(jokes))
    out = tmp_path / "cache"
    (out / "noise").mkdir(parents=True)
    (out / "noise" / "fart.wav").write_bytes(b"existing")
    synth = _fake_synth()
    render_all(catalogs_dir=tmp_path, out_dir=out, synth=synth)
    # Synth was not called for the existing file
    assert synth.synthesize.call_count == 0
    # Existing file untouched
    assert (out / "noise" / "fart.wav").read_bytes() == b"existing"
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd kokoro-tts && .venv/bin/pytest tests/test_render_catalogs.py -v
```

Expected: FAIL — `ImportError`.

- [ ] **Step 3: Implement `app/render_catalogs.py`**

```python
"""Build-time catalog pre-renderer. Walks noises.json + jokes.json from
the homecal-voice catalogs dir, synthesizes each entry once, writes WAVs
into <out_dir>/{noise,joke}/<key>.wav. Idempotent — skips files that
already exist so iterating during dev doesn't re-render the whole batch.

For jokes: setup + 1.5s of silence + punchline, all in one WAV. Matches
the live executor's setup → pause → punchline flow today; baking it into
one file means matcher-hit jokes play instantly with no TTS roundtrip."""
import argparse
import json
import sys
import wave
from pathlib import Path
from typing import Iterable

import numpy as np

from app.audio import SAMPLE_RATE
from app.synth import Synth

JOKE_PAUSE_SECONDS = 1.5
DEFAULT_VOICE = "af_bella"


def _read_json(path: Path):
    return json.loads(path.read_text())


def _splice_setup_pause_punchline(setup_wav: bytes, punchline_wav: bytes) -> bytes:
    """Concatenate setup + 1.5s of silence + punchline into a single WAV.
    Re-uses the setup's sample rate/format header — both come from the
    same Synth so they're identical (24kHz/s16/mono)."""
    def _read(buf: bytes):
        with wave.open(__import__("io").BytesIO(buf), "rb") as w:
            return w.getnchannels(), w.getsampwidth(), w.getframerate(), w.readframes(w.getnframes())
    nc, sw, sr, setup_pcm = _read(setup_wav)
    _, _, _, punch_pcm = _read(punchline_wav)
    pause_pcm = np.zeros(int(sr * JOKE_PAUSE_SECONDS), dtype=np.int16).tobytes()
    out = __import__("io").BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(nc)
        w.setsampwidth(sw)
        w.setframerate(sr)
        w.writeframes(setup_pcm + pause_pcm + punch_pcm)
    return out.getvalue()


def render_all(*, catalogs_dir: Path, out_dir: Path, synth: Synth, voice: str = DEFAULT_VOICE) -> None:
    catalogs_dir = Path(catalogs_dir)
    out_dir = Path(out_dir)

    noises = _read_json(catalogs_dir / "noises.json")
    (out_dir / "noise").mkdir(parents=True, exist_ok=True)
    for key in noises.get("entries", {}).keys():
        target = out_dir / "noise" / f"{key}.wav"
        if target.exists():
            continue
        wav, _ = synth.synthesize(key, voice=voice)
        target.write_bytes(wav)

    jokes = _read_json(catalogs_dir / "jokes.json")
    (out_dir / "joke").mkdir(parents=True, exist_ok=True)
    for joke in jokes:
        jid = joke["id"]
        target = out_dir / "joke" / f"{jid}.wav"
        if target.exists():
            continue
        setup_wav, _ = synth.synthesize(joke["setup"], voice=voice)
        punch_wav, _ = synth.synthesize(joke["punchline"], voice=voice)
        target.write_bytes(_splice_setup_pause_punchline(setup_wav, punch_wav))


def _main(argv: Iterable[str]):
    from app.config import from_env
    p = argparse.ArgumentParser()
    p.add_argument("--catalogs-dir", required=True, type=Path)
    p.add_argument("--out-dir", required=True, type=Path)
    args = p.parse_args(list(argv))
    cfg = from_env()
    s = Synth(model_path=cfg.model_path, voices_path=cfg.voices_path)
    render_all(catalogs_dir=args.catalogs_dir, out_dir=args.out_dir, synth=s)


if __name__ == "__main__":
    _main(sys.argv[1:])
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd kokoro-tts && .venv/bin/pytest tests/test_render_catalogs.py -v
```

Expected: PASS (3 tests).

- [ ] **Step 5: Run full sidecar suite**

```bash
cd kokoro-tts && .venv/bin/pytest -q
```

Expected: PASS — all sidecar tests green (~25 tests).

- [ ] **Step 6: Commit**

```bash
git add kokoro-tts/app/render_catalogs.py kokoro-tts/tests/test_render_catalogs.py
git commit -m "feat(kokoro-tts): build-time catalog pre-renderer (noises + jokes)"
```

---

## Task 11: Sidecar Dockerfile + Makefile

**Files:**
- Create: `kokoro-tts/Dockerfile`
- Create: `kokoro-tts/Makefile`

- [ ] **Step 1: Create `kokoro-tts/Makefile`**

```makefile
# Convenience targets for the kokoro-tts sidecar.
# `pull-models` is idempotent — skips files already present.

MODEL_BASE := https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
MODELS_DIR := models

.PHONY: pull-models
pull-models:
	@mkdir -p $(MODELS_DIR)
	@for f in kokoro-v1.0.fp16.onnx voices-v1.0.bin; do \
		if [ -f $(MODELS_DIR)/$$f ]; then \
			echo "$$f already present"; \
		else \
			echo "downloading $$f..."; \
			curl -fsSL -o $(MODELS_DIR)/$$f $(MODEL_BASE)/$$f; \
		fi; \
	done
	@ls -lh $(MODELS_DIR)
```

- [ ] **Step 2: Pull models (one-time, into the repo)**

```bash
cd kokoro-tts && make pull-models
```

Expected: `models/kokoro-v1.0.fp16.onnx` (170 MB) + `models/voices-v1.0.bin` (27 MB). Both are gitignored.

- [ ] **Step 3: Create `kokoro-tts/Dockerfile`**

```dockerfile
# Python 3.13 slim — kokoro-onnx supports 3.10-3.13 per upstream.
# Explicit linux/amd64 — see spec §3 item 3.
FROM --platform=linux/amd64 python:3.13-slim AS base

# espeak-ng is required by kokoro-onnx's phonemizer dependency.
# curl is here so a smoke check can hit /healthz during build if we ever want one.
RUN apt-get update && apt-get install -y --no-install-recommends \
        espeak-ng \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (cached when only app code changes).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy code + models + catalogs (catalogs come from a build context arg).
COPY app/ ./app/
COPY models/ ./models/

# Catalogs live in the parent repo; mount them at build time.
ARG CATALOGS_SRC=catalogs
COPY ${CATALOGS_SRC}/ ./catalogs/

# Build-time pre-render of noise + joke clips. Writes into ./cache/{noise,joke}/.
ENV PI_API_TOKEN=build-time-placeholder \
    KOKORO_MODEL_PATH=/app/models/kokoro-v1.0.fp16.onnx \
    KOKORO_VOICES_PATH=/app/models/voices-v1.0.bin \
    KOKORO_CATALOG_DIR=/app/cache
RUN python -m app.render_catalogs \
        --catalogs-dir /app/catalogs \
        --out-dir /app/cache \
    && ls -R /app/cache

EXPOSE 8789

# uvicorn runs the FastAPI app. Single worker — exactly one Pi, one
# request at a time (spec §3 item 6).
CMD ["uvicorn", "app.service:app", \
     "--host", "0.0.0.0", \
     "--port", "8789", \
     "--workers", "1", \
     "--log-level", "info"]
```

- [ ] **Step 4: Verify the build context — catalogs need to be reachable**

The Dockerfile copies from `${CATALOGS_SRC}/`. The catalogs live under `kiosk/voice/homecal_voice/catalogs/`. We'll pass that via `--build-arg CATALOGS_SRC=...` from docker-compose in the next task. For now verify the local relative path works manually by running a no-cache build (slow — pulls deps + renders catalogs):

```bash
cd kokoro-tts
# Stage the catalogs locally so the COPY can find them
cp -r ../kiosk/voice/homecal_voice/catalogs ./catalogs
docker build --platform linux/amd64 -t kokoro-tts:dev .
rm -rf ./catalogs
```

Expected: clean build, `ls -R /app/cache` shows `noise/{fart,burp,...}.wav` and `joke/{...}.wav`. Build is slow (~5 min — model render is the bulk).

- [ ] **Step 5: Smoke-test the container**

```bash
docker run --rm --platform linux/amd64 \
  -e PI_API_TOKEN=smoke \
  -e KOKORO_MODEL_PATH=/app/models/kokoro-v1.0.fp16.onnx \
  -e KOKORO_VOICES_PATH=/app/models/voices-v1.0.bin \
  -e KOKORO_CATALOG_DIR=/app/cache \
  -p 8789:8789 \
  kokoro-tts:dev &
sleep 8
curl -s http://localhost:8789/healthz
curl -s -X POST http://localhost:8789/tts \
  -H "X-Pi-Token: smoke" -H "Content-Type: application/json" \
  -d '{"text":"hello from the sidecar"}' \
  -o /tmp/smoke.wav \
  -D /tmp/smoke.headers
cat /tmp/smoke.headers
file /tmp/smoke.wav
docker stop $(docker ps -q --filter ancestor=kokoro-tts:dev)
```

Expected: `/healthz` returns `{"ok":true,...}`, `/tmp/smoke.wav` is a valid WAV, `X-Synth-Ms` header present.

- [ ] **Step 6: Commit**

```bash
git add kokoro-tts/Dockerfile kokoro-tts/Makefile
git commit -m "feat(kokoro-tts): Dockerfile + Makefile (pulls models, pre-renders catalogs)"
```

---

## Task 12: `docker-compose.yml` — add `kokoro-tts` service

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Read the current `docker-compose.yml`**

```bash
cat docker-compose.yml
```

Note the existing `homecal` service shape (env, volumes, restart policy, network) so the new service follows the same conventions.

- [ ] **Step 2: Add the `kokoro-tts` service**

Append to the `services:` block:

```yaml
  kokoro-tts:
    build:
      context: ./kokoro-tts
      dockerfile: Dockerfile
      args:
        # Catalogs live under the voice module; copy them in at build time so
        # the render step can find them. Relative to the build context.
        CATALOGS_SRC: catalogs
      additional_contexts:
        # Make the catalogs reachable from the kokoro-tts build context without
        # duplicating files in the repo. Docker BuildKit feature.
        catalogs: ./kiosk/voice/homecal_voice/catalogs
    platform: linux/amd64
    restart: unless-stopped
    mem_limit: 1500m
    ports:
      - "8789:8789"
    environment:
      - PI_API_TOKEN=${PI_API_TOKEN}
      - KOKORO_MODEL_PATH=/app/models/kokoro-v1.0.fp16.onnx
      - KOKORO_VOICES_PATH=/app/models/voices-v1.0.bin
      - KOKORO_CATALOG_DIR=/app/cache
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:8789/healthz || exit 1"]
      interval: 30s
      timeout: 2s
      start_period: 30s
      retries: 3
```

- [ ] **Step 3: Update the Dockerfile to consume the BuildKit context**

The previous Dockerfile assumed `${CATALOGS_SRC}/` was a relative path in the build context. With BuildKit `additional_contexts`, replace the `COPY ${CATALOGS_SRC}/` line with:

Modify `kokoro-tts/Dockerfile`:

```dockerfile
# Catalogs come from the parent repo via BuildKit additional_contexts.
COPY --from=catalogs . ./catalogs/
```

And remove the now-unused `ARG CATALOGS_SRC=catalogs` line and the previous `COPY ${CATALOGS_SRC}/ ./catalogs/` line.

- [ ] **Step 4: Smoke-test compose build**

Ensure `PI_API_TOKEN` is exported (it already exists in the env for the `homecal` service). Then:

```bash
DOCKER_BUILDKIT=1 docker compose build kokoro-tts
docker compose up -d kokoro-tts
sleep 15
curl -s http://localhost:8789/healthz
docker compose logs kokoro-tts | tail -20
```

Expected: healthz returns 200 after a short start_period; logs show "Application startup complete" and the warm-up synth ran without errors.

- [ ] **Step 5: Tear down**

```bash
docker compose stop kokoro-tts
```

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml kokoro-tts/Dockerfile
git commit -m "build(kokoro-tts): add to docker-compose with mem_limit=1500m + healthcheck"
```

---

## Task 13: Backend migration v7 — `tts_provider` + `tts_latency_ms` columns

**Files:**
- Modify: `backend/src/db/migrate.ts`
- Modify: `backend/src/db/migrate.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `backend/src/db/migrate.test.ts`:

```typescript
test('v7 adds tts_provider and tts_latency_ms columns to voice_utterances', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  const cols = db.prepare("SELECT name, type FROM pragma_table_info('voice_utterances')").all() as { name: string; type: string }[];
  const byName = Object.fromEntries(cols.map(c => [c.name, c.type]));
  assert.equal(byName.tts_provider, 'TEXT');
  assert.equal(byName.tts_latency_ms, 'INTEGER');

  // No CHECK constraint on tts_provider — enum is enforced in Zod only.
  db.prepare(`INSERT INTO voice_utterances
    (id, created_at, transcript, status, tts_provider, tts_latency_ms)
    VALUES ('t1', '2026-06-08T00:00:00Z', 'x', 'applied', 'kokoro_lan', 123)`).run();
  const row = db.prepare(`SELECT tts_provider, tts_latency_ms FROM voice_utterances WHERE id='t1'`).get() as { tts_provider: string; tts_latency_ms: number };
  assert.equal(row.tts_provider, 'kokoro_lan');
  assert.equal(row.tts_latency_ms, 123);

  assert.equal(db.pragma('user_version', { simple: true }), 7);
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
npm --workspace backend test -- --test-name-pattern "v7"
```

Expected: FAIL — `user_version` is 6, not 7; or columns missing.

- [ ] **Step 3: Append v7 migration to `backend/src/db/migrate.ts`**

Locate the `MIGRATIONS` array (ends at the existing `];` after v6). Insert before the closing `];`:

```typescript
  // v7 — TTS provenance. Records WHERE the spoken reply came from so a
  // sustained kokoro_lan → openrouter drift in the audit log is visible.
  // tts_latency_ms is end-to-end wall-clock from the Pi's perspective
  // (includes LAN/cloud round-trip), distinct from the sidecar's X-Synth-Ms
  // which is server-side synth only. No CHECK on tts_provider: Zod is the
  // gatekeeper, and a SQLite CHECK forces a table rebuild every time we add
  // a provider.
  (db) => {
    db.exec(`
      ALTER TABLE voice_utterances ADD COLUMN tts_provider TEXT;
      ALTER TABLE voice_utterances ADD COLUMN tts_latency_ms INTEGER;
    `);
  },
```

- [ ] **Step 4: Run test, verify pass**

```bash
npm --workspace backend test -- --test-name-pattern "v7"
```

Expected: PASS.

- [ ] **Step 5: Run full backend test suite (catch regressions)**

```bash
npm --workspace backend test
```

Expected: full suite green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/migrate.ts backend/src/db/migrate.test.ts
git commit -m "feat(db): migration v7 — tts_provider + tts_latency_ms on voice_utterances"
```

---

## Task 14: Backend zod schema + repo extension

**Files:**
- Modify: `backend/src/schemas.ts`
- Modify: `backend/src/repos/voiceUtterances.ts`
- Modify: `backend/src/repos/voiceUtterances.test.ts`

- [ ] **Step 1: Write failing test**

Append to `backend/src/repos/voiceUtterances.test.ts` (or create if it doesn't exist following the pattern of `chores.test.ts`):

```typescript
test('insertUtterance round-trips tts_provider and tts_latency_ms', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  setDb(db);  // existing test helper, follow pattern in other repo tests
  insertUtterance({
    id: 'u1',
    transcript: 'hi',
    intentJson: null,
    confidence: null,
    status: 'applied',
    durationMs: null,
    error: null,
    source: null,
    intentName: null,
    answer: null,
    concern: null,
    ttsProvider: 'kokoro_lan',
    ttsLatencyMs: 234,
  });
  const rows = listUtterances({ limit: 10 });
  assert.equal(rows[0].ttsProvider, 'kokoro_lan');
  assert.equal(rows[0].ttsLatencyMs, 234);
});

test('getLastTtsProvider returns most recent non-null provider', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  setDb(db);
  insertUtterance({ id: 'u1', transcript: 'a', status: 'applied', ttsProvider: 'kokoro_lan' } as any);
  insertUtterance({ id: 'u2', transcript: 'b', status: 'applied', ttsProvider: null } as any);
  insertUtterance({ id: 'u3', transcript: 'c', status: 'applied', ttsProvider: 'openrouter' } as any);
  assert.equal(getLastTtsProvider(), 'openrouter');
});

test('getLastTtsProvider returns null when no rows have a provider', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  setDb(db);
  insertUtterance({ id: 'u1', transcript: 'a', status: 'applied', ttsProvider: null } as any);
  assert.equal(getLastTtsProvider(), null);
});
```

(Imports at top of file: `import { setDb } from '../db/connection'` or the equivalent helper used by the existing repo tests — read `chores.test.ts` to confirm the exact import path. The `getLastTtsProvider` symbol is new.)

- [ ] **Step 2: Run test, verify failure**

```bash
npm --workspace backend test -- --test-name-pattern "tts_provider|getLastTtsProvider"
```

Expected: FAIL — `getLastTtsProvider` undefined; missing schema fields.

- [ ] **Step 3: Extend `voiceAuditBody` in `backend/src/schemas.ts`**

Find the existing `voiceAuditBody` definition (~line 150). Add the two optional fields:

```typescript
export const voiceAuditBody = z.object({
  // ... existing fields stay as-is
  tts_provider: z.enum(['kokoro_lan', 'openrouter', 'clip', 'none']).nullable().optional(),
  tts_latency_ms: z.number().int().min(0).nullable().optional(),
});
```

- [ ] **Step 4: Extend `voiceUtterances` repo**

Modify `backend/src/repos/voiceUtterances.ts`:

```typescript
export type TtsProvider = 'kokoro_lan' | 'openrouter' | 'clip' | 'none';

export interface VoiceUtteranceInsert {
  // ... existing fields
  ttsProvider?: TtsProvider | null;
  ttsLatencyMs?: number | null;
}

export interface VoiceUtterance extends VoiceUtteranceInsert {
  // ... existing
}

export function insertUtterance(u: VoiceUtteranceInsert): void {
  // ... existing prepare with INSERT ... extend column list + value list with:
  //   tts_provider, tts_latency_ms
  //   :tts_provider, :tts_latency_ms
  // Bind:
  //   tts_provider: u.ttsProvider ?? null,
  //   tts_latency_ms: u.ttsLatencyMs ?? null,
}

export function listUtterances(opts: { limit: number }): VoiceUtterance[] {
  // ... existing SELECT — extend the column list with tts_provider, tts_latency_ms
  // ... map row.tts_provider → ttsProvider, row.tts_latency_ms → ttsLatencyMs
}

export function getLastTtsProvider(): TtsProvider | null {
  const row = db().prepare(`
    SELECT tts_provider FROM voice_utterances
    WHERE tts_provider IS NOT NULL
    ORDER BY id DESC LIMIT 1
  `).get() as { tts_provider: TtsProvider } | undefined;
  return row?.tts_provider ?? null;
}
```

(Read the existing repo to mirror its column conventions and DB-handle accessor — every repo in this codebase uses the same `db()` helper.)

- [ ] **Step 5: Wire the new fields through `routes/voice.ts` `/api/voice/audit`**

Find the existing handler at `backend/src/routes/voice.ts:24-40`. Extend the `insertUtterance` call:

```typescript
  app.post('/api/voice/audit', { preHandler: piGuard }, async (req, reply) => {
    const body = parseBody(voiceAuditBody, req.body);
    insertUtterance({
      // ... existing fields
      ttsProvider: body.tts_provider ?? null,
      ttsLatencyMs: body.tts_latency_ms ?? null,
    });
    reply.code(201).send({ ok: true });
  });
```

- [ ] **Step 6: Run test, verify pass**

```bash
npm --workspace backend test
```

Expected: full suite green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/schemas.ts backend/src/repos/voiceUtterances.ts backend/src/repos/voiceUtterances.test.ts backend/src/routes/voice.ts
git commit -m "feat(backend): voiceAuditBody + repo + audit route accept tts_provider/tts_latency_ms"
```

---

## Task 15: Backend `/api/voice/status` — `last_tts_provider`

**Files:**
- Modify: `backend/src/routes/voice.ts`
- Modify: `backend/src/routes/voice.test.ts` (create if missing, follow existing route-test pattern)

- [ ] **Step 1: Write failing test**

Add to `backend/src/routes/voice.test.ts`:

```typescript
test('GET /api/voice/status includes last_tts_provider from most recent utterance', async () => {
  const app = await buildTestApp();   // existing helper or follow the pattern in other route tests
  insertUtterance({ id: 'u1', transcript: 'x', status: 'applied', ttsProvider: 'kokoro_lan' } as any);
  const r = await app.inject({ method: 'GET', url: '/api/voice/status' });
  assert.equal(r.statusCode, 200);
  const body = JSON.parse(r.body);
  assert.equal(body.last_tts_provider, 'kokoro_lan');
});

test('GET /api/voice/status returns last_tts_provider=null when no utterances', async () => {
  const app = await buildTestApp();
  const r = await app.inject({ method: 'GET', url: '/api/voice/status' });
  const body = JSON.parse(r.body);
  assert.equal(body.last_tts_provider, null);
});
```

(Use the same `buildTestApp` pattern that other route tests use — check `backend/src/routes/dinners.test.ts` or similar.)

- [ ] **Step 2: Run test, verify failure**

```bash
npm --workspace backend test -- --test-name-pattern "last_tts_provider"
```

Expected: FAIL — field not in payload.

- [ ] **Step 3: Extend the `/api/voice/status` handler**

Modify `backend/src/routes/voice.ts`:

```typescript
import { getMuteUntil, setMuteUntil } from '../repos/voiceSettings';
import { getLastTtsProvider } from '../repos/voiceUtterances';   // NEW

// ...

  app.get('/api/voice/status', async () => {
    const now = new Date();
    const mu = getMuteUntil();
    return {
      mic_online: voiceState.micOnline(now),
      last_heartbeat_at: voiceState.lastHeartbeatAt(),
      mute_until: mu,
      muted: !!mu && new Date(mu).getTime() > now.getTime(),
      last_tts_provider: getLastTtsProvider(),    // NEW
    };
  });
```

- [ ] **Step 4: Run test, verify pass**

```bash
npm --workspace backend test
```

Expected: full suite green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/voice.ts backend/src/routes/voice.test.ts
git commit -m "feat(backend): /api/voice/status exposes last_tts_provider for the wall dot"
```

---

## Task 16: Pi `config.py` — TTS backend env vars

**Files:**
- Modify: `kiosk/voice/homecal_voice/config.py`
- Modify: `kiosk/voice/homecal_voice/config_test.py`

- [ ] **Step 1: Write failing tests**

Append to `kiosk/voice/homecal_voice/config_test.py`:

```python
def test_tts_backend_defaults_to_cloud(monkeypatch):
    monkeypatch.delenv("TTS_BACKEND", raising=False)
    cfg = load_config()
    assert cfg.tts_backend == "cloud"


def test_tts_backend_reads_env(monkeypatch):
    monkeypatch.setenv("TTS_BACKEND", "lan")
    cfg = load_config()
    assert cfg.tts_backend == "lan"


def test_tts_backend_rejects_invalid_value(monkeypatch):
    monkeypatch.setenv("TTS_BACKEND", "wrong")
    try:
        load_config()
    except ValueError as e:
        assert "TTS_BACKEND" in str(e)
    else:
        raise AssertionError("expected ValueError")


def test_tts_server_url_default_and_override(monkeypatch):
    monkeypatch.delenv("TTS_SERVER_URL", raising=False)
    cfg = load_config()
    assert cfg.tts_server_url == "http://192.168.1.94:8789"
    monkeypatch.setenv("TTS_SERVER_URL", "http://10.0.0.5:8000")
    assert load_config().tts_server_url == "http://10.0.0.5:8000"


def test_tts_server_timeout_default_is_3s(monkeypatch):
    monkeypatch.delenv("TTS_SERVER_TIMEOUT_S", raising=False)
    cfg = load_config()
    assert cfg.tts_server_timeout_s == 3
```

(Existing tests assume `load_config()` works with whatever env is set; follow that style. Set required env vars in the rest of the existing test or use the existing fixture.)

- [ ] **Step 2: Run test, verify failure**

```bash
cd kiosk/voice && .venv/bin/pytest homecal_voice/config_test.py -v
```

Expected: FAIL — fields don't exist.

- [ ] **Step 3: Extend `kiosk/voice/homecal_voice/config.py`**

Add to the `Config` dataclass:

```python
@dataclass(frozen=True)
class Config:
    # ... existing fields
    tts_backend: str                # "lan" | "cloud"
    tts_server_url: str
    tts_server_timeout_s: int
```

And in `load_config()`:

```python
def load_config() -> Config:
    backend = os.environ.get("TTS_BACKEND", "cloud").lower()
    if backend not in ("lan", "cloud"):
        raise ValueError(f"TTS_BACKEND must be 'lan' or 'cloud', got {backend!r}")
    return Config(
        # ... existing fields
        tts_backend=backend,
        tts_server_url=os.environ.get("TTS_SERVER_URL", "http://192.168.1.94:8789").rstrip("/"),
        tts_server_timeout_s=int(os.environ.get("TTS_SERVER_TIMEOUT_S", "3")),
    )
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd kiosk/voice && .venv/bin/pytest homecal_voice/config_test.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add kiosk/voice/homecal_voice/config.py kiosk/voice/homecal_voice/config_test.py
git commit -m "feat(pi-voice): config — TTS_BACKEND, TTS_SERVER_URL, TTS_SERVER_TIMEOUT_S"
```

---

## Task 17: Pi `tts.py` — `synthesize_lan` + `fetch_catalog` helpers

**Files:**
- Modify: `kiosk/voice/homecal_voice/tts.py`
- Modify: `kiosk/voice/homecal_voice/tts_test.py`

- [ ] **Step 1: Write failing tests**

Append to `kiosk/voice/homecal_voice/tts_test.py`:

```python
def test_synthesize_lan_returns_wav_bytes_on_200(requests_mock):
    requests_mock.post(
        "http://test-server:8789/tts",
        content=b"RIFF\x00\x00\x00\x00WAVEdataXYZ",
        headers={"content-type": "audio/wav", "x-synth-ms": "234"},
    )
    from homecal_voice.tts import synthesize_lan
    audio, latency_ms = synthesize_lan(
        "hello", server_url="http://test-server:8789",
        token="t", voice="af_bella", timeout_s=3,
    )
    assert audio.startswith(b"RIFF")
    assert latency_ms == 234


def test_synthesize_lan_raises_on_5xx(requests_mock):
    requests_mock.post("http://test-server:8789/tts", status_code=503)
    from homecal_voice.tts import synthesize_lan
    import requests as _rq
    try:
        synthesize_lan("hi", server_url="http://test-server:8789", token="t",
                       voice="af_bella", timeout_s=3)
    except _rq.exceptions.HTTPError:
        pass
    else:
        raise AssertionError("expected HTTPError")


def test_synthesize_lan_raises_on_timeout(requests_mock):
    import requests as _rq
    requests_mock.post("http://test-server:8789/tts",
                       exc=_rq.exceptions.ReadTimeout("nope"))
    from homecal_voice.tts import synthesize_lan
    try:
        synthesize_lan("hi", server_url="http://test-server:8789", token="t",
                       voice="af_bella", timeout_s=3)
    except _rq.exceptions.ReadTimeout:
        pass
    else:
        raise AssertionError("expected ReadTimeout")


def test_synthesize_lan_sends_token_in_header(requests_mock):
    requests_mock.post(
        "http://test-server:8789/tts",
        content=b"RIFF\x00\x00\x00\x00WAVEdata",
        headers={"x-synth-ms": "10"},
    )
    from homecal_voice.tts import synthesize_lan
    synthesize_lan("hi", server_url="http://test-server:8789", token="abc",
                   voice="af_bella", timeout_s=3)
    assert requests_mock.last_request.headers["X-Pi-Token"] == "abc"


def test_fetch_catalog_returns_bytes_on_200(requests_mock):
    requests_mock.get(
        "http://test-server:8789/catalog/noise/fart",
        content=b"RIFF\x00\x00\x00\x00WAVEdata",
    )
    from homecal_voice.tts import fetch_catalog
    audio = fetch_catalog("noise", "fart",
                          server_url="http://test-server:8789",
                          token="t", timeout_s=3)
    assert audio.startswith(b"RIFF")


def test_fetch_catalog_returns_none_on_404(requests_mock):
    requests_mock.get("http://test-server:8789/catalog/noise/missing",
                      status_code=404)
    from homecal_voice.tts import fetch_catalog
    result = fetch_catalog("noise", "missing",
                           server_url="http://test-server:8789",
                           token="t", timeout_s=3)
    assert result is None


def test_fetch_catalog_raises_on_5xx(requests_mock):
    requests_mock.get("http://test-server:8789/catalog/noise/x",
                      status_code=503)
    from homecal_voice.tts import fetch_catalog
    import requests as _rq
    try:
        fetch_catalog("noise", "x", server_url="http://test-server:8789",
                      token="t", timeout_s=3)
    except _rq.exceptions.HTTPError:
        pass
    else:
        raise AssertionError("expected HTTPError")
```

- [ ] **Step 2: Run tests, verify failure**

```bash
cd kiosk/voice && .venv/bin/pytest homecal_voice/tts_test.py -v -k "synthesize_lan or fetch_catalog"
```

Expected: FAIL — symbols missing.

- [ ] **Step 3: Add helpers to `kiosk/voice/homecal_voice/tts.py`**

```python
def synthesize_lan(
    text: str,
    *,
    server_url: str,
    token: str,
    voice: str,
    timeout_s: int,
) -> tuple[bytes, int]:
    """POST /tts to the LAN sidecar; return (WAV bytes, sidecar synth ms).

    Raises on any non-2xx, on timeout, or on connection error — caller
    handles the fallback ladder. Does NOT retry; that's the cloud path's job."""
    r = requests.post(
        f"{server_url.rstrip('/')}/tts",
        headers={"X-Pi-Token": token, "Content-Type": "application/json"},
        json={"text": text, "voice": voice},
        timeout=timeout_s,
    )
    r.raise_for_status()
    latency = int(r.headers.get("X-Synth-Ms") or 0)
    return r.content, latency


def fetch_catalog(
    kind: str,
    key: str,
    *,
    server_url: str,
    token: str,
    timeout_s: int,
) -> bytes | None:
    """GET /catalog/{kind}/{key}. Returns bytes on 200, None on 404
    (catalog miss — caller falls through to whatever the matcher was
    going to do anyway). Raises on other errors."""
    r = requests.get(
        f"{server_url.rstrip('/')}/catalog/{kind}/{key}",
        headers={"X-Pi-Token": token},
        timeout=timeout_s,
    )
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.content
```

- [ ] **Step 4: Run tests, verify pass**

```bash
cd kiosk/voice && .venv/bin/pytest homecal_voice/tts_test.py -v
```

Expected: PASS (all tts_test tests).

- [ ] **Step 5: Commit**

```bash
git add kiosk/voice/homecal_voice/tts.py kiosk/voice/homecal_voice/tts_test.py
git commit -m "feat(pi-voice): tts.synthesize_lan + tts.fetch_catalog helpers"
```

---

## Task 18: Pi `tts.py` — player priority swap (prefer WAV-capable players)

**Files:**
- Modify: `kiosk/voice/homecal_voice/tts.py`
- Modify: `kiosk/voice/homecal_voice/tts_test.py`

- [ ] **Step 1: Write failing test**

Append:

```python
def test_detect_player_prefers_ffplay_over_mpg123_when_both_present():
    """WAV from the LAN sidecar plays natively in ffplay/paplay; mpg123 is
    MP3-only. With local TTS, prefer the WAV-capable players first."""
    with patch("homecal_voice.tts.shutil.which") as which:
        which.side_effect = lambda b: f"/usr/bin/{b}" if b in ("ffplay", "mpg123") else None
        cmd = _detect_player()
        assert cmd is not None and cmd[0] == "ffplay"


def test_detect_player_falls_back_to_mpg123_when_only_one_available():
    """If only mpg123 is installed, we still use it (cloud MP3 path)."""
    with patch("homecal_voice.tts.shutil.which") as which:
        which.side_effect = lambda b: "/usr/bin/mpg123" if b == "mpg123" else None
        cmd = _detect_player()
        assert cmd is not None and cmd[0] == "mpg123"
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd kiosk/voice && .venv/bin/pytest homecal_voice/tts_test.py -v -k detect_player
```

Expected: FAIL on the new ffplay-preferred test (current order picks mpg123 first).

- [ ] **Step 3: Reorder `_detect_player` in `tts.py`**

Find the existing `_detect_player` candidates tuple. Replace with:

```python
def _detect_player() -> list[str] | None:
    """Pick the first available CLI player.

    Order with the LAN sidecar in mind: ffplay + paplay + pw-play all handle
    WAV natively (which is what the sidecar returns). mpg123 only handles
    MP3 (the cloud fallback path's format) so it sits last. aplay is
    intentionally absent — WAV-only and silently fails on MP3."""
    candidates: tuple[tuple[str, list[str]], ...] = (
        ("ffplay", ["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet"]),
        ("paplay", ["paplay"]),
        ("pw-play", ["pw-play"]),
        ("mpg123", ["mpg123", "-q"]),
    )
    for binary, cmd in candidates:
        if shutil.which(binary):
            return cmd
    return None
```

- [ ] **Step 4: Run tests, verify pass**

```bash
cd kiosk/voice && .venv/bin/pytest homecal_voice/tts_test.py -v
```

Expected: PASS (all tts tests including pre-existing `test_speak_uses_detected_player_not_aplay` may need updating — read it, and if its `shutil.which` mock only returns mpg123, it still passes since mpg123 is in the list).

- [ ] **Step 5: Commit**

```bash
git add kiosk/voice/homecal_voice/tts.py kiosk/voice/homecal_voice/tts_test.py
git commit -m "fix(pi-voice): prefer WAV-capable players (ffplay/paplay) over mpg123"
```

---

## Task 19: Pi `server_state.py` — `post_audit` accepts TTS fields

**Files:**
- Modify: `kiosk/voice/homecal_voice/server_state.py`
- Modify: `kiosk/voice/homecal_voice/server_state_test.py`

- [ ] **Step 1: Write failing test**

Append to `kiosk/voice/homecal_voice/server_state_test.py`:

```python
def test_post_audit_sends_tts_provider_and_latency(requests_mock):
    requests_mock.post("http://api/api/voice/audit", json={"ok": True})
    from homecal_voice.server_state import post_audit
    post_audit(
        base="http://api", token="t", id="u1",
        transcript="hello", status="applied",
        intent_json=None, confidence=None, duration_ms=None,
        error=None, source=None, intent_name=None,
        answer=None, concern=None,
        tts_provider="kokoro_lan", tts_latency_ms=234,
    )
    body = requests_mock.last_request.json()
    assert body["tts_provider"] == "kokoro_lan"
    assert body["tts_latency_ms"] == 234


def test_post_audit_omits_tts_fields_when_unset(requests_mock):
    requests_mock.post("http://api/api/voice/audit", json={"ok": True})
    from homecal_voice.server_state import post_audit
    post_audit(
        base="http://api", token="t", id="u1",
        transcript="hello", status="applied",
        intent_json=None, confidence=None, duration_ms=None,
        error=None, source=None, intent_name=None,
        answer=None, concern=None,
    )
    body = requests_mock.last_request.json()
    # Either absent or explicit null — both are valid per voiceAuditBody
    assert body.get("tts_provider") in (None,)
    assert body.get("tts_latency_ms") in (None,)
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd kiosk/voice && .venv/bin/pytest homecal_voice/server_state_test.py -v -k tts
```

Expected: FAIL — `post_audit` doesn't accept the kwargs.

- [ ] **Step 3: Extend `post_audit` in `kiosk/voice/homecal_voice/server_state.py`**

Add the two optional kwargs to the signature and the body payload. Mirror how `answer`/`concern` are handled today (probably `None`-suppressed). Read the existing function and follow its pattern.

- [ ] **Step 4: Run test, verify pass**

```bash
cd kiosk/voice && .venv/bin/pytest homecal_voice/server_state_test.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add kiosk/voice/homecal_voice/server_state.py kiosk/voice/homecal_voice/server_state_test.py
git commit -m "feat(pi-voice): post_audit accepts tts_provider + tts_latency_ms"
```

---

## Task 20: Pi `main.py` — `_lan_state` health cache + `_under_tts_cap`

**Files:**
- Modify: `kiosk/voice/homecal_voice/main.py`
- Modify: `kiosk/voice/homecal_voice/main_test.py`

- [ ] **Step 1: Write failing tests**

Append to `kiosk/voice/homecal_voice/main_test.py`:

```python
def test_lan_state_starts_reachable_with_stale_cache():
    """Cold start: cache is stale → next call treats sidecar as reachable
    until proven otherwise."""
    from homecal_voice.main import _lan_state, mark_lan_attempt, lan_reachable
    _lan_state["checked_at"] = 0.0
    _lan_state["reachable"] = False  # previous run was bad
    # Cold cache: even with stored False, an expired TTL means try-again
    assert lan_reachable() is True


def test_lan_state_stays_unreachable_for_ttl_after_failure(monkeypatch):
    from homecal_voice.main import _lan_state, mark_lan_attempt, lan_reachable
    import homecal_voice.main as main_mod
    fake_now = [1000.0]
    monkeypatch.setattr(main_mod.time, "time", lambda: fake_now[0])
    mark_lan_attempt(success=False)
    assert lan_reachable() is False
    # Within 30s TTL — still unreachable, no probe
    fake_now[0] += 20
    assert lan_reachable() is False
    # After 30s — try again
    fake_now[0] += 15
    assert lan_reachable() is True


def test_under_tts_cap_resets_per_day(monkeypatch):
    from homecal_voice.main import _under_tts_cap, _tts_cap_state
    _tts_cap_state.update(day="", count=0)
    # Today's date
    import homecal_voice.main as main_mod
    monkeypatch.setattr(main_mod, "today_brisbane", lambda: "2026-06-08")

    class FakeCfg:
        daily_request_cap = 3

    for _ in range(3):
        assert _under_tts_cap(FakeCfg()) is True
    assert _under_tts_cap(FakeCfg()) is False  # 4th call over cap

    # Day rolls over → counter resets
    monkeypatch.setattr(main_mod, "today_brisbane", lambda: "2026-06-09")
    assert _under_tts_cap(FakeCfg()) is True
```

- [ ] **Step 2: Run tests, verify failure**

```bash
cd kiosk/voice && .venv/bin/pytest homecal_voice/main_test.py -v -k "lan_state or tts_cap"
```

Expected: FAIL — symbols missing.

- [ ] **Step 3: Add helpers near the top of `main.py`** (after the existing `_mute_state`)

```python
# LAN sidecar reachability cache. Mirrors is_muted_locally — the first /tts
# call after the TTL acts as the probe; failures mark the sidecar down for
# the next LAN_HEALTH_TTL_SEC seconds so subsequent utterances jump straight
# to cloud without paying the timeout each time.
LAN_HEALTH_TTL_SEC = 30
_lan_state = {"reachable": True, "checked_at": 0.0}


def lan_reachable() -> bool:
    """True if we should try the LAN sidecar this turn. Cache-fresh + last
    attempt failed → False (skip LAN). Cache-stale → True (try again)."""
    now = time.time()
    if now - _lan_state["checked_at"] > LAN_HEALTH_TTL_SEC:
        return True
    return bool(_lan_state["reachable"])


def mark_lan_attempt(success: bool) -> None:
    """Record the outcome of a /tts attempt for the health cache."""
    _lan_state["reachable"] = success
    _lan_state["checked_at"] = time.time()


# Cloud-TTS-fallback daily cap. Mirrors _under_cap for the main request flow,
# but tracks TTS-specific calls so a broken sidecar can't quietly burn cloud
# budget. Resets at Brisbane midnight (today_brisbane rolls over).
_tts_cap_state = {"day": "", "count": 0}


def _under_tts_cap(cfg) -> bool:
    today = today_brisbane()
    if _tts_cap_state["day"] != today:
        _tts_cap_state.update(day=today, count=0)
    _tts_cap_state["count"] += 1
    return _tts_cap_state["count"] <= cfg.daily_request_cap
```

- [ ] **Step 4: Run tests, verify pass**

```bash
cd kiosk/voice && .venv/bin/pytest homecal_voice/main_test.py -v -k "lan_state or tts_cap"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add kiosk/voice/homecal_voice/main.py kiosk/voice/homecal_voice/main_test.py
git commit -m "feat(pi-voice): _lan_state 30s health cache + _under_tts_cap daily limiter"
```

---

## Task 21: Pi `main.py` — `_speak()` fallback ladder

**Files:**
- Modify: `kiosk/voice/homecal_voice/main.py`
- Modify: `kiosk/voice/homecal_voice/main_test.py`

- [ ] **Step 1: Write failing tests**

Append to `main_test.py`. These extend `_make_deps` to include LAN dispatch — read the existing helper first to see what to inject:

```python
def test_speak_lan_happy_path(monkeypatch):
    """LAN reachable + sidecar returns audio → played, audit tagged kokoro_lan."""
    from homecal_voice.main import run_once, _lan_state
    intent = IntentResult("dinner_set", {"date": "2026-06-04", "meal": "tacos"}, 0.95, "raw")
    speak_lan = MagicMock(return_value=(b"RIFFfake", 234))   # (audio, latency_ms)
    speak_cloud = MagicMock()
    play_bytes = MagicMock()
    deps, _state, audit = _make_deps(
        extract_intent=MagicMock(return_value=intent),
        execute=MagicMock(return_value={"ok": True, "spoken": "Saved tacos for today."}),
        speak_lan=speak_lan, speak_cloud=speak_cloud, play_bytes=play_bytes,
    )
    _lan_state["reachable"] = True
    _lan_state["checked_at"] = 9e9    # cache fresh
    run_once(deps)
    speak_lan.assert_called_once()
    speak_cloud.assert_not_called()
    assert audit.call_args.kwargs["tts_provider"] == "kokoro_lan"
    assert audit.call_args.kwargs["tts_latency_ms"] >= 0


def test_speak_falls_back_to_cloud_when_lan_fails(monkeypatch):
    import requests as _rq
    intent = IntentResult("dinner_set", {"date": "2026-06-04", "meal": "tacos"}, 0.95, "raw")
    speak_lan = MagicMock(side_effect=_rq.exceptions.ConnectionError("nope"))
    speak_cloud = MagicMock(return_value=True)   # cloud speak() returns bool today
    deps, _state, audit = _make_deps(
        extract_intent=MagicMock(return_value=intent),
        execute=MagicMock(return_value={"ok": True, "spoken": "Saved."}),
        speak_lan=speak_lan, speak_cloud=speak_cloud,
    )
    from homecal_voice.main import _lan_state, _tts_cap_state
    _lan_state["checked_at"] = 0   # cold cache → tries LAN, fails, falls to cloud
    _tts_cap_state.update(day="", count=0)
    run_once(deps)
    speak_lan.assert_called_once()
    speak_cloud.assert_called_once()
    assert audit.call_args.kwargs["tts_provider"] == "openrouter"


def test_speak_falls_back_to_clip_when_lan_and_cloud_both_fail(monkeypatch):
    import requests as _rq
    intent = IntentResult("dinner_set", {"date": "2026-06-04", "meal": "tacos"}, 0.95, "raw")
    speak_lan = MagicMock(side_effect=_rq.exceptions.ConnectionError("nope"))
    speak_cloud = MagicMock(return_value=False)   # cloud failed too
    deps, _state, audit = _make_deps(
        extract_intent=MagicMock(return_value=intent),
        execute=MagicMock(return_value={"ok": True, "spoken": "Saved."}),
        speak_lan=speak_lan, speak_cloud=speak_cloud,
    )
    from homecal_voice.main import _lan_state, _tts_cap_state
    _lan_state["checked_at"] = 0
    _tts_cap_state.update(day="", count=0)
    run_once(deps)
    deps.play_clip.assert_called_once()  # didnt_catch.mp3
    assert audit.call_args.kwargs["tts_provider"] == "clip"


def test_speak_skips_cloud_when_tts_cap_hit(monkeypatch):
    import requests as _rq
    intent = IntentResult("dinner_set", {"date": "2026-06-04", "meal": "tacos"}, 0.95, "raw")
    speak_lan = MagicMock(side_effect=_rq.exceptions.ConnectionError("nope"))
    speak_cloud = MagicMock()
    deps, _state, audit = _make_deps(
        extract_intent=MagicMock(return_value=intent),
        execute=MagicMock(return_value={"ok": True, "spoken": "Saved."}),
        speak_lan=speak_lan, speak_cloud=speak_cloud,
    )
    from homecal_voice.main import _lan_state, _tts_cap_state
    import homecal_voice.main as main_mod
    monkeypatch.setattr(main_mod, "today_brisbane", lambda: "2026-06-08")
    _lan_state["checked_at"] = 0
    # Exhaust cap before this call
    _tts_cap_state.update(day="2026-06-08", count=999_999)
    run_once(deps)
    speak_cloud.assert_not_called()
    deps.play_clip.assert_called_once()
    assert audit.call_args.kwargs["tts_provider"] == "clip"
```

(You will need to extend `_make_deps` to accept `speak_lan`, `speak_cloud`, `play_bytes` and wire them onto `OneShotDeps`. Read the existing helper + dataclass first.)

- [ ] **Step 2: Extend `OneShotDeps` in `main.py`** so `_speak` can be tested in isolation

```python
@dataclass
class OneShotDeps:
    # ... existing fields
    speak_lan: Callable          # (text, voice, server_url, token, timeout_s) -> (bytes, int) | raises
    speak_cloud: Callable        # existing speak path, now renamed for clarity
    play_bytes: Callable         # (audio: bytes, format: 'wav'|'mp3') -> None
```

(Keep the existing `speak` field for backward compatibility; alias it to `speak_cloud` in the production wiring inside `main()`.)

- [ ] **Step 3: Rewrite `_speak` in `_run_after_wake`** to implement the ladder

Replace the existing `_speak` closure with:

```python
    def _speak(text: str) -> None:
        if not text or not text.strip():
            return

        d.mic_off()
        provider: str | None = None
        latency_ms: int | None = None
        played = False
        cfg = load_cfg()    # or thread cfg through deps; see below

        try:
            # 1. LAN sidecar (preferred)
            if lan_reachable():
                try:
                    t0 = time.time()
                    audio, _synth_ms = d.speak_lan(
                        text=text,
                        voice=cfg.tts_voice,
                        server_url=cfg.tts_server_url,
                        token=cfg.pi_api_token,
                        timeout_s=cfg.tts_server_timeout_s,
                    )
                    d.play_bytes(audio, format="wav")
                    latency_ms = int((time.time() - t0) * 1000)
                    provider = "kokoro_lan"
                    mark_lan_attempt(success=True)
                    played = True
                except (requests.RequestException, requests.HTTPError) as e:
                    log.warning("LAN TTS failed (%s); falling back to cloud", e)
                    mark_lan_attempt(success=False)

            # 2. Cloud fallback (existing speak path), capped per day
            if not played and _under_tts_cap(cfg):
                ok = d.speak_cloud(text)
                if ok:
                    provider = "openrouter"
                    played = True

            # 3. Clip fallback
            if not played:
                from homecal_voice.tts import CLIP_DIDNT_CATCH
                d.play_clip(CLIP_DIDNT_CATCH)
                provider = "clip"
                log.warning("TTS produced no audio — fell to didnt_catch for: %r", text[:120])

            time.sleep(2.0)
        finally:
            d.mic_on()

        # Stash provider/latency for the upstream _audit() call
        d._last_tts = {"provider": provider, "latency_ms": latency_ms}
```

Then extend the existing `_audit()` calls to pass `tts_provider=d._last_tts.get("provider")` and `tts_latency_ms=d._last_tts.get("latency_ms")` for any `_audit` call that follows a `_speak`.

- [ ] **Step 4: Wire production `main()` dispatch**

In `main()`, when constructing `OneShotDeps`, set:

```python
            speak_lan=lambda **kwargs: tts.synthesize_lan(kwargs.pop("text"), **kwargs),
            speak_cloud=lambda text: tts_speak(
                text, model=cfg.tts_model, voice=cfg.tts_voice,
                api_key=cfg.openrouter_api_key, muted=is_muted_locally(cfg),
            ),
            play_bytes=lambda audio, format: _play_audio_bytes(audio, format),
            # Keep existing `speak=` for back-compat if any other test relies on it
            speak=lambda text: tts_speak(...),
```

Add a small helper `_play_audio_bytes(audio: bytes, format: str)` near `tts_play_file` that writes the bytes to a tempfile and runs the detected player on it. This is essentially the existing `tts.speak()` post-synth playback path, factored out.

- [ ] **Step 5: Run tests, verify pass**

```bash
cd kiosk/voice && .venv/bin/pytest homecal_voice/main_test.py -v
```

Expected: PASS — all main_test green including new ladder tests AND the pre-existing TTS-failure tests from commit f9b6790 (those continue to work because `speak_cloud` returning False still triggers the clip fallback).

- [ ] **Step 6: Commit**

```bash
git add kiosk/voice/homecal_voice/main.py kiosk/voice/homecal_voice/main_test.py
git commit -m "feat(pi-voice): _speak() ladder — lan → cloud (capped) → clip → silent"
```

---

## Task 22: Pi `executor.py` — `_noise_play` uses catalog endpoint

**Files:**
- Modify: `kiosk/voice/homecal_voice/executor.py`
- Modify: `kiosk/voice/homecal_voice/executor_test.py`

- [ ] **Step 1: Write failing test**

Append to `kiosk/voice/homecal_voice/executor_test.py`:

```python
def test_noise_play_uses_catalog_fetch_when_provided(monkeypatch):
    """When fetch_catalog returns bytes, _noise_play plays those bytes and
    returns spoken="" (no TTS dance for matcher hits)."""
    from homecal_voice.executor import Executor
    from homecal_voice.intent import IntentResult

    play_bytes = MagicMock()
    fetch_catalog = MagicMock(return_value=b"RIFFfake")

    ex = Executor(
        base="http://api", token="t",
        play_clip=MagicMock(), speak=MagicMock(),
        play_bytes=play_bytes, fetch_catalog=fetch_catalog,
    )
    out = ex.apply(IntentResult("noise_play", {"catalog_key": "fart"}, 1.0, "raw"))
    assert out["ok"] is True
    assert out["spoken"] == ""
    fetch_catalog.assert_called_once_with("noise", "fart")
    play_bytes.assert_called_once_with(b"RIFFfake", format="wav")


def test_noise_play_falls_through_to_old_path_on_catalog_miss():
    """If fetch_catalog returns None (404), fall through to today's
    play_clip-from-disk behaviour."""
    from homecal_voice.executor import Executor
    from homecal_voice.intent import IntentResult

    play_clip = MagicMock()
    fetch_catalog = MagicMock(return_value=None)
    ex = Executor(
        base="http://api", token="t",
        play_clip=play_clip, speak=MagicMock(),
        play_bytes=MagicMock(), fetch_catalog=fetch_catalog,
    )
    out = ex.apply(IntentResult("noise_play", {"catalog_key": "fart"}, 1.0, "raw"))
    # On a miss, today's behaviour: load the clip file from disk + play_clip it.
    play_clip.assert_called_once()
    assert out["ok"] is True
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd kiosk/voice && .venv/bin/pytest homecal_voice/executor_test.py -v -k noise_play
```

Expected: FAIL — `Executor.__init__` doesn't accept `play_bytes` / `fetch_catalog`.

- [ ] **Step 3: Extend `Executor.__init__`** and `_noise_play` in `executor.py`

```python
class Executor:
    def __init__(
        self,
        *,
        base: str,
        token: str,
        play_clip: Optional[Callable[[str], None]] = None,
        speak: Optional[Callable[[str], None]] = None,
        sleep: Optional[Callable[[float], None]] = None,
        # New:
        play_bytes: Optional[Callable[[bytes, str], None]] = None,
        fetch_catalog: Optional[Callable[[str, str], bytes | None]] = None,
    ):
        # ... existing assignments
        self._play_bytes = play_bytes
        self._fetch_catalog = fetch_catalog
        # ... handlers unchanged
```

Modify `_noise_play`:

```python
    def _noise_play(self, f: dict) -> dict:
        # ... existing key resolution
        key = f.get("catalog_key") or f.get("play_catalog")
        if not key:
            return {"ok": False, "spoken": "", "error": "noise_play_missing_key"}

        # 1. New path: pull pre-rendered WAV from sidecar
        if self._fetch_catalog and self._play_bytes:
            try:
                audio = self._fetch_catalog("noise", key)
            except Exception as e:
                log.warning("catalog fetch failed (%s); falling back to clip path", e)
                audio = None
            if audio is not None:
                # Quiet-hours gate still applies — wrap the same way as today.
                if self._play_clip is not None and not _quiet_safe_check():
                    return {"ok": False, "spoken": "", "error": "quiet_hours_suppressed",
                            "quiet_suppressed": True}
                try:
                    self._play_bytes(audio, "wav")
                except Exception as e:
                    return {"ok": False, "spoken": "", "error": f"clip_play:{e}"}
                return {"ok": True, "spoken": ""}

        # 2. Existing fallback path (clip file on disk via play_clip)
        # ... existing logic from main current _noise_play body
```

(Note: the quiet-hours check is currently done via `_quiet_safe_play_clip` in `main.py`. Pull it into a shared helper or pass it in via deps — read the existing code and pick whichever is closest to current convention.)

- [ ] **Step 4: Wire production `Executor` in `main()`**

In `main()`'s `Executor(...)` call, add:

```python
        play_bytes=lambda audio, fmt: _play_audio_bytes(audio, fmt),
        fetch_catalog=lambda kind, key: tts.fetch_catalog(
            kind, key,
            server_url=cfg.tts_server_url,
            token=cfg.pi_api_token,
            timeout_s=cfg.tts_server_timeout_s,
        ),
```

- [ ] **Step 5: Run tests, verify pass**

```bash
cd kiosk/voice && .venv/bin/pytest homecal_voice/executor_test.py -v
```

Expected: PASS — both new tests plus all existing executor tests.

- [ ] **Step 6: Commit**

```bash
git add kiosk/voice/homecal_voice/executor.py kiosk/voice/homecal_voice/executor_test.py kiosk/voice/homecal_voice/main.py
git commit -m "feat(pi-voice): _noise_play hits sidecar catalog endpoint (falls back to clip on miss)"
```

---

## Task 23: Pi `executor.py` — `_joke_tell` uses catalog endpoint

**Files:**
- Modify: `kiosk/voice/homecal_voice/executor.py`
- Modify: `kiosk/voice/homecal_voice/executor_test.py`

- [ ] **Step 1: Write failing tests**

Append:

```python
def test_joke_tell_uses_catalog_fetch_when_provided():
    from homecal_voice.executor import Executor
    from homecal_voice.intent import IntentResult

    play_bytes = MagicMock()
    fetch_catalog = MagicMock(return_value=b"RIFFjokeaudio")

    ex = Executor(
        base="http://api", token="t",
        play_clip=MagicMock(), speak=MagicMock(), sleep=MagicMock(),
        play_bytes=play_bytes, fetch_catalog=fetch_catalog,
    )
    out = ex.apply(IntentResult(
        "joke_tell",
        {"joke_id": "j001", "setup": "Why X?", "punchline": "Because Y"},
        1.0, "raw",
    ))
    assert out["ok"] is True
    assert out.get("spoken_inline") is True
    fetch_catalog.assert_called_once_with("joke", "j001")
    play_bytes.assert_called_once_with(b"RIFFjokeaudio", format="wav")


def test_joke_tell_falls_through_to_tts_setup_pause_punchline_on_miss():
    """If fetch_catalog returns None (joke not pre-rendered), fall back to
    today's setup → 1.5s pause → punchline via TTS."""
    from homecal_voice.executor import Executor
    from homecal_voice.intent import IntentResult

    speak = MagicMock()
    sleep = MagicMock()
    fetch_catalog = MagicMock(return_value=None)
    ex = Executor(
        base="http://api", token="t",
        play_clip=MagicMock(), speak=speak, sleep=sleep,
        play_bytes=MagicMock(), fetch_catalog=fetch_catalog,
    )
    out = ex.apply(IntentResult(
        "joke_tell",
        {"joke_id": "j999", "setup": "Knock knock", "punchline": "Who's there"},
        1.0, "raw",
    ))
    assert out["ok"] is True
    speak.assert_any_call("Knock knock")
    sleep.assert_called_once_with(1.5)
    speak.assert_any_call("Who's there")
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd kiosk/voice && .venv/bin/pytest homecal_voice/executor_test.py -v -k joke
```

Expected: FAIL — `joke_id` not honoured / no catalog branch.

- [ ] **Step 3: Modify `_joke_tell` in `executor.py`**

Prepend the catalog-fetch branch to the existing method:

```python
    def _joke_tell(self, f: dict) -> dict:
        joke_id = f.get("joke_id")
        if joke_id and self._fetch_catalog and self._play_bytes:
            try:
                audio = self._fetch_catalog("joke", joke_id)
            except Exception as e:
                log.warning("joke catalog fetch failed (%s); falling back to TTS", e)
                audio = None
            if audio is not None:
                try:
                    self._play_bytes(audio, "wav")
                except Exception as e:
                    return {"ok": False, "spoken": "", "error": f"joke_play:{e}",
                            "spoken_inline": True}
                return {"ok": True, "spoken_inline": True,
                        "spoken": f"{f.get('setup','')} ... {f.get('punchline','')}"}

        # ... existing setup → sleep(1.5) → punchline body
```

- [ ] **Step 4: Run tests, verify pass**

```bash
cd kiosk/voice && .venv/bin/pytest homecal_voice/executor_test.py -v
```

Expected: PASS — both new tests plus existing.

- [ ] **Step 5: Verify `patterns_kid._extract_joke` already emits `joke_id`**

```bash
grep -n "joke_id" kiosk/voice/homecal_voice/patterns_kid.py
```

Expected: it does (see existing code at `patterns_kid.py:67`).

- [ ] **Step 6: Commit**

```bash
git add kiosk/voice/homecal_voice/executor.py kiosk/voice/homecal_voice/executor_test.py
git commit -m "feat(pi-voice): _joke_tell hits sidecar joke catalog (instant playback)"
```

---

## Task 24: Frontend — extend `VoiceStatus` type + API client

**Files:**
- Modify: `frontend/src/core/model/types.ts`
- Modify: `frontend/src/core/api/client.ts`

- [ ] **Step 1: Read current `VoiceStatus` shape**

```bash
grep -nA 8 "VoiceStatus" frontend/src/core/model/types.ts
```

- [ ] **Step 2: Add `last_tts_provider` field**

Modify `frontend/src/core/model/types.ts`:

```typescript
export type TtsProvider = 'kokoro_lan' | 'openrouter' | 'clip' | 'none';

export interface VoiceStatus {
  // ... existing fields
  last_tts_provider: TtsProvider | null;
}
```

- [ ] **Step 3: No client.ts change needed if it already returns `VoiceStatus`**

Verify:

```bash
grep -nA 4 "voice/status" frontend/src/core/api/client.ts
```

If the return type is `VoiceStatus`, no change is required. If untyped, narrow it now to `VoiceStatus`.

- [ ] **Step 4: Run frontend type-check + tests**

```bash
npm --workspace frontend run build
npm --workspace frontend test
```

Expected: PASS (no test changes yet — Task 25 adds the dot test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/core/model/types.ts frontend/src/core/api/client.ts
git commit -m "feat(frontend): VoiceStatus.last_tts_provider + TtsProvider type"
```

---

## Task 25: Frontend — ambient dot on `VoiceChip`

**Files:**
- Modify: `frontend/src/components/controls/VoiceChip.tsx`
- Modify: `frontend/src/components/controls/VoiceChip.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `frontend/src/components/controls/VoiceChip.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ttsDotColor } from './VoiceChip';

describe('ttsDotColor', () => {
  it('green when mic online and last_tts_provider is local', () => {
    expect(ttsDotColor({ mic_online: true, muted: false, last_tts_provider: 'kokoro_lan' } as any))
      .toBe('var(--c-ok)');
  });

  it('green when mic online and last_tts_provider is cloud (still working)', () => {
    expect(ttsDotColor({ mic_online: true, muted: false, last_tts_provider: 'openrouter' } as any))
      .toBe('var(--c-ok)');
  });

  it('amber when last_tts_provider is clip (degraded)', () => {
    expect(ttsDotColor({ mic_online: true, muted: false, last_tts_provider: 'clip' } as any))
      .toBe('var(--c-warn)');
  });

  it('amber when last_tts_provider is none (degraded)', () => {
    expect(ttsDotColor({ mic_online: true, muted: false, last_tts_provider: 'none' } as any))
      .toBe('var(--c-warn)');
  });

  it('grey when muted', () => {
    expect(ttsDotColor({ mic_online: true, muted: true, last_tts_provider: 'kokoro_lan' } as any))
      .toBe('var(--c-muted)');
  });

  it('grey when mic offline', () => {
    expect(ttsDotColor({ mic_online: false, muted: false, last_tts_provider: 'kokoro_lan' } as any))
      .toBe('var(--c-muted)');
  });

  it('green when no history yet (last_tts_provider null) and mic online', () => {
    // Optimistic — no failures recorded means assume things are fine.
    expect(ttsDotColor({ mic_online: true, muted: false, last_tts_provider: null } as any))
      .toBe('var(--c-ok)');
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
npm --workspace frontend test -- VoiceChip
```

Expected: FAIL — `ttsDotColor` not exported.

- [ ] **Step 3: Add the function + dot to `VoiceChip.tsx`**

```tsx
import type { VoiceStatus } from '../../core/model/types';

export function ttsDotColor(status: Pick<VoiceStatus, 'mic_online' | 'muted' | 'last_tts_provider'>): string {
  if (!status.mic_online || status.muted) return 'var(--c-muted)';
  if (status.last_tts_provider === 'clip' || status.last_tts_provider === 'none') {
    return 'var(--c-warn)';
  }
  return 'var(--c-ok)';
}
```

In the `VoiceChip` component JSX, render the dot. Place it as an absolutely-positioned 6 px circle at the top-right of the chip. Only render when `?mode=wall` — phone editor doesn't show it (too small to be useful there):

```tsx
const dot = isWall && status ? (
  <span
    style={{
      position: 'absolute',
      top: 4,
      right: 4,
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: ttsDotColor(status),
    }}
    aria-hidden="true"
  />
) : null;

// Inside the chip's outer container:
return (
  <div style={{ position: 'relative', /* ... existing styles */ }}>
    {/* existing chip body */}
    {dot}
  </div>
);
```

(Read the existing `VoiceChip.tsx` first to find the right place — `isWall` detection might already exist, or you can read `window.location.search` for `mode=wall` via a small helper.)

- [ ] **Step 4: Run tests, verify pass**

```bash
npm --workspace frontend test
```

Expected: PASS — including all existing VoiceChip tests.

- [ ] **Step 5: Manual visual check (optional, recommended)**

```bash
npm --workspace frontend run dev   # http://localhost:5173/?mode=wall
```

Eyeball the chip in the bottom-right corner — small coloured dot in the top-right of it. Tweak colour tokens if your design tokens don't have `--c-ok`/`--c-warn`/`--c-muted` (substitute the actual names from `frontend/src/styles/tokens.css` or equivalent).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/controls/VoiceChip.tsx frontend/src/components/controls/VoiceChip.test.ts
git commit -m "feat(frontend): ambient TTS-health dot on VoiceChip (wall only)"
```

---

## Task 26: Voice-commands spec — single-origin clarification one-liner

**Files:**
- Modify: `docs/superpowers/specs/2026-06-04-voice-commands-design.md`

- [ ] **Step 1: Locate §0 in the spec**

```bash
grep -n "## 0\." docs/superpowers/specs/2026-06-04-voice-commands-design.md
```

- [ ] **Step 2: Append a one-line clarification under §0 "Post-Review Decisions"**

Add (as the last bullet in §0, mirroring the surrounding style):

```markdown
- **"Single-origin" applies to the browser only.** Pi → backend and Pi → kokoro-tts are LAN service-to-service calls and live outside this constraint. See `2026-06-08-local-tts-sidecar-design.md`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-04-voice-commands-design.md
git commit -m "docs(spec): clarify single-origin scope is browser-only"
```

---

## Task 27: Pi install script — env template update

**Files:**
- Modify: `kiosk/voice-install.sh`

- [ ] **Step 1: Locate the env block in the install script**

```bash
grep -nE "TTS_MODEL|TTS_VOICE|STT_MODEL" kiosk/voice-install.sh
```

- [ ] **Step 2: Append the new TTS_BACKEND / TTS_SERVER_URL / TTS_SERVER_TIMEOUT_S vars**

After the existing `TTS_VOICE=...` line, add:

```bash
# TTS dispatch — `cloud` ships safe; flip to `lan` after manual validation
# against the kokoro-tts sidecar (see specs/2026-06-08-local-tts-sidecar-design.md).
TTS_BACKEND=cloud
TTS_SERVER_URL=http://192.168.1.94:8789
TTS_SERVER_TIMEOUT_S=3
```

- [ ] **Step 3: Commit**

```bash
git add kiosk/voice-install.sh
git commit -m "chore(pi-voice): voice-install.sh ships TTS_BACKEND=cloud (flip after validation)"
```

---

## Task 28: End-to-end validation (manual, on Pi)

**Files:**
- N/A (live system check)

- [ ] **Step 1: Deploy the backend + sidecar to the home server**

From your dev workstation (which is the home server in this case):

```bash
docker compose build kokoro-tts
docker compose up -d kokoro-tts homecal
docker compose logs --tail 30 kokoro-tts homecal
curl -s http://localhost:8789/healthz
```

Expected: `/healthz` returns 200; logs show clean startup + warmup synth completed.

- [ ] **Step 2: Deploy the Pi voice service**

On the Pi:

```bash
ssh hbadmin@192.168.1.135
cd ~/homecal-voice && git pull   # (or your usual sync mechanism)
.venv/bin/pip install -e .         # if the package changed
sudo systemctl restart homecal-voice
journalctl -u homecal-voice -n 20 --no-pager
```

Expected: clean startup, no errors. `TTS_BACKEND` defaults to `cloud` per `/etc/homecal-voice.env` so cloud path stays active.

- [ ] **Step 3: One-off shell test against the sidecar from the Pi**

```bash
ssh hbadmin@192.168.1.135 '
curl -fsS -X POST http://192.168.1.94:8789/tts \
  -H "X-Pi-Token: $(grep PI_API_TOKEN /etc/homecal-voice.env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d "{\"text\":\"Hello from the Pi smoke test.\"}" \
  -o /tmp/lan_tts.wav
ls -lh /tmp/lan_tts.wav && file /tmp/lan_tts.wav
ffplay -nodisp -autoexit /tmp/lan_tts.wav
'
```

Expected: WAV file written, plays through the BT speaker (or aux out) intelligibly.

- [ ] **Step 4: Flip the Pi to LAN backend + restart**

```bash
ssh hbadmin@192.168.1.135 '
sudo sed -i "s/^TTS_BACKEND=cloud/TTS_BACKEND=lan/" /etc/homecal-voice.env
sudo systemctl restart homecal-voice
journalctl -u homecal-voice -n 10 --no-pager
'
```

- [ ] **Step 5: Live test the five intent classes**

Stand near the Pi, run through these utterances:

1. "Hey Mycroft, what's for dinner tonight" — expect spoken reply in < 1.5 s. Confirm in audit: `sqlite3 .../calendar.db "SELECT intent_name, tts_provider, tts_latency_ms FROM voice_utterances ORDER BY id DESC LIMIT 1"` → `kokoro_lan`.
2. "Hey Mycroft, set a one minute pasta timer" — same expectations.
3. "Hey Mycroft, tell me a joke" — expect setup + pause + punchline, all from the catalog (one playback, not two). Audit: `kokoro_lan`, but latency should be very low (cache hit).
4. "Hey Mycroft, do a chicken sound" — instant playback (cache hit). Audit: `kokoro_lan`, low latency.
5. "Hey Mycroft, why is the sky blue" — Haiku answer via local TTS.

- [ ] **Step 6: Failure-mode test — sidecar down**

```bash
docker compose stop kokoro-tts
```

Repeat one utterance (e.g. "what's for dinner"). Expect:
- First call has a ~3 s pause (LAN timeout), then cloud TTS plays the reply.
- Subsequent calls within 30 s skip LAN entirely (no 3 s wait).
- Audit rows tagged `openrouter`.

Bring the sidecar back: `docker compose start kokoro-tts`. After ~30 s, the next call should return to `kokoro_lan`.

- [ ] **Step 7: Wall visual check**

Look at the wall (the `?mode=wall` view). The VoiceChip's ambient dot should be:
- Green during normal operation.
- Amber when the most recent reply came via the clip fallback or silent.
- Grey when muted.

- [ ] **Step 8: Update the session log + commit**

Add a short entry to `docs/SESSION-LOG.md` recording the deploy date, the bench numbers, and any quirks observed during live testing.

```bash
git add docs/SESSION-LOG.md
git commit -m "docs(session-log): local TTS sidecar deployed and validated end-to-end"
```

---

## Self-review notes (run after writing the plan, fix inline)

(This section is for the plan author — strike it before sharing if you prefer.)

- ✅ Spec coverage scan: every numbered locked decision in spec §3 maps to a task above.
- ✅ Schema migration v7 → Task 13. Audit schema fields → Task 14. `/api/voice/status` extension → Task 15. Frontend dot → Tasks 24+25.
- ✅ Pre-rendered catalog → Tasks 10 + 11 (image build runs render). Pi-side consumption → Tasks 22 + 23.
- ✅ Health cache → Task 20. Cloud daily cap → Task 20. Ladder integration → Task 21.
- ✅ Player swap → Task 18. Single-origin clarification → Task 26.
- ✅ No placeholder text. Code blocks present at every implementation step.
- ✅ Function/type names consistent: `synthesize_lan`, `fetch_catalog`, `mark_lan_attempt`, `lan_reachable`, `_under_tts_cap`, `_play_audio_bytes`, `ttsDotColor`, `last_tts_provider`, `TtsProvider`, `kokoro_lan|openrouter|clip|none`.
