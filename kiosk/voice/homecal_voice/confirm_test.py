import pytest
from homecal_voice.confirm import classify_confirmation, ConfirmKind

YES = ["yes", "yeah", "yep", "correct", "confirm", "do it", "right", "ok", "okay"]
NO  = ["no", "nope", "cancel", "stop", "scratch that", "never mind", "abort"]
EDIT = ["no, change time to six", "actually make it taco tuesday", "edit dinner to pasta"]

@pytest.mark.parametrize("phrase", YES)
def test_yes(phrase): assert classify_confirmation(phrase).kind == "yes"

@pytest.mark.parametrize("phrase", NO)
def test_no(phrase): assert classify_confirmation(phrase).kind == "no"

@pytest.mark.parametrize("phrase", EDIT)
def test_edit(phrase):
    r = classify_confirmation(phrase)
    assert r.kind == "edit"
    assert r.hint

def test_ambiguous_or_long_falls_through():
    r = classify_confirmation("yes I think we should also order pizza maybe")
    assert r.kind == "ambiguous"
