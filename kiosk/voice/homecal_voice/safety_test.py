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
