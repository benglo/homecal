import json
import pytest

from homecal_voice import catalog


def test_load_noises_succeeds():
    n = catalog.load_noises()
    assert "chicken" in n.entries
    assert n.synonyms.get("doggy") == "dog"


def test_load_jokes_succeeds():
    j = catalog.load_jokes()
    assert len(j) >= 1
    assert hasattr(j[0], "setup")
    assert hasattr(j[0], "punchline")
    assert hasattr(j[0], "id")


def test_load_safety_terms_succeeds():
    terms = catalog.load_safety_terms()
    assert isinstance(terms, list)


def test_integrity_check_passes_on_well_formed_catalogs():
    catalog.check_integrity()  # raises SystemExit on failure; should not


def test_integrity_check_fails_on_missing_clip(tmp_path, monkeypatch):
    fake = tmp_path / "noises.json"
    fake.write_text(json.dumps({"synonyms": {}, "entries": {"x": "missing.mp3"}}))
    monkeypatch.setattr(catalog, "_NOISES_PATH", fake)
    monkeypatch.setattr(catalog, "_CLIPS_DIR", tmp_path)
    with pytest.raises(SystemExit):
        catalog.check_integrity()


def test_integrity_check_fails_on_malformed_json(tmp_path, monkeypatch):
    fake = tmp_path / "noises.json"
    fake.write_text("{not valid json")
    monkeypatch.setattr(catalog, "_NOISES_PATH", fake)
    with pytest.raises(SystemExit):
        catalog.check_integrity()


def test_integrity_check_fails_on_empty_jokes(tmp_path, monkeypatch):
    fake = tmp_path / "jokes.json"
    fake.write_text("[]")
    monkeypatch.setattr(catalog, "_JOKES_PATH", fake)
    with pytest.raises(SystemExit):
        catalog.check_integrity()


def test_noises_entries_are_immutable():
    """MappingProxyType prevents silent runtime mutation of the in-process
    catalog. A future maintainer who tries to monkey-patch will hit a
    TypeError, not a silently corrupted shared dict."""
    n = catalog.load_noises()
    with pytest.raises(TypeError):
        n.entries["chicken"] = "evil.mp3"  # type: ignore[index]
    with pytest.raises(TypeError):
        n.synonyms["doggy"] = "evil"  # type: ignore[index]
