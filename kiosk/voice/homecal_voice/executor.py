"""Per-intent execution against the homecal HTTP API.

Each branch of `Executor.apply` is independent and returns:
    {"ok": bool, "spoken": str}
where `spoken` is fed straight to TTS. The `ok` flag drives the audit log
status — `True` for "applied", `False` for "couldn't resolve, told the
user, did not change state".
"""

from datetime import date as Date
import logging

import requests

from homecal_voice.intent import IntentResult
from homecal_voice.timezone import today_brisbane

log = logging.getLogger("homecal_voice.executor")

API_TIMEOUT_SEC = 10
AGENDA_MAX_ITEMS = 3


def _canon_meal(s: str) -> str:
    """Title-case but preserve all-caps tokens (BBQ, PB&J) which plain
    .title() would mangle. STT lower-cases by default."""
    s = (s or "").strip()
    if not s:
        return s
    return " ".join(t if t.isupper() and len(t) > 1 else t.capitalize() for t in s.split())


def _speak_time(hhmm: str) -> str:
    """'17:00' → '5pm', '09:30' → '9:30am'. TTS reads 24h times stiffly."""
    try:
        h, m = (int(x) for x in hhmm.split(":"))
    except ValueError:
        return hhmm
    suffix = "am" if h < 12 else "pm"
    h12 = 12 if h % 12 == 0 else h % 12
    return f"{h12}{suffix}" if m == 0 else f"{h12}:{m:02d}{suffix}"


def _join_natural(items: list[str]) -> str:
    """Oxford-comma join: ['a','b','c'] → 'a, b, and c'."""
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return ", ".join(items[:-1]) + ", and " + items[-1]


def _unwrap(json_body):
    """Accept bare arrays AND `{data:[...]}` envelopes — backend currently
    returns the former but a future envelope migration shouldn't break us."""
    if isinstance(json_body, list):
        return json_body
    if isinstance(json_body, dict) and isinstance(json_body.get("data"), list):
        return json_body["data"]
    return []


class Executor:
    def __init__(self, *, base: str, token: str):
        self.base = base.rstrip("/")
        self.headers = {"X-Pi-Token": token, "Content-Type": "application/json"}
        self._handlers = {
            "dinner_set": self._dinner_set,
            "chore_complete": self._chore_complete,
            "query_dinner": self._query_dinner,
            "query_agenda": self._query_agenda,
        }

    def apply(self, r: IntentResult) -> dict:
        handler = self._handlers.get(r.intent)
        if handler is None:
            return {"ok": False, "spoken": "I didn't catch that."}
        return handler(r.fields)

    def _dinner_set(self, f: dict) -> dict:
        meal = _canon_meal(f["meal"])
        r = requests.put(
            f"{self.base}/api/dinners/{f['date']}",
            json={"meal": meal},
            headers=self.headers,
            timeout=API_TIMEOUT_SEC,
        )
        r.raise_for_status()
        return {"ok": True, "spoken": f"Got it, {meal} for {self._humanise(f['date'])}."}

    def _chore_complete(self, f: dict) -> dict:
        members = _unwrap(requests.get(f"{self.base}/api/family-members", timeout=API_TIMEOUT_SEC).json())
        chores = _unwrap(requests.get(f"{self.base}/api/chores", timeout=API_TIMEOUT_SEC).json())
        person = next((m for m in members if m["name"].lower() == f["person"].lower()), None)
        if not person:
            return {"ok": False, "spoken": f"I don't know {f['person']}."}
        chore = next(
            (
                c
                for c in chores
                if c.get("title", "").lower() == f["chore"].lower()
                and c.get("assignedTo") == person["id"]
            ),
            None,
        )
        if not chore:
            return {"ok": False, "spoken": f"I don't know that chore for {person['name']}."}
        r = requests.post(
            f"{self.base}/api/chores/{chore['id']}/complete",
            json={"date": today_brisbane()},
            headers=self.headers,
            timeout=API_TIMEOUT_SEC,
        )
        r.raise_for_status()
        return {"ok": True, "spoken": f"Nice work, {person['name']}."}

    def _query_dinner(self, f: dict) -> dict:
        date = f["date"]
        rows = _unwrap(
            requests.get(
                f"{self.base}/api/dinners",
                params={"start": date, "end": date},
                timeout=API_TIMEOUT_SEC,
            ).json()
        )
        meal = next((row["meal"] for row in rows if row["date"] == date), None)
        when = self._humanise(date)
        if not meal:
            return {"ok": True, "spoken": f"Nothing planned for dinner {when} yet."}
        # Possessive form only for relative words — "2026-06-12's dinner" reads
        # awkwardly so the ISO fallback uses a prepositional phrase instead.
        if when in ("today", "tonight", "tomorrow"):
            phrase = {"today": "Tonight's", "tonight": "Tonight's", "tomorrow": "Tomorrow's"}[when]
            return {"ok": True, "spoken": f"{phrase} dinner is {meal}."}
        return {"ok": True, "spoken": f"Dinner on {when} is {meal}."}

    def _query_agenda(self, f: dict) -> dict:
        date = f["date"]
        # Brisbane is fixed UTC+10 (spec §0); send the local-day window with offset so
        # the backend's UTC window covers the right slice of wall-clock time.
        items = _unwrap(
            requests.get(
                f"{self.base}/api/events",
                params={
                    "start": f"{date}T00:00:00+10:00",
                    "end": f"{date}T23:59:59+10:00",
                },
                timeout=API_TIMEOUT_SEC,
            ).json()
        )
        when = self._humanise(date)
        if not items:
            return {"ok": True, "spoken": f"Nothing on {when}."}
        bits = []
        for e in items[:AGENDA_MAX_ITEMS]:
            title = e.get("title", "event")
            start = e.get("start", "")
            # All-day events store start as YYYY-MM-DD (date-only); omit the time.
            time_str = f" at {_speak_time(start[11:16])}" if len(start) >= 16 and start[10:11] == "T" else ""
            bits.append(f"{title}{time_str}")
        return {"ok": True, "spoken": f"{when.capitalize()} you've got " + _join_natural(bits) + "."}

    def _humanise(self, iso_date: str) -> str:
        today = today_brisbane()
        if iso_date == today:
            return "today"
        try:
            delta = Date.fromisoformat(iso_date) - Date.fromisoformat(today)
        except ValueError:
            return iso_date
        if delta.days == 1:
            return "tomorrow"
        return iso_date
