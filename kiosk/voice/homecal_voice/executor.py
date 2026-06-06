"""Per-intent execution against the homecal HTTP API.

Each branch of `Executor.apply` is independent and returns:
    {"ok": bool, "spoken": str}
where `spoken` is fed straight to TTS. The `ok` flag drives the audit log
status — `True` for "applied", `False` for "couldn't resolve, told the
user, did not change state".
"""

from datetime import date as Date, datetime, timezone
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


def humanise_duration(seconds: int) -> str:
    """'600' -> '10 minutes'; '90' -> '1 minute and 30 seconds'; '3660' -> '1 hour and 1 minute'.

    Drops zero components and pluralises correctly. Seconds are only included
    when total < 60s or as a trailing remainder of a sub-minute timer; longer
    spoken durations round to the larger unit so TTS doesn't get unwieldy.
    """
    seconds = max(0, int(seconds))
    if seconds < 60:
        return f"{seconds} second{'s' if seconds != 1 else ''}"
    hours, rem = divmod(seconds, 3600)
    minutes, _ = divmod(rem, 60)
    parts: list[str] = []
    if hours:
        parts.append(f"{hours} hour{'s' if hours != 1 else ''}")
    if minutes:
        parts.append(f"{minutes} minute{'s' if minutes != 1 else ''}")
    if not parts:
        # Whole hours only (e.g. 3600s = "1 hour") handled above; this is the
        # safety net for the can't-happen case where both hours+minutes are 0
        # after we've already established seconds >= 60. Speak it as minutes
        # rather than crash.
        return f"{seconds // 60} minutes"
    return " and ".join(parts)


def _remaining_seconds(expires_at_iso: str, now: datetime) -> int:
    """Seconds from `now` until expires_at, clamped at 0."""
    try:
        # fromisoformat in 3.11+ handles 'Z'; be explicit for older runtimes.
        iso = expires_at_iso.replace("Z", "+00:00")
        exp = datetime.fromisoformat(iso)
    except ValueError:
        return 0
    delta = (exp - now).total_seconds()
    return max(0, int(delta))


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
            "timer_set": self._timer_set,
            "timer_query": self._timer_query,
            "timer_cancel": self._timer_cancel,
            "timer_extend": self._timer_extend,
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
            return {"ok": False, "spoken": f"I don't know {f['person']}.", "error": "unknown_person"}
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
            return {"ok": False, "spoken": f"I don't know that chore for {person['name']}.", "error": "unknown_chore"}
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

    # --- timer_* handlers -------------------------------------------------
    # All four resolve against GET /api/timers client-side: the backend has
    # no by-label lookup endpoint, and the active list is short enough
    # (typically 0–3) that a linear scan is cheaper than another round trip.

    def _list_active_timers(self) -> list[dict]:
        return _unwrap(
            requests.get(f"{self.base}/api/timers", timeout=API_TIMEOUT_SEC).json()
        )

    def _resolve_target(self, timers: list[dict], label):
        """Find the timer this utterance refers to.

        With a label, prefer the most-recently-started case-insensitive match
        (last-set-wins matches how a cook actually thinks). Without a label,
        only resolve when exactly one active timer exists — otherwise the
        utterance is ambiguous and we should say so rather than guess.
        Returns (timer, error_tag).
        """
        if label:
            matches = [t for t in timers if (t.get("label") or "").lower() == label.lower()]
            if not matches:
                return None, "unknown_label"
            matches.sort(key=lambda t: t.get("startedAt", ""), reverse=True)
            return matches[0], None
        if not timers:
            return None, "no_timer"
        if len(timers) > 1:
            return None, "ambiguous"
        return timers[0], None

    def _timer_set(self, f: dict) -> dict:
        duration = int(f.get("duration_sec") or 0)
        label = f.get("label")
        body = {"durationSec": duration, "label": label}
        r = requests.post(
            f"{self.base}/api/timers",
            json=body,
            headers=self.headers,
            timeout=API_TIMEOUT_SEC,
        )
        r.raise_for_status()
        spoken_dur = humanise_duration(duration)
        prefix = f"{label.capitalize()} timer" if label else "Timer"
        return {"ok": True, "spoken": f"{prefix} set for {spoken_dur}."}

    def _timer_query(self, f: dict) -> dict:
        timers = self._list_active_timers()
        target, err = self._resolve_target(timers, f.get("label"))
        if err == "no_timer":
            return {"ok": True, "spoken": "No timer running."}
        if err == "ambiguous":
            return {"ok": False, "spoken": "Which timer? You've got more than one running.", "error": "ambiguous_timer"}
        if err == "unknown_label":
            return {"ok": False, "spoken": f"No timer for {f['label']}.", "error": "unknown_label"}
        remaining = _remaining_seconds(target["expiresAt"], datetime.now(timezone.utc))
        prefix = f"{target['label'].capitalize()} timer" if target.get("label") else "Your timer"
        if remaining <= 0:
            return {"ok": True, "spoken": f"{prefix} is done."}
        return {"ok": True, "spoken": f"{prefix} has {humanise_duration(remaining)} left."}

    def _timer_cancel(self, f: dict) -> dict:
        timers = self._list_active_timers()
        target, err = self._resolve_target(timers, f.get("label"))
        if err == "no_timer":
            return {"ok": False, "spoken": "No timer to cancel.", "error": "no_timer"}
        if err == "ambiguous":
            return {"ok": False, "spoken": "Which timer? You've got more than one running.", "error": "ambiguous_timer"}
        if err == "unknown_label":
            return {"ok": False, "spoken": f"No timer for {f['label']}.", "error": "unknown_label"}
        r = requests.delete(
            f"{self.base}/api/timers/{target['id']}",
            headers=self.headers,
            timeout=API_TIMEOUT_SEC,
        )
        r.raise_for_status()
        name = target["label"] if target.get("label") else "the timer"
        return {"ok": True, "spoken": f"Cancelled {name}."}

    def _timer_extend(self, f: dict) -> dict:
        add_sec = int(f.get("duration_sec") or 0)
        if add_sec <= 0:
            return {"ok": False, "spoken": "How much should I add?", "error": "missing_duration"}
        timers = self._list_active_timers()
        target, err = self._resolve_target(timers, f.get("label"))
        if err == "no_timer":
            return {"ok": False, "spoken": "No timer to extend.", "error": "no_timer"}
        if err == "ambiguous":
            return {"ok": False, "spoken": "Which timer? You've got more than one running.", "error": "ambiguous_timer"}
        if err == "unknown_label":
            return {"ok": False, "spoken": f"No timer for {f['label']}.", "error": "unknown_label"}
        r = requests.patch(
            f"{self.base}/api/timers/{target['id']}",
            json={"addSec": add_sec},
            headers=self.headers,
            timeout=API_TIMEOUT_SEC,
        )
        r.raise_for_status()
        updated = r.json()
        remaining = _remaining_seconds(updated["expiresAt"], datetime.now(timezone.utc))
        prefix = f"{updated['label'].capitalize()} timer" if updated.get("label") else "Timer"
        return {
            "ok": True,
            "spoken": f"Added {humanise_duration(add_sec)} — {prefix.lower()} has {humanise_duration(remaining)} left.",
        }

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
