from homecal_voice.executor import Executor
from homecal_voice.intent import IntentResult

def test_dinner_set_posts_to_dinners(requests_mock):
    requests_mock.put("http://api/api/dinners/2026-06-04", json={"ok": True})
    ex = Executor(base="http://api", token="t")
    res = IntentResult("dinner_set", {"date": "2026-06-04", "meal": "tacos"}, 0.92, "")
    out = ex.apply(res)
    assert out["ok"] is True

def test_chore_complete_resolves_then_posts(requests_mock):
    requests_mock.get("http://api/api/family-members",
                      json=[{"id": "fm1", "name": "Mia", "icon": ""}])
    requests_mock.get("http://api/api/chores",
                      json=[{"id": "c1", "title": "Bathroom", "assignedTo": "fm1"}])
    posted = []
    def post_cb(request, _ctx):
        posted.append(request.json())
        return {"ok": True}
    requests_mock.post("http://api/api/chores/c1/complete", json=post_cb)
    ex = Executor(base="http://api", token="t")
    res = IntentResult("chore_complete", {"person": "Mia", "chore": "Bathroom"}, 0.95, "")
    out = ex.apply(res)
    assert out["ok"] is True
    assert posted and "date" in posted[0]

def test_query_dinner_returns_meal_or_none(requests_mock):
    requests_mock.get("http://api/api/dinners",
                      json=[{"date": "2026-06-04", "meal": "tacos"}])
    ex = Executor(base="http://api", token="t")
    res = IntentResult("query_dinner", {"date": "2026-06-04"}, 0.95, "")
    out = ex.apply(res)
    assert "tacos" in out["spoken"].lower()
