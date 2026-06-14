import json
import wave
import io
import numpy as np
from unittest.mock import MagicMock

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
