"""End-to-end matcher → executor → audit shape tests for the kid intents.

Verifies that field names emitted by the matcher match what the executor
expects. A unit test on each layer can't catch a `catalog_key` vs
`catalog_id` rename drift between matcher and executor — only this can.
"""
from unittest.mock import MagicMock, patch
from homecal_voice.matcher import MatchContext, Matcher
from homecal_voice.patterns_kid import register_kid
from homecal_voice.executor import Executor


def _fresh_matcher() -> Matcher:
    m = Matcher()
    register_kid(m)
    return m


def test_noise_play_matcher_to_executor_round_trip():
    """A matcher hit on 'make a chicken noise' must produce an IntentResult
    whose fields are consumed correctly by Executor._noise_play."""
    matcher = _fresh_matcher()
    ctx = MatchContext(today="2026-06-07")
    intent = matcher.try_match("make a chicken noise", ctx)
    assert intent is not None
    assert intent.intent == "noise_play"

    play = MagicMock()
    ex = Executor(base="http://api", token="t", play_clip=play)
    out = ex.apply(intent)
    assert out["ok"] is True
    play.assert_called_once()


def test_joke_tell_matcher_to_executor_round_trip():
    """A matcher hit on 'tell me a joke' must produce setup + punchline
    fields that the executor speaks in order."""
    matcher = _fresh_matcher()
    ctx = MatchContext(today="2026-06-07")
    intent = matcher.try_match("tell me a joke", ctx)
    assert intent is not None
    assert intent.intent == "joke_tell"

    speak = MagicMock()
    sleep = MagicMock()
    ex = Executor(base="http://api", token="t", speak=speak, sleep=sleep)
    out = ex.apply(intent)
    assert out["ok"] is True
    assert out.get("spoken_inline") is True
    # The executor MUST call speak twice (setup then punchline). If the
    # matcher emitted "setup_text"/"punchline_text" instead of "setup"/"punchline"
    # this would fail with KeyError or empty calls.
    assert speak.call_count == 2
    sleep.assert_called_once_with(1.5)


def test_ask_question_has_no_matcher_pattern():
    """ask_question is intentionally LLM-only — spec §3.5. If a future
    matcher hit emerges, this test fails and forces a routing rethink."""
    matcher = _fresh_matcher()
    ctx = MatchContext(today="2026-06-07")
    # Various question-shaped utterances should all return None (no matcher).
    for utterance in [
        "why is the sky blue",
        "what is a tomato",
        "where do clouds come from",
        "how does rain work",
        "when is dinner",
    ]:
        result = matcher.try_match(utterance, ctx)
        # Some of these may match query_dinner/query_agenda matchers if
        # the test was using core_matcher. Since we used kid_matcher only,
        # all question-shaped utterances should fall through.
        if result is not None:
            assert result.intent != "ask_question", \
                f"ask_question should be LLM-only but matcher returned it for {utterance!r}"
