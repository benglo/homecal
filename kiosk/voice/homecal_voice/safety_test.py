from homecal_voice.safety import check_answer, REDIRECT_LINE


def test_clean_answer_passes_through():
    out = check_answer("The sky is blue because of scattering.")
    assert out == "The sky is blue because of scattering."


def test_banned_term_overrides_to_redirect():
    out = check_answer("That word fuck is not nice.")
    assert out == REDIRECT_LINE


def test_word_boundary_grape_does_not_match_rape():
    out = check_answer("Grape juice is delicious!")
    assert out == "Grape juice is delicious!"


def test_word_boundary_dinosaur_died_does_not_match():
    # "die" / "died" are NOT in the term list — they have legitimate uses.
    # If a future maintainer adds them, this test goes red and forces a rethink.
    out = check_answer("The dinosaurs died out millions of years ago.")
    assert out == "The dinosaurs died out millions of years ago."


def test_scraped_does_not_match_rape():
    out = check_answer("I scraped my knee yesterday.")
    assert out == "I scraped my knee yesterday."


def test_case_insensitive():
    out = check_answer("FUCK is bad.")
    assert out == REDIRECT_LINE


def test_empty_string_passes_through():
    assert check_answer("") == ""


def test_term_at_start_of_string():
    out = check_answer("shit happens")
    assert out == REDIRECT_LINE


def test_term_at_end_of_string():
    out = check_answer("oh no, shit")
    assert out == REDIRECT_LINE


def test_term_followed_by_punctuation():
    out = check_answer("Oh fuck!")
    assert out == REDIRECT_LINE


# ---------------------------------------------------------------------------
# Fix E — Group 3c: curly apostrophes + multi-banned-term
# ---------------------------------------------------------------------------


def test_curly_apostrophes_do_not_break_word_boundaries():
    """Haiku occasionally outputs curly punctuation. \\b is ASCII-based, so
    a curly apostrophe creates word boundaries differently than a straight
    one — pin the current behaviour so we notice if it ever shifts."""
    # A clean sentence with curly apostrophes must still pass through.
    out = check_answer("That’s a great question — let’s ask your grown-up!")
    assert "great question" in out

    # A banned word with a curly apostrophe attached is still a banned word.
    # If this ever stops matching, we'd want to know (curly is rare in
    # natural speech but increasingly common in LLM output).
    out2 = check_answer("oh “fuck” he said")
    assert out2 == REDIRECT_LINE


def test_multi_banned_term_answer_redirects_once():
    """Two banned terms in one answer still produces a single redirect line.
    Documents that the safety net replaces the whole answer (not partial)."""
    out = check_answer("don't say fuck or shit, kids")
    assert out == REDIRECT_LINE
