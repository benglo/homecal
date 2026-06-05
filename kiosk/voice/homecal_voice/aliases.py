"""Resolve free-text person/chore mentions against the live family + chores
lists fetched at the start of each utterance.

Both matchers are case-insensitive, word-boundary anchored, and prefer the
longest candidate — so 'Samuel' wins over 'Sam' and 'Bathroom floor' wins
over 'Bathroom' when both could match.

A miss returns None and the caller falls through to the LLM, which has
more context to disambiguate.
"""

import re


def _word_re(literal: str, allow_possessive: bool = False) -> "re.Pattern[str]":
    body = re.escape(literal)
    poss = r"(?:['’]s)?" if allow_possessive else ""
    return re.compile(rf"\b{body}{poss}\b", re.IGNORECASE)


def match_person(text, family):
    """Return the family-member dict whose name appears in `text`, else None.

    Longest name first so 'Samuel' wins over 'Sam' when both are family.
    Possessive suffix ('s, ’s) is accepted so "Mia's bathroom" matches Mia.
    """
    if not text or not family:
        return None
    candidates = [fm for fm in family if fm and fm.get("name")]
    candidates.sort(key=lambda fm: -len(fm["name"]))
    for fm in candidates:
        if _word_re(fm["name"], allow_possessive=True).search(text):
            return fm
    return None


def match_chore(text, person, chores):
    """Return the chore dict assigned to `person` whose title appears in
    `text`, else None.

    Restricts the candidate pool to chores where assignedTo == person.id —
    the same person+title pair can exist for multiple family members
    (everyone has a "Bathroom") and the executor needs the right id.
    """
    if not text or not person or not chores:
        return None
    person_id = person.get("id")
    if not person_id:
        return None
    eligible = [c for c in chores if c and c.get("title") and c.get("assignedTo") == person_id]
    eligible.sort(key=lambda c: -len(c["title"]))
    for chore in eligible:
        if _word_re(chore["title"]).search(text):
            return chore
    return None
