from homecal_voice.poke_handlers import classify_poke


def test_listen_request_is_a_trigger():
    assert classify_poke({"kind": "voice", "payload": {"kind": "listen_request"}}) == "listen"


def test_voice_state_invalidates_mute():
    assert classify_poke({"kind": "voice", "payload": {"kind": "mute_changed"}}) == "mute"


def test_voice_state_echo_is_mute_refresh():
    # any non-listen voice poke just means "re-check mute cache" (current behaviour)
    assert classify_poke({"kind": "voice", "payload": {"kind": "applied"}}) == "mute"


def test_non_voice_poke_ignored():
    assert classify_poke({"kind": "events"}) is None
    assert classify_poke({}) is None
    assert classify_poke("garbage") is None
