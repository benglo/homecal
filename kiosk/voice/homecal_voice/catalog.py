"""Catalog loader for kid intents.

Loads + validates noise, joke, and safety-term catalogs from JSON files
bundled with the package. `check_integrity()` is called at service startup
so a typo in jokes.json or a missing MP3 fails loudly at boot, not in the
kitchen at 6pm.
"""
import json
import sys
from dataclasses import dataclass
from pathlib import Path


_PKG_DIR = Path(__file__).parent
_CATALOGS_DIR = _PKG_DIR / "catalogs"
_CLIPS_DIR = _PKG_DIR / "clips" / "noises"
_NOISES_PATH = _CATALOGS_DIR / "noises.json"
_JOKES_PATH = _CATALOGS_DIR / "jokes.json"
_SAFETY_PATH = _CATALOGS_DIR / "safety_terms.json"


@dataclass(frozen=True)
class Noises:
    entries: dict[str, str]   # name → mp3 filename
    synonyms: dict[str, str]  # alias → name


@dataclass(frozen=True)
class Joke:
    id: str
    setup: str
    punchline: str


def load_noises() -> Noises:
    data = json.loads(_NOISES_PATH.read_text())
    return Noises(entries=dict(data["entries"]), synonyms=dict(data.get("synonyms", {})))


def load_jokes() -> list[Joke]:
    raw = json.loads(_JOKES_PATH.read_text())
    return [Joke(id=j["id"], setup=j["setup"], punchline=j["punchline"]) for j in raw]


def load_safety_terms() -> list[str]:
    return list(json.loads(_SAFETY_PATH.read_text()))


def check_integrity() -> None:
    """Validate catalogs at import. SystemExit on failure (no silent degradation)."""
    try:
        noises = load_noises()
        jokes = load_jokes()
        load_safety_terms()
    except (json.JSONDecodeError, KeyError, FileNotFoundError) as e:
        sys.exit(f"FATAL: catalog load failed: {e}")

    for name, filename in noises.entries.items():
        path = _CLIPS_DIR / filename
        if not path.is_file():
            sys.exit(f"FATAL: noise catalog references missing clip: {name} → {path}")

    if not jokes:
        sys.exit("FATAL: jokes.json is empty")
