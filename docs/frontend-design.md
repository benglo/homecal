# Family Calendar — Frontend Design System & Wireframes (locked)

Companion to `family-calendar-build-spec.md`. **The build must follow this doc.** It locks the visual
language, tokens, component behaviour, and annotated layouts for both surfaces.

**Locked direction**
- **Theme:** Auto **day / night** (light & airy by day → dim dark by night on the always-on wall).
- **Aesthetic:** **Calm & minimal** — Scandinavian/editorial: generous whitespace, neutral surfaces,
  one accent, crisp grotesk type, quiet hierarchy.
- **Wall layout:** **Dinner top hero band** — clock/date top-right, "Tonight" hero + week meal strip up
  top, agenda fills the body, large touch control bar pinned at the bottom.
- **Display:** 1280×800 landscape (Pi wall) + responsive phone. Wall type scale ≈ 1.6–2× web defaults.

-----

## 1. Design tokens

### 1.1 Colour — surfaces & text (two themes)

| Token | Day (☀) | Night (☾) | Use |
|---|---|---|---|
| `--bg` | `#FAFAF9` | `#0C0A09` | app background |
| `--surface` | `#FFFFFF` | `#1C1917` | cards, sheets, hero band |
| `--surface-2` | `#F5F5F4` | `#292524` | strip cells, hover/idle fills |
| `--border` | `#E7E5E4` | `#292524` | hairlines, dividers |
| `--text` | `#1C1917` | `#F5F5F4` | primary text |
| `--text-muted` | `#78716C` | `#A8A29E` | meta, secondary |
| `--text-faint` | `#A8A29E` | `#57534E` | timestamps, legend |
| `--accent` | `#4F46E5` | `#818CF8` | single accent: today, active control, focus |
| `--accent-weak` | `#EEF2FF` | `#312E81` | accent fills/today column |
| `--ok` | `#16A34A` | `#22C55E` | "live/fresh" dot |
| `--stale` | `#D97706` | `#F59E0B` | "stale data" dot/amber |

Stone-based neutrals (warm grey) keep the calm/editorial feel; the single indigo accent is the only
"brand" colour. **Night theme also drops the panel's software backlight** (see §7).

### 1.2 Colour — categories (colourblind-safe, never the sole encoding)

Palette = **Okabe–Ito** (distinguishable for protan/deutan/tritan vision). Every chip pairs colour with
a **label + icon**; **chip text colour is auto-picked black/white by luminance** for ≥ AA contrast on
the fill.

| Category | Hex | Icon (lucide) | Notes |
|---|---|---|---|
| Appointments | `#0072B2` blue | `clipboard-check` | |
| Activities | `#CC79A7` reddish-purple | `sparkles` | |
| School | `#E69F00` orange | `backpack` | |
| Sport | `#009E73` green | `activity` | |
| Dinner | `#D55E00` vermillion | `utensils` | banner-first; strip + agenda accent |
| Uncategorized | `#56B4E9` sky | `circle` | seed fallback (delete-RESTRICT target) |

Categories are user-editable (colour + icon); these are the **seed** values. The colour picker on the
phone shows the Okabe–Ito set as presets + a custom hex field, and **warns if a chosen colour fails AA**
against both themes.

### 1.3 Type

- **Family:** `Inter` (or `Geist`) variable, system-grotesk fallback:
  `Inter, "Geist", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Tabular numbers for the
  clock (`font-variant-numeric: tabular-nums`).
- **Wall scale** (single `--wall-scale` multiplier, default `1`, tunable per room):

| Role | Size / weight | Line |
|---|---|---|
| Clock | 64px / 600, tabular | 1.0 |
| Dinner hero meal | 56px / 700 | 1.05 |
| Date | 26px / 500 | 1.2 |
| Section header ("TODAY", weekday) | 28px / 600, tracking +0.02em, uppercase | 1.1 |
| Event title | 26px / 600 | 1.2 |
| Event time / meta | 22px / 500, muted | 1.2 |
| Week-strip weekday | 18px / 600 uppercase | 1.1 |
| Week-strip meal | 20px / 500 | 1.2 |
| Legend / stale label | 18px / 500, faint | 1.2 |

- **Phone scale:** body 16px, titles 18–20px, headers 22–24px, inputs 16px (≥16 to avoid iOS zoom).

### 1.4 Spacing, radius, elevation, motion

- **Spacing scale:** 4 · 8 · 12 · 16 · 24 · 32 · 48 (px). Wall uses the upper half; phone the lower.
- **Radius:** `--r-sm 8` · `--r-md 14` · `--r-lg 20` · `--r-pill 999`. Cards/sheets `--r-lg`; chips
  `--r-md`; buttons `--r-pill` on the wall.
- **Elevation:** minimal. Day: `0 1px 2px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.04)`. Night: rely on
  `--surface` contrast + hairline borders, almost no shadow.
- **Touch targets:** **wall primary ≥ 72px, secondary ≥ 64px**; phone ≥ 48px.
- **Motion:** 200–280ms `cubic-bezier(.2,.8,.2,1)`. Idle→default is a **600ms cross-fade** (no slide/
  flash). Respect `prefers-reduced-motion`. Nothing on the wall pulses or grabs attention except the
  ticking clock.

-----

## 2. Wall layout — annotated (1280 × 800)

Default = **Agenda (Wall view)**. Three zones: **Hero band 200px**, **Agenda body 528px**,
**Control bar 72px**.

```
 0                                                                            1280
 ┌──────────────────────────────────────────────────────────┬───────────────┐  0
 │  HERO BAND  (h 200, --surface, bottom hairline)            │  CLOCK CLUSTER │
 │                                                            │  (w ≈ 360)     │
 │   TONIGHT                                                   │      19:42     │  clock 64
 │   ░░ utensils ░░  Tacos al Pastor          (hero meal 56)   │  Sat 31 May    │  date 26
 │                                                            │   ● live       │  status dot
 │   ┌────┬────┬────┬────┬────┬────┬────┐  week meal strip     │  (or ◐ stale   │
 │   │MON │TUE │WED★│THU │FRI │SAT │SUN │  (today ★ = accent)  │   last 19:38)  │
 │   │Pie │Stir│Tac│ —  │Fish│BBQ │Roast  meal 20 / day 18     │                │
 │   └────┴────┴────┴────┴────┴────┴────┘                      │                │
 ├──────────────────────────────────────────────────────────┴───────────────┤ 200
 │  AGENDA BODY  (h 528, scrollable, full-width rows)                          │
 │                                                                            │
 │   TODAY · Saturday 31 May            ← section header 28, accent underline   │
 │   ┌────────────────────────────────────────────────────────────────────┐  │
 │   │ ▌ 09:00   School run            🎒 School         Kiss & Ride        │  │ row ≥ 88
 │   │ ▌ 16:00   Swimming squad        ⚡ Sport          Aqua Centre        │  │  4px colour
 │   │ ▌ 18:30   Tacos                 🍽 Dinner                            │  │  bar = ▌
 │   └────────────────────────────────────────────────────────────────────┘  │
 │   TOMORROW · Sunday 1 June                                                  │
 │   ┌────────────────────────────────────────────────────────────────────┐  │
 │   │ ▌ ALL DAY Dad away (Brisbane)   📋 Appointments                      │  │
 │   │ ▌ 10:00   Soccer v Lions        ⚡ Sport          Field 3            │  │
 │   └────────────────────────────────────────────────────────────────────┘  │
 │   MON 2 JUN · TUE 3 JUN … (next days continue, lazy)                        │
 ├────────────────────────────────────────────────────────────────────────────┤ 728
 │  CONTROL BAR (h 72, --surface-2)                                            │
 │   [ Agenda ]  [ Week ]  [ Month ]            legend ●App ●Sch ●Sport   [ + ]│
 │    ↑ segmented, active=accent (targets 72)                       quick-add  │
 └────────────────────────────────────────────────────────────────────────────┘ 800
```

**Hero band rules**
- "Tonight" is the hero. Meal name 56px; if none set → inviting **"No dinner planned — tap to add"** in
  `--text-muted` (height stays reserved; **never reflow**). After ~20:00, "Tonight" rolls to **tomorrow's**
  meal with a small "Tomorrow" eyebrow so evening prep is useful.
- Week strip: 7 equal cells, **today cell uses `--accent-weak` fill + ★**; empty days show a thin "—".
- Clock cluster top-right: 64px tabular clock (minute-accurate, second hand optional), date below, and
  the **status dot**: `--ok` "live" when fresh; `--stale` amber "last HH:MM" when cache is > ~2 min old.
  The ticking clock is the always-alive signal.

**Agenda body rules**
- Grouped by day (`TODAY`, `TOMORROW`, then `WEEKDAY D MON`). Each event is a **full-width row ≥ 88px**:
  4px **category colour bar** on the left + **time** + **title (26px)** + **category chip (icon+label)**
  + optional location (muted). One line, **ellipsis** on overflow (full text in the day-detail sheet).
- All-day events sort first per day with an `ALL DAY` time slug.
- Tapping a row or day header opens the **Day-detail sheet** (§4) — never tiny in-grid selection.
- Many events: the day group scrolls within the body; a day count (e.g. "5 events") shows in Week/Month
  cells instead of unreadable mini-chips.

**Control bar rules**
- Segmented **Agenda / Week / Month** view switcher (active = accent), bottom-anchored (standing reach,
  not above kids' eye line). Compact **legend** centre. Big **`+` quick-add** right.
- **Week** = `timeGridWeek`, **Month** = `dayGridMonth` (FullCalendar, free plugins) — restyled to the
  tokens, today high-contrast, chips carry colour **+ label/icon**. These are "zoom out", not the rest
  state.

-----

## 3. Phone layout — annotated (responsive, `PhoneLayout`)

Read + edit on the LAN. Portrait-first; same data layer as the wall, different composition.

```
 HOME (agenda)                 EVENT EDITOR (sheet)          MANAGE (categories/dinner)
 ┌───────────────────────┐     ┌───────────────────────┐    ┌───────────────────────┐
 │ Sat 31 May      ● live │     │  ✕      New event   ✓ │    │  ☰  Categories        │
 ├───────────────────────┤     ├───────────────────────┤    ├───────────────────────┤
 │ 🍽 TONIGHT            │     │ Title                  │    │ ●  Appointments   ✎   │
 │    Tacos al Pastor    │     │ [ Swimming squad     ] │    │ ●  Activities     ✎   │
 │    [ Set / change ]   │     │                        │    │ ●  School         ✎   │
 ├───────────────────────┤     │ Category               │    │ ●  Sport          ✎   │
 │ TODAY                 │     │ [●App][●Sch][●Sport]…  │    │ ●  Dinner         ✎   │
 │ ▌09:00 School run  🎒 │     │   big colour chips     │    │ [ + Add category ]    │
 │ ▌16:00 Swimming    ⚡ │     │                        │    ├───────────────────────┤
 │ ▌18:30 Tacos       🍽 │     │ ▢ All day              │    │  Dinner — this week   │
 │ TOMORROW              │     │ Start [31 May] [16:00] │    │ Mon  Pie       ✎      │
 │ ▌10:00 Soccer      ⚡ │     │ End   [31 May] [17:00] │    │ Tue  Stir-fry  ✎      │
 │ …                     │     │ Repeat [Weekly ▾]      │    │ Wed★ Tacos     ✎      │
 │                       │     │   until [ 31 Dec ]     │    │ Thu  —    [add]       │
 │                  [ + ]│     │ Location [ Aqua… ]     │    │ …                     │
 ├───────────────────────┤     │                        │    └───────────────────────┘
 │  Agenda  Week  Manage │     │ [ Delete ]  (edit only)│
 └───────────────────────┘     └───────────────────────┘
```

**Phone rules**
- **Repeat** offers none/daily/weekly/monthly **with a required end** (`until`/count) — generated RRULE
  always bounded (spec §0). Editing a recurring event asks **"This event / This and following / All"**;
  deleting one instance hits `DELETE /api/events/:id/occurrences/:date` (cancel-occurrence).
- Colour picker = Okabe–Ito presets + custom hex, **AA contrast warning** against both themes.
- Inputs ≥ 16px; native date/time pickers; targets ≥ 48px; the editor is a bottom sheet, not a route
  push, so context is preserved.
- Phone may use the **softer** end of the palette/elevation; the wall stays high-contrast.

-----

## 4. Component inventory (shared primitives)

| Component | Wall | Phone | Notes |
|---|---|---|---|
| `Clock` | 64px tabular | small header | always live; alive-signal |
| `StatusDot` | hero cluster | header | `live` / `stale HH:MM` from SW cache age |
| `DinnerHero` | 56px hero + roll-over | card | reserved height, empty CTA |
| `WeekMealStrip` | 7 cells, today ★ | weekly list (Manage) | tap cell → set dinner |
| `EventRow` | ≥88px agenda row | list row | colour bar + time + title + `CategoryChip` + location |
| `CategoryChip` | icon + label + colour | icon + label | **colour never alone**; auto fg by luminance |
| `DayDetailSheet` | tap-out modal | full sheet | big rows, full (non-truncated) text |
| `QuickAddSheet` | title+category+day | — | wall fast path; richer edit → "do it on your phone" |
| `EventEditor` | (not on wall) | bottom sheet | full fields + recurrence scope |
| `ViewSwitcher` | segmented bar | tabs | Agenda default; Week/Month opt-in |
| `Legend` | compact | — | de-emphasised (chips self-label) |
| `CategoryManager` | — | list + colour/icon | delete blocked (409) with count + reassign |

-----

## 5. States (designed, not incidental)

| State | Wall behaviour |
|---|---|
| **First cold load, no cache** | App shell + live clock + theme paint immediately; a calm "Loading today…" placeholder in the agenda only (never a full-screen spinner, never Chromium error). |
| **Server down / fetch fail** | Serve **last-good** from the service worker; switch `StatusDot` to **amber "last HH:MM"**. No banner, no modal, no blank. |
| **Empty day** | "Nothing scheduled" in `--text-muted`, dinner still prominent — a clear day reads as good news. |
| **No dinner set** | Hero shows "No dinner planned — tap to add"; height reserved (no jump). |
| **Long titles** | One line, ellipsis; full text in `DayDetailSheet`. |
| **Many events / overlap** | Agenda day group scrolls; Week/Month show "N events" counts, not micro-chips. |
| **Failed wall quick-add** | Optimistic row appears immediately; quiet retry; reconcile on next SSE poke. |
| **Idle (~60–120s no touch)** | Cross-fade (600ms) back to **Agenda + today** (reset view *and* date). |

-----

## 6. Accessibility (hard requirements)

- **Never colour-only:** every event carries label + icon (§1.2). Verified against a deuteranopia
  simulation in review.
- **Contrast:** AA (4.5:1) minimum everywhere; **AAA (7:1) target on the wall** for primary text given
  distance + glare. Chip text auto-chooses black/white per fill luminance.
- **Distance legibility:** wall type scale ≈ 1.6–2× defaults via `--wall-scale`; event/body ≥ 24px,
  headers ≥ 40px-equiv, dinner hero ≥ 56px, clock 64px.
- **Touch:** wall ≥ 72/64px, phone ≥ 48px; no hover-only affordance (audit FullCalendar tooltips/
  "+more" → replace with tap→sheet).
- **Reduced motion** honoured; **night theme** lowers luminance + backlight to avoid a glowing wall.

-----

## 7. Theming mechanics (auto day/night)

- Single `data-theme="day|night"` on `<html>` driving the §1.1 token sets; all components read tokens.
- **Switch trigger:** time-of-day schedule (e.g. day 06:30–19:30, night otherwise) — configurable; if
  the panel exposes an ambient-light reading later, prefer lux. Transition is a **gentle 600ms
  cross-fade** of the token values, not an instant flip.
- **Backlight:** at night, also lower the panel's software backlight (ties into the v2 "night dimming"
  note) so the wall doesn't light the room.
- **Phone** follows the OS `prefers-color-scheme` (independent of the wall schedule).
- Kiosk URL `?mode=wall` forces `WallLayout` + the wall scale regardless of viewport (don't infer wall
  from width — the Pi reports 1280×800 which a width breakpoint could mis-bucket).

-----

## 8. Build notes for M2/M3

- Tokens as CSS custom properties + a thin Tailwind theme extension mapping to them (so utilities and
  raw CSS both resolve to the same variables); `data-theme` swaps the values.
- Restyle FullCalendar via CSS variables / `eventContent` render hooks to emit `CategoryChip` (colour +
  icon + label) rather than default chips; force free plugins only (`dayGridMonth`, `timeGridWeek`,
  `timeGridDay`).
- The custom **Wall agenda view** is a plain React component over the same expanded-occurrence payload —
  not a FullCalendar view — so it's fully controllable for distance legibility.
- Service worker caches the shell + last `/api/events|dinners|categories` payloads; `StatusDot` reads
  cache timestamp to decide live/stale.
- Ship one **annotated Figma-or-equivalent is optional** — this doc + the ASCII zones are the source of
  truth; keep px/zone numbers in sync if they change.
```
