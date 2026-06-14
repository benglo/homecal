# UI update: slot-tap creation, voice band, desktop shell — design

**Date:** 2026-06-11
**Status:** Approved (brainstormed with mockups; visual companion session `3508717-1781171164`)
**Approach:** Compose from existing parts (approach A) — no new frameworks, no schema migrations.

## Goal

Make creating events feel like Outlook: tap/click (or drag) directly on calendar slots instead of
routing everything through the FAB. Give the voice assistant a first-class visual presence and a
tap-to-talk path. Add a proper desktop layout for laptop/desktop management.

Three phases, each independently shippable:

1. **P1 — Slot-tap/drag creation** (wall week + month; frontend only)
2. **P2 — Voice upgrade** (band + tap-to-talk + `event_add` intent; frontend + backend + Pi)
3. **P3 — Desktop shell** (`?mode=desktop`; frontend only)

## Locked decisions from brainstorm

- One unified Quick Add form with **inline category chips** — the AddChooser two-step is retired.
- The ControlBar `+` and phone FAB **stay as secondary** entry points (they open the same form).
- **Drag-to-select duration everywhere** (mouse drag on desktop; long-press+drag on kiosk touch).
- Desktop entry is **`?mode=desktop`** — consistent with the locked mode-param convention.
- Voice: **bottom band** over the ControlBar; **chip tap = talk**, long-press = mute menu.
- `event_add` is **always confirmed** via the confirm card — never auto-applied.
- Voice UI remains **wall-only**; desktop/phone get no band or chip.
- Phone layout is otherwise untouched in this round.

---

## P1 — Slot-tap / drag creation (wall week + month)

### GridCalendar (`frontend/src/components/calendar/GridCalendar.tsx`)

- Enable `selectable` + `selectMirror` (interaction plugin is already loaded).
- Kiosk-friendly `longPressDelay` (~250 ms) so deliberate presses select but swipes still scroll.
- New optional prop:
  ```ts
  onSlotSelect?: (sel: { date: string; time?: string; endTime?: string; allDay: boolean }) => void
  ```
  - **Week (timeGrid):** tap = 1-hour draft at the tapped 30-min slot; drag = exact range.
    Both arrive via FullCalendar's `select` callback.
  - **Month (dayGrid):** day tap = that date, timed by default (next half-hour via the existing
    `nextHalfHour` util, 1-hour duration), all-day one toggle away.
- Event taps keep current behaviour (wall: DayDetailSheet).
- `selectMirror` paints the ghost range while the form is open — no draft-chip-in-grid machinery.
  Clear the FullCalendar selection when the form closes (cancel or save).

### Unified Quick Add

- `QuickAddSheet` evolves into **`EventQuickAdd`** (pure form component) rendered in two shells:
  - Wall/phone: existing bottom `Sheet` (virtual keyboard pops as today).
  - Desktop (P3): anchored popover at the click point.
- Form: **horizontal category chip row** at top (AddChooser colours/icons, first category
  preselected), title (autofocus), date/time/end prefilled from the slot, all-day toggle.
- The **Dinner chip** swaps the form body to the dinner editor's meal field (dinners are
  date-keyed meals, not events).
- ControlBar `+` / phone FAB open the same form with today + next-half-hour defaults.
- `AddChooser.tsx` is deleted; `WallLayout`/`PhoneLayout` wiring updated.

---

## P2 — Voice: band, tap-to-talk, event_add

### VoiceBand (new, wall only)

A ~72 px band that slides up **over the ControlBar** when overlay state ≠ idle and collapses back
to the chip when idle. Calendar stays visible. States:

| State | Band content |
|---|---|
| `listening` | mic + animated VU bars (pokes already carry `vu`) + "Listening…" + "tap anywhere to cancel" |
| `thinking` | italic transcript of what whisper heard + spinner |
| `confirming` | band shows transcript; existing ConfirmCard renders on top |
| `applied` | check + Luna's reply text; reuses the existing 2 s auto-fade |
| `failed` | "didn't catch that" (+ transcript when available) |

- Driven by the existing `voiceState` reducer, extended with `transcript`/`reply` fields.
- `VoiceChip` remains the idle pill: **tap = trigger listen**, **long-press = mute menu**
  (replaces tap-opens-menu). Muted chip tap still = instant unmute (unchanged).

### Tap-to-talk plumbing

- New backend route **`POST /api/voice/listen`** — no body, no DB; emits
  `broker.poke('voice', { kind: 'listen_request' })`.
- Pi service: the existing SSE thread (`main.py` `_start_mute_sse`) also watches for
  `listen_request` and sets a `threading.Event`. The wake loop checks the event each frame and
  enters `_run_after_wake(d)` directly, bypassing openWakeWord.
- Trigger is **ignored while muted or while a cycle is already running**.

### `event_add` intent (Pi + backend)

- New intent in the Haiku prompt + executor:
  `{ title, date, time?, duration_minutes?, all_day?, category? }`.
- Category resolved by case-insensitive name match against `GET /api/categories`;
  fallback **Family**.
- **Always `confirming`** — confirm card shows title, day, time range, category chip;
  yes/no by voice (existing `confirm_loop`) or touch. Calendar writes are higher-stakes than
  dinner/chore intents.
- Apply path = existing **`POST /api/events`** — same zod validation, caps, and SSE
  invalidation as any client. No recurrence via voice in v1.

### Poke payload additions

- `thinking` payload gains `transcript`; `applied` payload gains `reply` (the TTS text).
- Backend voice-state zod schema updated to pass these through; audit rows unchanged
  (transcript already audited).

---

## P3 — Desktop shell (`?mode=desktop`)

`ModeRouter` learns a third mode → **`DesktopLayout`**.

### Layout

- **Top bar:** `+ New event`, ‹ › / Today, period label, Week/Month/Agenda switcher, `⚙ Manage`.
- **Left sidebar (~190 px):**
  - **MiniMonth** — click a day to jump the main grid.
  - **CategoryFilters** — client-side visibility checkboxes (ephemeral; resets on reload).
  - **UpNext** — compact 7-day agenda + tonight's dinner.
- **Main:** same `GridCalendar` (full 7-day week / month), click/drag creates via
  **`QuickAddPopover`** anchored at the click point, hosting the same `EventQuickAdd` form.
  "More options…" expands to the full `EventEditorSheet` (recurrence, location).
- Event click on desktop → straight to the full editor (no DayDetail hop).
- **ManagePanel** — right slide-over reusing the existing managers (dinners, family, chores,
  categories, photos, voice mute, concerns, kiosk shutdown). No new manage UIs.

### Boundaries

- No voice band/chip, hero band, weather, or chores board — this is the planning surface.
- Narrow screens keep PhoneLayout; `?mode=desktop` is explicit (bookmark it).

---

## Error handling

- Tap-to-talk while mic offline → chip already shows `mic_offline`; trigger endpoint still 200s
  (poke is fire-and-forget; the Pi simply isn't there to act).
- `event_add` with unparseable/missing date → `failed` state ("didn't catch that").
- Quick Add mutation failure → existing mutation error path (sheet stays open, error shown).
- FullCalendar selection always cleared on form close so no stale ghost lingers.

## Testing

- **Unit (frontend, vitest):** voiceState reducer transitions incl. new payload fields;
  slot-selection → prefill mapping (tap vs drag vs month vs all-day); EventQuickAdd category
  chip behaviour incl. dinner swap.
- **Unit (Pi, pytest):** `event_add` parsing + category name matcher + fallback; trigger event
  handling (muted / mid-cycle ignored).
- **Integration (backend, node:test):** `POST /api/voice/listen` emits the poke; voice-state
  schema accepts `transcript`/`reply`; `event_add` apply path hits standard events validation.
- **Manual/e2e:** kiosk — tap slot → keyboard → add; drag → exact range; chip tap → band;
  voice "add soccer practice Thursday 4pm" → confirm → event appears. Desktop — drag-create via
  popover, filters, manage panel, mini-month jump.
- Recurrence engine untouched — its truth-table suite is the regression gate.

## Out of scope

- Voice-assisted slot fill (dictate title after tapping a slot).
- Recurring events via voice; "this-and-following" edits (v2, unchanged).
- Category filters on wall/phone; viewport-based mode switching.
- Live word-by-word streaming transcript (whisper transcribes post-recording; the band shows the
  full transcript at `thinking`).
