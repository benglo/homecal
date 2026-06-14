"""Build-time catalog pre-renderer. Walks noises.json + jokes.json from
the homecal-voice catalogs dir, synthesizes each entry once, writes WAVs
into <out_dir>/{noise,joke}/<key>.wav. Idempotent — skips files that
already exist so iterating during dev doesn't re-render the whole batch.

For jokes: setup + 1.5s of silence + punchline, all in one WAV. Matches
the live executor's setup → pause → punchline flow today; baking it into
one file means matcher-hit jokes play instantly with no TTS roundtrip."""
import argparse
import io
import json
import sys
import wave
from pathlib import Path
from typing import Iterable

import numpy as np

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
        with wave.open(io.BytesIO(buf), "rb") as w:
            return w.getnchannels(), w.getsampwidth(), w.getframerate(), w.readframes(w.getnframes())
    nc, sw, sr, setup_pcm = _read(setup_wav)
    _, _, _, punch_pcm = _read(punchline_wav)
    pause_pcm = np.zeros(int(sr * JOKE_PAUSE_SECONDS), dtype=np.int16).tobytes()
    out = io.BytesIO()
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
