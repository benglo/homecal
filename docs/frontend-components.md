# Family Calendar — Component & Build Architecture (locked)

Companion to `family-calendar-build-spec.md` (v2) and `docs/frontend-design.md`. This doc is the
**engineering blueprint** for the frontend: which prebuilt library we use, where we *don't* use it, the
full component tree, props/contracts, data flow, and the build order. The mockup at
`docs/mockups/family-calendar.html` is the visual source of truth; this is how we turn it into React.

-----

## 0. The calendar-library decision (locked)

**We use a prebuilt React calendar for the grid views, and hand-build the agenda.**

| View | Implementation | Why |
|---|---|---|
| **Week** | **FullCalendar** `timeGridWeek` | Time-axis layout, overlap resolution, all-day lane, current-time indicator are non-trivial — let the library own them. |
| **Month** | **FullCalendar** `dayGridMonth` | 6-week grid, day-overflow "+N more", out-of-month days — library territory. |
| **Agenda (wall default)** | **Custom React component** (`AgendaView`) | The library's `listWeek` can't hit our distance-legibility bar (≥24px rows, colour-bar + icon+label chips, day grouping with TODAY/TOMORROW). We render plain JSX over the same payload — full control. |

**Library:** [`@fullcalendar/react`](https://fullcalendar.io/docs/react) v6, **MIT/open-source plugins
only**. No premium plugins (`resourceTimeline`, `scrollGrid`, `multiMonth`, `adaptive`) — they require a
paid licence and we never need them. Pin the version; self-host (no CDN — the LAN runs offline).

```
@fullcalendar/react      @fullcalendar/daygrid     (dayGridMonth)
@fullcalendar/core       @fullcalendar/timegrid    (timeGridWeek/Day)
                         @fullcalendar/interaction (dateClick/select → quick-add & taps)
```

**Why not a different library?** `react-big-calendar` (also capable) was not chosen: FullCalendar has
stronger touch handling, a cleaner `eventContent` render hook for our custom chips, and first-class
all-day handling. Decision is locked; don't relitigate.

**Why not FullCalendar for *everything* (incl. agenda)?** Its `listWeek` view is a compact desktop list
— wrong type scale, wrong grouping, no dinner-aware styling, hard to push to 24px+ rows cleanly. The
agenda is the **default wall view** and the product's main glance surface, so it gets a bespoke
component. This split is the single most important architectural call in the frontend.

-----

## 1. Tech & libraries

| Concern | Choice | Notes |
|---|---|---|
| Framework | React 18 + TypeScript | |
| Build | Vite | single-origin static output served by the backend |
| Styling | Tailwind CSS + CSS custom properties | tokens from `frontend-design.md` as CSS vars; Tailwind theme maps to them; `data-theme` swaps values |
| Calendar grid | `@fullcalendar/react` v6 (MIT) | week + month only |
| Data fetching | TanStack Query (`@tanstack/react-query`) | caching, refetch-on-poke, stale handling, retry/backoff |
| Dates | `luxon` | fixed `Australia/Brisbane` zone, UTC↔local at the edge only |
| Recurrence | (server-side) `rrule` | frontend never expands; it consumes expanded occurrences |
| Icons | `lucide-react` | category icons + UI glyphs (tree-shaken) |
| Realtime | native `EventSource` (SSE) | "poke → invalidate query"; 60s fallback poll |
| Offline | Service Worker (Workbox or hand-rolled) | shell + last-good API cache (never-blank) |
| Forms | React Hook Form + Zod | phone editor validation mirrors the API schema |
| State | TanStack Query + minimal local UI state | no Redux; server cache *is* the state |

**Fonts:** Geist + Geist Mono, **self-hosted** (`@fontsource/geist-sans`, `@fontsource/geist-mono`) —
no Google Fonts CDN, because the wall must work with the internet unplugged.

-----

## 2. App-level architecture

### 2.1 Two layouts, one app

```
main.tsx
 └─ <AppProviders>            (QueryClient, ThemeProvider, ApiProvider, SSE/poll bridge)
     └─ <ModeRouter>          reads ?mode=wall (kiosk flag) — NOT viewport width
         ├─ <WallLayout>      read-mostly, glanceable, 1280×800, forced wall type scale
         └─ <PhoneLayout>     edit-heavy, responsive, OS prefers-color-scheme
```

- `?mode=wall` (set by the Pi kiosk URL) → `WallLayout` + `--wall-scale` + the day/night *schedule*.
- No flag → `PhoneLayout`, following `prefers-color-scheme`.
- **Never infer the wall from screen width** — the Pi reports 1280×800 which a width breakpoint would
  mis-bucket as a laptop.

### 2.2 Shared core (used by both layouts)

```
core/
  api/            typed client (fetch wrapper) + Zod response schemas + error-envelope handling
  hooks/          useEvents, useDinners, useCategories, useRealtime, useStaleness, useIdleReset, useClock, useTheme
  model/          TS types (Category, EventOccurrence, EventMaster, Dinner) — mirror spec §6
  primitives/     CategoryChip, EventRow, DinnerHero, WeekMealStrip, Clock, StatusDot, Sheet, Button…
  calendar/       FullCalendarWeek, FullCalendarMonth, AgendaView, eventContent renderer, fcTheme.css
  util/           luxon helpers (toBrisbane, fmtTime, dayKey), color (fgForBg luminance), icons map
```

-----

## 3. Component tree

### 3.1 Wall (kiosk)

```
<WallLayout>
 ├─ <HeroBand>
 │   ├─ <DinnerHero>          "Tonight" hero + rollover-after-8pm + empty CTA (reserved height)
 │   ├─ <WeekMealStrip>       7 cells, today ★, empty "—"
 │   └─ <ClockCluster>
 │       ├─ <Clock>           live, tabular, minute-accurate
 │       └─ <StatusDot>       hidden when fresh; amber "last HH:MM" only when stale
 ├─ <CalendarSurface view={view}>
 │   ├─ <AgendaView>          ← custom (default)
 │   ├─ <FullCalendarWeek>    ← FullCalendar timeGridWeek
 │   └─ <FullCalendarMonth>   ← FullCalendar dayGridMonth
 │   └─ (tap on event/day) → <DayDetailSheet>
 ├─ <ControlBar>
 │   ├─ <ViewSwitcher>        Agenda · Week · Month  (segmented, active=accent, ≥72px)
 │   ├─ <DateNav>             ‹ Today ›  (step follows view; shares "go home" with idle)
 │   ├─ <Legend>              de-emphasised (chips self-label)
 │   └─ <QuickAddButton>      → <QuickAddSheet>  (also opened by FC select/dateClick)
 └─ <IdleController>          ~90s no-touch → cross-fade to Agenda + today (resets view AND date)
```

### 3.2 Phone

```
<PhoneLayout>
 ├─ <PhoneHeader>            date + (stale indicator only) — no clock, no live dot
 ├─ <TabBar: Agenda | Week | Manage>   (bottom, thumb zone, ≥48px)
 │   ├─ Agenda  → <DinnerCard> + <AgendaView compact>
 │   ├─ Week    → <FullCalendarWeek compact>
 │   └─ Manage  → <CategoryManager> + <DinnerWeekEditor>
 ├─ <Fab>                    floating + (above TabBar) → <EventEditorSheet>; context = Add category on Manage
 └─ Sheets: <EventEditorSheet>, <DinnerEditorSheet>, <CategoryEditorSheet>
```

-----

## 4. Component catalogue

For each: **purpose · props · key behaviour · which mockup section it maps to.**

### 4.1 Shared primitives

#### `CategoryChip`
- **Purpose:** the colour+icon+label token — colour is *never* the only signal.
- **Props:** `category: Category` · `size?: 'wall' | 'phone' | 'mini'`.
- **Behaviour:** background = `mix(category.color, surface)`; text colour auto-picked black/white by
  luminance (`fgForBg`); renders `lucide` icon from `category.icon` + name. `mini` = icon-only square
  (phone agenda rows, month cells).
- **Mockup:** every chip in agenda/week/month + the tokens card.

#### `EventRow`
- **Purpose:** one agenda line (the wall's core unit).
- **Props:** `occ: EventOccurrence` · `onTap(occ)`.
- **Behaviour:** left colour bar (4–5px) · time (or `ALL DAY`) · title (1 line, ellipsis) · `CategoryChip`
  · optional location. ≥88px tall on wall, ~52px on phone. Tap → `DayDetailSheet`/editor.
- **Mockup:** agenda body rows.

#### `DinnerHero`
- **Purpose:** the "Tonight" hero (half the product).
- **Props:** `dinners: Dinner[]` · `now: DateTime` · `onTap()`.
- **Behaviour:** shows *today's* meal; **after 20:00 rolls to tomorrow** with a "Tomorrow" eyebrow.
  Empty → "No dinner planned — tap to add". **Height is reserved** — never reflows when meals come/go.
- **Mockup:** hero band left.

#### `WeekMealStrip`
- **Purpose:** the week's meals at a glance.
- **Props:** `dinners: Dinner[]` · `weekStart: DateTime` · `onTapDay(date)`.
- **Behaviour:** 7 equal cells, today gets `accent-weak` fill + ★, empty days show "—".

#### `Clock`
- **Purpose:** the always-alive signal.
- **Props:** `format?: 'HH:mm'` · `withSeconds?: boolean`.
- **Behaviour:** `useClock()` ticks every 1s; Brisbane zone; tabular numerals. **This is why we removed
  the status badge** — the ticking clock proves the screen is live.

#### `StatusDot`
- **Purpose:** stale-data cue *only*.
- **Props:** `lastUpdated: DateTime | null`.
- **Behaviour:** **renders nothing when fresh.** When the last successful fetch is > ~2min old (served
  from SW cache), shows an amber dot + "last HH:mm". Never red, never a banner, never a spinner.

#### `Sheet`
- **Purpose:** bottom-sheet modal primitive for all editors + `DayDetailSheet`.
- **Props:** `open` · `onClose` · `title` · `actions?` · children.
- **Behaviour:** focus-trap, swipe/tap-out to dismiss, ≥48px controls, preserves background context.

#### `Button` / `ViewSwitcher` / `Legend` / `Fab`
- Standard token-driven controls. `ViewSwitcher` is the segmented Agenda/Week/Month control (wall ≥72px
  targets, bottom-anchored). `Legend` is compact and de-emphasised.

### 4.2 Calendar components

#### `AgendaView`  *(custom — the important one)*
- **Purpose:** the default wall view and phone Agenda tab.
- **Props:** `occurrences: EventOccurrence[]` · `dinners: Dinner[]` · `density: 'wall' | 'phone'` ·
  `daysAhead?: number` (default 10) · `onTapOccurrence`.
- **Behaviour:**
  - Group occurrences by local day; section headers `TODAY` / `TOMORROW` / `WEEKDAY D MON`.
  - Within a day: all-day first, then by start time. Render `EventRow` per occurrence.
  - Optionally inject the day's dinner as a styled row (dimmed) at dinner-time (mockup shows this).
  - Empty day → "Nothing scheduled" (muted), dinner still prominent. Lazy-extend as it scrolls.
- **Not FullCalendar.** Plain JSX → we fully control type scale, spacing, chip rendering.

#### `FullCalendarWeek`
- **Purpose:** time-grid week.
- **Props:** `occurrences` · `date` · `onSelect(range)` · `onEventClick(occ)`.
- **Config (locked):**
  ```ts
  plugins={[timeGridPlugin, interactionPlugin]}
  initialView="timeGridWeek"
  headerToolbar={false}            // we drive nav from <ControlBar>; no built-in chrome
  firstDay={1}                     // Monday
  slotMinTime="06:00" slotMaxTime="22:00"
  nowIndicator allDaySlot
  height="100%" expandRows
  eventContent={renderChip}        // our CategoryChip, not default rendering
  selectable selectMirror
  longPressDelay={250}             // touch select
  select={onSelect}                // → QuickAdd / editor with prefilled range
  eventClick={…→ onEventClick}
  events={toFcEvents(occurrences)} // map occurrences → {id,title,start,end,allDay,extendedProps:{category}}
  eventClassNames / eventDidMount  // colour bar + a11y label
  ```
- **Styling:** override FullCalendar CSS via variables in `fcTheme.css` so it reads from our tokens
  (today highlight = `accent-weak`, hairlines = `--border`, fonts = wall scale). **Audit & remove
  hover-only affordances** (tooltips/popovers) — tap → `DayDetailSheet` instead.

#### `FullCalendarMonth`
- **Purpose:** month grid ("zoom out").
- **Props:** `occurrences` · `date` · `onDateClick(day)` · `onEventClick(occ)`.
- **Config:** `dayGridPlugin + interaction`, `initialView="dayGridMonth"`, `headerToolbar={false}`,
  `firstDay={1}`, `dayMaxEvents={3}` → "+N more", `fixedWeekCount={false}`, `moreLinkClick` →
  `DayDetailSheet` (never the default unreadable popover), same `eventContent={renderChip}`.

#### `renderChip` (eventContent renderer)
- Shared FullCalendar render hook returning our `CategoryChip` markup (colour + icon + label) so week &
  month chips match the agenda and stay colourblind-safe. Single source of chip truth.

### 4.4 Navigation chrome & action controls (per surface)

The interactive shell — **what the family actually touches.** Documented in full because these are the
highest-traffic, most-fat-fingered elements and they differ deliberately between wall and phone.

```
WALL (1280×800)                                   PHONE (portrait)
┌───────────────── HeroBand ─────────────────┐    ┌───── PhoneHeader ─────┐
│  dinner hero · week strip · clock           │    │  date        (stale?) │
├───────────── CalendarSurface ──────────────┤    ├──── CalendarSurface ──┤
│  Agenda / Week / Month                      │    │  Agenda / Week        │
│                                             │    │                  (Fab)│ ← floating
├───────────────── ControlBar (h72) ─────────┤    ├─────── TabBar ────────┤
│ [Agenda|Week|Month]  ‹ today ›  legend  [+] │    │ Agenda · Week · Manage│
└─────────────────────────────────────────────┘   └───────────────────────┘
```

#### Wall — `ControlBar` (bottom-anchored, h72)
- **Purpose:** the only persistent control surface on the wall. Bottom-anchored = standing reach, below
  eye line for kids (top corners are *out*).
- **Layout (left→right):** `ViewSwitcher` · `DateNav` · `Legend` (centre, flexes) · `QuickAddButton`.
- **Targets:** every control **≥ 72px** hit area (visual can be smaller, hit area is padded).
- **Mockup:** the control bar across all three wall views.

##### `ViewSwitcher` (wall)
- **Props:** `value: 'agenda'|'week'|'month'` · `onChange(view)`.
- **Behaviour:** segmented pill, three buttons, active = `--accent` fill + white text (night: ink). Tap
  switches view **only** (does not change the focused date). Keyboard/focus ring for completeness though
  touch is primary. `aria-pressed` per segment.
- **States:** default (muted) · active (accent) · pressed (98% scale, 120ms).

##### `DateNav` (wall) *(new — make nav explicit)*
- **Props:** `date: DateTime` · `view` · `onPrev()` · `onNext()` · `onToday()`.
- **Behaviour:** `‹ prev` / `Today` / `next ›`. Step size follows the view (Agenda paginates by its
  `daysAhead` block, Week by 7d, Month by 1 month). `Today` is disabled/desaturated when already on the
  current period. **The `IdleController` calls `onToday()` + resets view on idle**, so DateNav and idle
  share one "go home" path. Chevrons ≥72px.
- **Note:** the static mockup omits chevrons for cleanliness; in the build they're required so the wall
  isn't stuck on whatever was last tapped.

##### `Legend` (wall)
- **Props:** `categories: Category[]`.
- **Behaviour:** compact, **de-emphasised** (chips already self-label, so the legend is a courtesy, not
  load-bearing). Swatch + short name. Hidden first if the bar gets cramped (Legend is the lowest-priority
  item; ViewSwitcher + QuickAdd never drop).

##### `QuickAddButton` → `QuickAddSheet` (wall)
- **Purpose:** the wall's *fast* create path — standing user, minimal fields.
- **Button:** 60px circular `--accent` `+` (≥72px hit area), bottom-right of the ControlBar.
- **Sheet fields (only):** title · category (big colour-chip row) · day (defaults today) · time
  (defaults all-day or "this evening"). **No recurrence, no location** on the wall — richer edits say
  "do it on your phone." On-screen-keyboard-friendly single text field.
- **Behaviour:** optimistic row appears immediately; quiet retry; reconciles on next SSE poke. A failed
  create never throws a red error on the wall.
- **Also opened by:** FullCalendar `select` (drag a time range in Week) / `dateClick` (Month) →
  `QuickAddSheet` prefilled with that range.

#### Phone — `TabBar` + `Fab`

##### `TabBar` (phone, bottom)
- **Purpose:** primary phone navigation (thumb zone).
- **Tabs:** **Agenda · Week · Manage** (icon + label, ≥48px, active = `--accent`). `Manage` holds
  category + dinner editing (kept off the main two read tabs).
- **Props:** `value` · `onChange(tab)`. `role="tablist"`, `aria-selected` per tab.

##### `Fab` (phone, floating)
- **Purpose:** the phone's primary create action (full editor, unlike the wall's quick-add).
- **Spec:** 54px circular `--accent` `+`, fixed bottom-right, **sits above the TabBar** (offset so it
  doesn't overlap tab targets), `--shadow` elevation, night = ink glyph.
- **Behaviour:** → `EventEditorSheet` (full fields incl. recurrence + location). On Manage tab the Fab
  context-switches to "Add category". Hides while a sheet is open. Honours safe-area inset on notched
  phones.
- **Mockup:** the `+` on phone screen 1 (home) and the editor it opens (screen 2).

##### `PhoneHeader`
- **Purpose:** lightweight top bar — current date + (stale indicator only, per the no-badge decision).
- **Props:** `date` · `lastUpdated`. No clock (phones have their own); no live dot.

#### FullCalendar toolbar (both surfaces) — **disabled**
- `headerToolbar={false}` on Week and Month. We **never** use FullCalendar's built-in nav/title/buttons
  — they're too small, top-anchored, and off-theme. **All** navigation is driven by our `ViewSwitcher` +
  `DateNav` (wall) / `TabBar` + swipe (phone), passing `date`/`view` into the FullCalendar instance via
  its imperative API (`calendarRef.getApi().gotoDate()/changeView()`). This keeps one consistent control
  language across custom Agenda and library grids.

#### Control-state matrix

| Control | Wall | Phone | Min hit | Active style | Opens |
|---|---|---|---|---|---|
| ViewSwitcher | ✓ (Agenda/Week/Month) | Tabs (Agenda/Week/Manage) | 72 / 48 | accent fill | — |
| DateNav | ✓ ‹ Today › | swipe + ‹ › in grid | 72 | — | — |
| Legend | ✓ compact | — | — | — | — |
| Create | QuickAddButton → QuickAddSheet | Fab → EventEditorSheet | 72 / 48 | accent circle | sheet |
| Event tap | → DayDetailSheet | → EventEditorSheet | row | — | sheet |
| Day/header tap | → DayDetailSheet | → day agenda | cell | — | sheet |

### 4.3 Editing components (phone)

#### `EventEditorSheet`
- **Purpose:** create/edit/delete an event.
- **Fields:** title · category (big colour-chip picker) · all-day toggle · start/end (native pickers) ·
  **repeat** (none/daily/weekly/monthly **+ required end** → bounded RRULE) · location.
- **Recurrence editing:** editing/deleting a recurring occurrence prompts **This / This-and-following /
  All**. "This" → `DELETE /events/:id/occurrences/:date` (cancel) or a `modified` exception (v2). "All"
  → master `PUT`. Validation mirrors the API Zod schema; `end ≥ start`; rrule built client-side then
  re-validated server-side.

#### `CategoryManager` / `CategoryEditorSheet`
- List + add/edit categories (name · colour · icon). Colour picker = Okabe–Ito presets + custom hex with
  an **AA-contrast warning** against both themes. **Delete is blocked (409)** when events reference it —
  surface the count + offer "reassign to Uncategorized".

#### `DinnerWeekEditor` / `DinnerEditorSheet`
- Per-day meal set/clear (`PUT`/`DELETE /api/dinners/:date`). Mirrors `WeekMealStrip`.

-----

## 5. Data layer & contracts

### 5.1 Types (mirror spec §6; frontend consumes *expanded* occurrences)

```ts
interface Category { id: string; name: string; color: string; icon?: string; updatedAt: string }

interface EventOccurrence {        // what GET /api/events returns (already expanded)
  id: string;                      // synthetic "masterId:occurrenceISO" for recurring
  masterId: string;                // the underlying event (for "edit series")
  categoryId: string;
  title: string;
  start: string; end: string;      // ISO-8601 UTC
  allDay: boolean;
  location?: string;
  isRecurring: boolean;
  occurrenceDate?: string;         // original occurrence start (for cancel/override)
}

interface EventMaster {            // GET /api/events/:id — for editing a series
  id: string; categoryId: string; title: string;
  start: string; end: string; allDay: boolean; location?: string;
  rrule?: string; updatedAt: string;
}

interface Dinner { date: string; meal: string; updatedAt: string }
```

### 5.2 Hooks (TanStack Query)

| Hook | Wraps | Notes |
|---|---|---|
| `useEvents(windowStart, windowEnd)` | `GET /api/events?start&end` | keyed by window; window derived from current view+date |
| `useEventMaster(id)` | `GET /api/events/:id` | only when opening the series editor |
| `useDinners(weekStart, weekEnd)` | `GET /api/dinners?start&end` | |
| `useCategories()` | `GET /api/categories` | tiny, cached long; drives chips + legend + pickers |
| mutations | POST/PUT/DELETE events·dinners·categories | optimistic update + invalidate on settle |
| `useRealtime()` | `EventSource('/api/stream')` | on any poke → `queryClient.invalidateQueries()` (refetch current window). Reconnect = native; **also refetch on reconnect** (may have missed pokes). |
| `useStaleness()` | query `dataUpdatedAt` | feeds `StatusDot`; > ~2min → stale |
| `useIdleReset(ms)` | pointer/touch listeners | resets view→Agenda + date→today after idle |
| `useClock()` | `setInterval 1s` | Brisbane time for `Clock` |
| `useTheme()` | schedule (wall) / `prefers-color-scheme` (phone) | sets `data-theme`; 600ms cross-fade |

### 5.3 Realtime + resilience flow

```
SSE "poke"  ─► invalidateQueries ─► refetch window ─► UI updates  (≤ instant)
   (if SSE dead behind proxy)  60s fallback poll does the same
fetch fails ─► TanStack serves cached ─► SW serves shell+last API ─► StatusDot goes amber
                                         (wall NEVER blanks; clock keeps ticking)
```

- **Service worker:** precache app shell (HTML/JS/CSS/fonts); runtime cache `GET /api/*` with
  stale-while-revalidate. On boot-with-server-down, SW serves shell + last-good API → wall paints
  immediately (IndexedDB-alone can't do this — the shell itself would fail to load).
- **Error envelope:** the API client distinguishes transient (network/5xx → use cache, stay silent)
  from user errors (400/409 → surface in the editor). Never show a transient error on the wall.

-----

## 6. Theming & tokens (build mechanics)

- All tokens (`frontend-design.md §1`) are CSS custom properties under `:root[data-theme="day|night"]`.
- Tailwind `theme.extend.colors` maps semantic names to `var(--…)` so utilities and raw CSS share one
  source. `data-theme` on `<html>` swaps the whole set; transitions cross-fade 600ms (respect
  `prefers-reduced-motion`).
- `--wall-scale` multiplier applied in `WallLayout` only; phone uses base scale.
- FullCalendar reads the same vars via `fcTheme.css` overrides (today, borders, fonts, event colours).
- Night also drops the panel backlight (kiosk-level; tie into v2 night-dimming).

-----

## 7. File/module layout

```
frontend/
  index.html
  src/
    main.tsx
    AppProviders.tsx
    ModeRouter.tsx
    layouts/ WallLayout.tsx  PhoneLayout.tsx
    components/
      hero/ HeroBand.tsx DinnerHero.tsx WeekMealStrip.tsx ClockCluster.tsx
      calendar/ CalendarSurface.tsx AgendaView.tsx FullCalendarWeek.tsx FullCalendarMonth.tsx
                renderChip.tsx fcTheme.css
      controls/ ControlBar.tsx ViewSwitcher.tsx DateNav.tsx Legend.tsx QuickAddButton.tsx
                TabBar.tsx Fab.tsx PhoneHeader.tsx
      sheets/ Sheet.tsx DayDetailSheet.tsx EventEditorSheet.tsx DinnerEditorSheet.tsx
              CategoryEditorSheet.tsx
      manage/ CategoryManager.tsx DinnerWeekEditor.tsx
      primitives/ CategoryChip.tsx EventRow.tsx Clock.tsx StatusDot.tsx Button.tsx
    core/
      api/ client.ts schemas.ts (zod) endpoints.ts
      hooks/ useEvents.ts useDinners.ts useCategories.ts useRealtime.ts useStaleness.ts
             useIdleReset.ts useClock.ts useTheme.ts
      model/ types.ts
      util/ time.ts (luxon) color.ts (fgForBg) icons.ts
    sw/ service-worker.ts
    styles/ tokens.css tailwind.css
  vite.config.ts  tailwind.config.ts  tsconfig.json
```

-----

## 8. Build order (maps to spec milestones M2/M3)

1. **Tokens + Tailwind wiring + `data-theme`** — port `tokens.css`; verify day/night swap on a blank page.
2. **Primitives** — `CategoryChip`, `EventRow`, `Clock`, `StatusDot`, `Sheet` (Storybook-style page).
3. **Data layer** — api client + Zod + the four read hooks against the live M1 API.
4. **`AgendaView`** (custom) + `HeroBand` (`DinnerHero`, `WeekMealStrip`, `ClockCluster`) →
   **WallLayout default renders** (M2 core).
5. **FullCalendar Week/Month** + `renderChip` + `fcTheme.css` + `ControlBar` chrome (`ViewSwitcher`,
   `DateNav` driving the FC imperative API, `Legend`, `QuickAddButton`). FC built-in toolbar stays off.
6. **Resilience** — service worker (shell + API cache), `useStaleness`, `useRealtime` (SSE+poll),
   `useIdleReset`. **Prove never-blank** (stop server → reload → still renders) = M2 done.
7. **PhoneLayout + editors** (`EventEditorSheet` incl. recurrence scope, `CategoryManager`,
   `DinnerWeekEditor`) = M3.

-----

## 9. Testing notes (frontend)

- **Unit:** `fgForBg` luminance (contrast), `DinnerHero` rollover-after-8pm, agenda day-grouping/sort,
  occurrence→FC-event mapping.
- **Component:** `CategoryChip` renders icon+label (never colour-only — assert text/icon present),
  `StatusDot` hidden when fresh / amber when stale.
- **Integration/e2e (Playwright):** view switch Agenda↔Week↔Month; phone add weekly event → appears on
  wall within refresh; cancel one occurrence removes only that instance; **stop server → wall still
  renders last-good (never-blank)**; idle → resets to Agenda+today.
- **A11y:** AA contrast check on category palette in both themes (CI), deuteranopia spot-check.

-----

## 10. Summary of the key decisions

1. **Prebuilt FullCalendar (MIT) for Week + Month; custom `AgendaView` for the default wall view.**
2. **One app, two layouts** (`WallLayout`/`PhoneLayout`) over a shared core, switched by `?mode=wall`.
3. **Server returns expanded occurrences**; frontend never touches `rrule`. Editing a series fetches the
   master via `GET /api/events/:id`.
4. **TanStack Query is the state**; SSE pokes invalidate; SW makes it never-blank; `StatusDot` is the
   only (stale-only) network cue — the ticking clock is the live signal.
5. **One chip renderer** (`renderChip` → `CategoryChip`) shared across all three views for consistent,
   colourblind-safe events.
```
