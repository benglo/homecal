from homecal_voice.aliases import match_chore, match_person


MIA = {"id": "fm-mia", "name": "Mia"}
LEO = {"id": "fm-leo", "name": "Leo"}
SAM = {"id": "fm-sam", "name": "Sam"}
SAMUEL = {"id": "fm-samuel", "name": "Samuel"}
MARY_JANE = {"id": "fm-mj", "name": "Mary Jane"}

BATHROOM_MIA = {"id": "ch1", "title": "Bathroom", "assignedTo": "fm-mia"}
DISHES_MIA = {"id": "ch2", "title": "Dishes", "assignedTo": "fm-mia"}
BATHROOM_FLOOR_MIA = {"id": "ch3", "title": "Bathroom floor", "assignedTo": "fm-mia"}
BINS_LEO = {"id": "ch4", "title": "Bins", "assignedTo": "fm-leo"}


# match_person


def test_plain_name_match():
    assert match_person("Mia did the bathroom", [MIA, LEO]) == MIA


def test_lowercase_match():
    """STT lower-cases by default — match must be case-insensitive."""
    assert match_person("mia did the bathroom", [MIA, LEO]) == MIA


def test_possessive_match():
    assert match_person("Mia's bathroom is done", [MIA, LEO]) == MIA


def test_curly_possessive_match():
    """STT and some keyboards emit U+2019."""
    assert match_person("Mia’s bathroom is done", [MIA, LEO]) == MIA


def test_multi_word_name_match():
    assert match_person("Mary Jane finished dishes", [MIA, MARY_JANE]) == MARY_JANE


def test_no_name_in_text_returns_none():
    assert match_person("the bathroom is clean", [MIA, LEO]) is None


def test_empty_text_returns_none():
    assert match_person("", [MIA, LEO]) is None
    assert match_person(None, [MIA, LEO]) is None  # type: ignore[arg-type]


def test_empty_family_returns_none():
    assert match_person("Mia did it", []) is None
    assert match_person("Mia did it", None) is None  # type: ignore[arg-type]


def test_longest_name_wins_when_both_match():
    """'Samuel' contains 'Sam' — when both family members exist and the text
    says 'Samuel did it', return Samuel (longest-first preference)."""
    assert match_person("Samuel did it", [SAM, SAMUEL]) == SAMUEL


def test_word_boundary_prevents_prefix_match():
    """When only 'Sam' is in the family and text says 'Samuel', do not match —
    we'd rather miss and fall through to LLM than ascribe a chore to Sam by
    accident."""
    assert match_person("Samuel did the bathroom", [SAM]) is None


def test_word_boundary_allows_punctuation():
    assert match_person("Mia, did you do the bathroom?", [MIA]) == MIA
    assert match_person("did Mia? yes", [MIA]) == MIA


def test_skips_family_member_missing_name():
    """Defensive — the family API contract guarantees `name`, but a
    bug-fixed downstream dict mutation shouldn't crash the matcher."""
    bad = {"id": "fm-bad"}
    assert match_person("Mia did it", [bad, MIA]) == MIA  # type: ignore[list-item]


# match_chore


def test_chore_assigned_to_person_in_text():
    assert match_chore("did the bathroom", MIA, [BATHROOM_MIA, DISHES_MIA]) == BATHROOM_MIA


def test_chore_not_assigned_to_person_skipped():
    """The bathroom chore is Mia's. If we ask about Leo's bathroom, return
    None — we will not move Leo's stars onto Mia's chore."""
    assert match_chore("did the bathroom", LEO, [BATHROOM_MIA, BINS_LEO]) is None


def test_chore_case_insensitive():
    assert match_chore("BATHROOM done", MIA, [BATHROOM_MIA]) == BATHROOM_MIA
    assert match_chore("Bathroom done", MIA, [BATHROOM_MIA]) == BATHROOM_MIA


def test_multi_word_chore_title():
    assert match_chore("did the bathroom floor", MIA, [BATHROOM_FLOOR_MIA]) == BATHROOM_FLOOR_MIA


def test_longest_chore_title_wins_over_prefix():
    """'Bathroom floor' contains 'Bathroom'. When both exist for Mia and the
    text says 'bathroom floor', return the longer one — the user clearly
    meant the specific chore."""
    found = match_chore("did the bathroom floor", MIA, [BATHROOM_MIA, BATHROOM_FLOOR_MIA])
    assert found == BATHROOM_FLOOR_MIA


def test_short_title_match_when_long_absent():
    """Same chores but the user said only 'bathroom' — return the short one."""
    assert match_chore("did the bathroom", MIA, [BATHROOM_MIA, BATHROOM_FLOOR_MIA]) == BATHROOM_MIA


def test_chore_title_word_boundary():
    """'bath' must not match 'Bathroom' — partial-word collisions are a
    silent misattribution risk."""
    assert match_chore("had a bath", MIA, [BATHROOM_MIA]) is None


def test_chore_not_in_text_returns_none():
    assert match_chore("did her thing", MIA, [BATHROOM_MIA, DISHES_MIA]) is None


def test_empty_inputs_return_none():
    assert match_chore("", MIA, [BATHROOM_MIA]) is None
    assert match_chore(None, MIA, [BATHROOM_MIA]) is None  # type: ignore[arg-type]
    assert match_chore("bathroom", None, [BATHROOM_MIA]) is None  # type: ignore[arg-type]
    assert match_chore("bathroom", MIA, []) is None
    assert match_chore("bathroom", MIA, None) is None  # type: ignore[arg-type]


def test_person_without_id_returns_none():
    """A family-member dict missing the 'id' key can't be matched against
    the assignedTo column — bail rather than guess."""
    assert match_chore("bathroom", {"name": "Mia"}, [BATHROOM_MIA]) is None


def test_skips_chore_missing_title():
    """Same defence as the family-member version."""
    bad = {"id": "ch-bad", "assignedTo": "fm-mia"}
    assert match_chore("bathroom", MIA, [bad, BATHROOM_MIA]) == BATHROOM_MIA  # type: ignore[list-item]
