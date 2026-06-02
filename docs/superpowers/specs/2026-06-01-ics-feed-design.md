# iCal Feed — Design Spec

Read-only `.ics` (iCalendar RFC 5545) subscription feed so phones on the LAN can subscribe
and receive native calendar notifications without an account.

## Endpoint

`GET /api/feed.ics`

- **Content-Type:** `text/calendar; charset=utf-8`
- **Content-Disposition:** `inline; filename="homecal.ics"`
- **Cache-Control:** `no-cache` (always fresh; LAN latency is negligible, dataset is small)
- **No auth** (consistent with v1 trusted-LAN stance)

## Calendar envelope

```
PRODID:-//homecal//EN
X-WR-CALNAME:Family Calendar
X-WR-TIMEZONE:Australia/Brisbane
METHOD:PUBLISH
```

## Events → VEVENTs

Each **master** event row becomes one VEVENT (not pre-expanded).

| iCal property | Source |
|---|---|
| `UID` | `{event.id}@homecal` (stable, unique) |
| `DTSTAMP` | `event.updatedAt` |
| `LAST-MODIFIED` | `event.updatedAt` |
| `DTSTART` | `event.start` (UTC) — `VALUE=DATE` if `allDay` |
| `DTEND` | `event.end` (UTC) — `VALUE=DATE` if `allDay` |
| `SUMMARY` | `event.title` |
| `LOCATION` | `event.location` (omitted if null) |
| `CATEGORIES` | category name (looked up from categories table) |
| `RRULE` | raw string pass-through (already iCal-format) |
| `EXDATE` | one per `cancelled` exception from `event_exceptions` — `VALUE=DATE` if `allDay` |

All-day `DTSTART`/`DTEND` use `VALUE=DATE` format (`YYYYMMDD`). Timed events use UTC
(`YYYYMMDDTHHMMSSZ`).

## Dinners → all-day VEVENTs

Each dinner row becomes an all-day VEVENT.

| iCal property | Source |
|---|---|
| `UID` | `dinner-{date}@homecal` |
| `DTSTAMP` | `dinner.updatedAt` |
| `DTSTART;VALUE=DATE` | dinner date (`YYYYMMDD`) |
| `DTEND;VALUE=DATE` | dinner date + 1 day |
| `SUMMARY` | `Dinner: {meal}` |
| `CATEGORIES` | `Dinner` |

## Data fetching

No window filter — the full dataset is returned. The subscribing calendar app manages its
own display window. For a family calendar this is a small dataset (hundreds of events at
most).

Queries:
1. All categories (for name lookup map)
2. All event masters (all rows from `events`)
3. All event exceptions (all `cancelled` rows from `event_exceptions`)
4. All dinners (all rows from `dinners`)

## Dependency

`ical-generator` — installed in the backend workspace only. Handles VCALENDAR/VEVENT
serialization, line folding, escaping, RRULE raw string pass-through, EXDATE, CATEGORIES,
and all-day `VALUE=DATE`.

## Files

| File | Purpose |
|---|---|
| `backend/src/routes/feed.ts` | Route handler + iCal builder |
| `backend/src/routes/feed.test.ts` | Tests (round-trip parse, RRULE, EXDATE, dinners, all-day) |
| `backend/src/server.ts` | Register `feedRoutes` |

## Test plan

1. Empty calendar → valid VCALENDAR with no VEVENTs
2. Single timed event → correct UID, DTSTART/DTEND in UTC, SUMMARY, CATEGORIES
3. All-day event → `VALUE=DATE` format for DTSTART/DTEND
4. Recurring event with RRULE → RRULE property present
5. Recurring event with cancelled exception → EXDATE present
6. Dinner → all-day VEVENT with `Dinner: {meal}` summary
7. Content-Type is `text/calendar; charset=utf-8`
