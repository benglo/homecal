import logging, requests
from datetime import date as Date
from homecal_voice.intent import IntentResult

log = logging.getLogger("homecal_voice.executor")

def _unwrap(json_body):
    """R3 — defensive: homecal list endpoints return bare arrays today.
    Tolerate either bare array or {data:[...]} so the test fixtures and the
    real API both work."""
    if isinstance(json_body, list): return json_body
    if isinstance(json_body, dict) and isinstance(json_body.get("data"), list):
        return json_body["data"]
    return []

class Executor:
    def __init__(self, *, base: str, token: str):
        self.base = base.rstrip("/")
        self.headers = {"X-Pi-Token": token, "Content-Type": "application/json"}

    def apply(self, r: IntentResult) -> dict:
        if r.intent == "dinner_set":     return self._dinner_set(r.fields)
        if r.intent == "chore_complete": return self._chore_complete(r.fields)
        if r.intent == "query_dinner":   return self._query_dinner(r.fields)
        if r.intent == "query_agenda":   return self._query_agenda(r.fields)
        return {"ok": False, "spoken": "I didn't catch that."}

    def _dinner_set(self, f: dict) -> dict:
        r = requests.put(f"{self.base}/api/dinners/{f['date']}",
                         json={"meal": f["meal"]}, headers=self.headers, timeout=10)
        r.raise_for_status()
        return {"ok": True, "spoken": f"Saved {f['meal']} for {self._humanise(f['date'])}."}

    def _chore_complete(self, f: dict) -> dict:
        members = _unwrap(requests.get(f"{self.base}/api/family-members", timeout=10).json())
        chores  = _unwrap(requests.get(f"{self.base}/api/chores",          timeout=10).json())
        person = next((m for m in members if m["name"].lower() == f["person"].lower()), None)
        if not person: return {"ok": False, "spoken": f"I don't know {f['person']}."}
        chore = next((c for c in chores
                      if c.get("title", "").lower() == f["chore"].lower()
                      and c.get("assignedTo") == person["id"]), None)
        if not chore: return {"ok": False, "spoken": f"I don't know that chore for {person['name']}."}
        today_br = self._today_brisbane()
        r = requests.post(f"{self.base}/api/chores/{chore['id']}/complete",
                          json={"date": today_br}, headers=self.headers, timeout=10)
        r.raise_for_status()
        return {"ok": True, "spoken": f"Nice work {person['name']}."}

    def _query_dinner(self, f: dict) -> dict:
        date = f["date"]
        rows = _unwrap(requests.get(f"{self.base}/api/dinners",
                                    params={"start": date, "end": date}, timeout=10).json())
        meal = next((row["meal"] for row in rows if row["date"] == date), None)
        if not meal: return {"ok": True, "spoken": f"Nothing planned for {self._humanise(date)} yet."}
        return {"ok": True, "spoken": f"{self._humanise(date).capitalize()} dinner: {meal}."}

    def _query_agenda(self, f: dict) -> dict:
        date = f["date"]
        # Brisbane is fixed UTC+10 (spec §0). Send the local-day window with offset.
        items = _unwrap(requests.get(f"{self.base}/api/events",
                                     params={"start": f"{date}T00:00:00+10:00",
                                             "end":   f"{date}T23:59:59+10:00"}, timeout=10).json())
        if not items: return {"ok": True, "spoken": f"Nothing on {self._humanise(date)}."}
        bits = []
        for e in items[:3]:
            title = e.get("title", "event")
            start = e.get("start", "")
            time_str = f" at {start[11:16]}" if len(start) >= 16 and start[10] == "T" else ""
            bits.append(f"{title}{time_str}")
        return {"ok": True, "spoken": f"On {self._humanise(date)}: " + ", ".join(bits) + "."}

    def _humanise(self, iso_date: str) -> str:
        today = self._today_brisbane()
        if iso_date == today: return "today"
        from datetime import date as D
        d = D.fromisoformat(iso_date) - D.fromisoformat(today)
        if d.days == 1: return "tomorrow"
        return iso_date

    def _today_brisbane(self) -> str:
        import time
        return time.strftime("%Y-%m-%d", time.gmtime(time.time() + 10 * 3600))
