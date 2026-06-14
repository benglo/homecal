# P2 — Voice band, tap-to-talk, event_add Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the wall voice assistant a first-class presence — a bottom band showing listening/thinking-transcript/applied-reply, tap-to-talk on the chip, and a new always-confirmed `event_add` intent that creates calendar events by voice.

**Architecture:** A new wall-only `VoiceBand` renders from the existing `voiceState` reducer (extended with a `reply` field on `applied`; `thinking` reuses the existing `transcript_partial`). Tap-to-talk is a fire-and-forget `POST /api/voice/listen` that pokes `voice {kind:'listen_request'}`; the Pi's existing SSE thread sets a `threading.Event` the wake loop honours to bypass the wake word. `event_add` is a normal Haiku intent whose executor handler POSTs to the existing `/api/events`; it is forced through the existing confirm branch by giving it an infinite auto-apply threshold.

**Tech Stack:** React 18 + TS (ESM) + vitest (pure-logic tests only); Fastify + zod + node:test; Python (Pi service) + pytest/requests_mock.

**Branch:** `feat/voice-p2` (off `master` @ `4fd8138`).

**Spec:** `docs/superpowers/specs/2026-06-11-ui-slot-create-voice-desktop-design.md` (P2 section).

**House rules that bind every task:** immutable updates, small focused files, comments explain WHY only, no `console.log`/`print` debug, locale `en-au`, timestamps stored UTC ISO `Z` (Brisbane only at display, fixed UTC+10 no DST), backend CommonJS / frontend ESM / Pi Python. No commit attribution footers (disabled repo-wide).

**Key design decisions baked into this plan (don't relitigate):**
- `event_add` **always confirms** — implemented by `AUTO_APPLY_THRESHOLDS["event_add"] = math.inf`, so it never auto-applies and always falls into the existing `confirming` branch (still silent-fails below `SILENT_FAIL_CONFIDENCE=0.6`). No new confirm machinery.
- Transcript shown in the band reuses the existing `thinking.transcript_partial` field (Pi posts the real transcript there post-STT) — no new state field for transcript.
- Luna's reply shown in the band needs a new `reply?: string` on the `applied` state (the executor's `spoken` text).
- `listen_request` is poked **directly** via `broker.poke('voice', {kind:'listen_request'})` (like `mute_changed`), NOT through `/api/voice/state` — it is not a `VOICE_STATE_KINDS` value and carries no `utterance_id`.
- Voice UI is **wall-only**. No band/chip changes on phone/desktop.

---

## File map

| File | Change |
|---|---|
| `backend/src/routes/voice.ts` | + `POST /api/voice/listen` route |
| `backend/src/routes/voice.test.ts` | + test for the route |
| `frontend/src/core/model/types.ts` | + `event_add` to `ParsedIntent` |
| `frontend/src/components/voice/voiceState.ts` | + `reply` on `applied`; `event_add` in `isParsedIntent`; reducer/parser carry `reply` |
| `frontend/src/components/voice/voiceState.test.ts` | + reply + event_add cases |
| `frontend/src/components/voice/bandView.ts` | NEW pure view-model for the band |
| `frontend/src/components/voice/bandView.test.ts` | NEW tests |
| `frontend/src/components/voice/VoiceBand.tsx` | NEW band component (renders bandView) |
| `frontend/src/components/voice/ConfirmCard.tsx` | + `event_add` in `describe()` |
| `frontend/src/core/api/client.ts` | + `triggerListen()` |
| `frontend/src/core/hooks/useMutations.ts` | + `useTriggerListen()` |
| `frontend/src/components/controls/VoiceChip.tsx` | tap = talk, long-press = mute menu; + `event_add` applied label |
| `frontend/src/layouts/WallLayout.tsx` | render `<VoiceBand>` + pass trigger to chip |
| `kiosk/voice/homecal_voice/main.py` | listen-trigger event; wake-loop bypass; thinking transcript; applied reply; `event_add` threshold |
| `kiosk/voice/homecal_voice/poke_handlers.py` | NEW pure poke classifier (testable) |
| `kiosk/voice/homecal_voice/intent.py` | `event_add` valid + required + prompt |
| `kiosk/voice/homecal_voice/executor.py` | `_event_add` handler |
| `kiosk/voice/homecal_voice/*_test.py` | tests for the above |

---

### Task 1: Backend `POST /api/voice/listen`

**Files:**
- Modify: `backend/src/routes/voice.ts`
- Test: `backend/src/routes/voice.test.ts`

- [ ] **Step 1: Write the failing test** (append to `voice.test.ts`)

```ts
test('POST /api/voice/listen: pokes voice listen_request + 200', async () => {
  const seen: unknown[] = [];
  const off = broker.subscribe((p: { kind: string; payload?: unknown }) => {
    if (p.kind === 'voice') seen.push(p.payload);
  });
  const r = await app.inject({ method: 'POST', url: '/api/voice/listen', headers: PI });
  off();
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { ok: true });
  assert.deepEqual(seen, [{ kind: 'listen_request' }]);
});
```

> Note: confirm the broker's subscribe API name by reading `backend/src/realtime.ts` — it exposes `subscribe(fn)` returning an unsubscribe thunk (the SSE route uses it). If the method differs, match it; the assertion on the poke payload is the point.

- [ ] **Step 2: Run it, expect fail**

Run: `npm --workspace backend test 2>&1 | grep -A3 listen`
Expected: FAIL — route returns 404.

- [ ] **Step 3: Add the route** (in `voice.ts`, beside the existing `/api/voice/state` route)

```ts
  // Tap-to-talk: the wall asks the Pi to start a listen cycle without the wake
  // word. Fire-and-forget — no body, no DB. Poked directly (not via /state)
  // because it carries no utterance_id and isn't a VOICE_STATE_KINDS value.
  app.post('/api/voice/listen', { preHandler: piGuard }, async (_req, reply) => {
    broker.poke('voice', { kind: 'listen_request' });
    reply.code(200).send({ ok: true });
  });
```

> `piGuard` mirrors the `/state` route — the wall already sends the Pi token for voice mutations? Check: `/api/voice/mute` (called by the wall) — confirm whether it uses `piGuard`. The wall is LAN/no-auth in v1; if `/mute` has NO preHandler, drop `preHandler: piGuard` here too so the browser can call it. Match `/api/voice/mute`'s guard exactly.

- [ ] **Step 4: Run it, expect pass**

Run: `npm --workspace backend test 2>&1 | tail -5`
Expected: all pass (201 + 1).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/voice.ts backend/src/routes/voice.test.ts
git commit -m "feat(backend): POST /api/voice/listen pokes a tap-to-talk request"
```

---

### Task 2: Frontend `event_add` type + voiceState `reply`

**Files:**
- Modify: `frontend/src/core/model/types.ts`
- Modify: `frontend/src/components/voice/voiceState.ts`
- Test: `frontend/src/components/voice/voiceState.test.ts`

- [ ] **Step 1: Add the `event_add` variant to `ParsedIntent`** (`types.ts`, inside the union, before `unknown`)

```ts
  | { intent: 'event_add'; title: string; date: string; time?: string; duration_min?: number; category?: string; confidence: number }
```

- [ ] **Step 2: Write failing tests** (append to `voiceState.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { pokeToAction, reduceOverlay } from './voiceState';

describe('event_add intent + applied reply', () => {
  const intent = { intent: 'event_add', title: 'Soccer', date: '2026-06-15', time: '16:00', confidence: 0.7 };

  it('pokeToAction accepts a confirming event_add', () => {
    const a = pokeToAction({ kind: 'confirming', utterance_id: 'u', payload: { intent, transcript: 'add soccer thursday 4pm' } });
    expect(a?.intent?.intent).toBe('event_add');
  });

  it('applied carries the reply text', () => {
    const a = pokeToAction({ kind: 'applied', utterance_id: 'u', payload: { intent, reply: 'Added Soccer on Monday at 4pm.' } });
    const s = reduceOverlay({ kind: 'idle' }, a!);
    expect(s).toEqual({ kind: 'applied', utterance_id: 'u', intent, reply: 'Added Soccer on Monday at 4pm.' });
  });
});
```

- [ ] **Step 3: Run, expect fail**

Run: `cd frontend && npx vitest run src/components/voice/voiceState.test.ts`
Expected: FAIL — `reply` missing on applied; `event_add` rejected by `isParsedIntent`.

- [ ] **Step 4: Implement** (`voiceState.ts`)

In the `OverlayState` union, change the `applied` member:
```ts
  | { kind: 'applied'; utterance_id: string; intent: ParsedIntent; reply?: string }
```
In `OverlayAction`'s `sse` member, add after `reason?: string;`:
```ts
      reply?: string;
```
In `pokeToAction`, add to the `action` object (after the `reason:` line):
```ts
    reply: typeof payload.reply === 'string' ? payload.reply : undefined,
```
In `reduceOverlay`'s `applied` case:
```ts
    case 'applied':
      if (!action.intent) return state;
      return { kind: 'applied', utterance_id: action.utterance_id ?? '?', intent: action.intent, reply: action.reply };
```
In `isParsedIntent`'s switch, add before `case 'unknown':`:
```ts
    case 'event_add':
      return typeof o.title === 'string' && typeof o.date === 'string';
```

- [ ] **Step 5: Run, expect pass**

Run: `cd frontend && npx vitest run src/components/voice/voiceState.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/core/model/types.ts frontend/src/components/voice/voiceState.ts frontend/src/components/voice/voiceState.test.ts
git commit -m "feat(frontend): event_add intent type + reply on applied voice state"
```

---

### Task 3: `bandView` pure view-model

**Files:**
- Create: `frontend/src/components/voice/bandView.ts`
- Test: `frontend/src/components/voice/bandView.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// frontend/src/components/voice/bandView.test.ts
import { describe, it, expect } from 'vitest';
import { bandView } from './bandView';

describe('bandView', () => {
  it('idle → hidden', () => {
    expect(bandView({ kind: 'idle' }).visible).toBe(false);
  });
  it('listening → accent tone + listening line', () => {
    const v = bandView({ kind: 'listening', utterance_id: 'u', vu: 0.4 });
    expect(v).toMatchObject({ visible: true, tone: 'accent', primary: 'Listening…' });
  });
  it('thinking shows the transcript when present', () => {
    const v = bandView({ kind: 'thinking', utterance_id: 'u', transcript_partial: 'add soccer thursday' });
    expect(v).toMatchObject({ visible: true, tone: 'accent', primary: '“add soccer thursday”', secondary: 'thinking…' });
  });
  it('thinking with no transcript yet falls back', () => {
    expect(bandView({ kind: 'thinking', utterance_id: 'u', transcript_partial: '' }).primary).toBe('thinking…');
  });
  it('applied shows the reply in the ok tone', () => {
    const v = bandView({ kind: 'applied', utterance_id: 'u', intent: { intent: 'event_add', title: 'Soccer', date: '2026-06-15', confidence: 1 }, reply: 'Added Soccer.' });
    expect(v).toMatchObject({ visible: true, tone: 'ok', primary: 'Added Soccer.' });
  });
  it('failed → warn tone', () => {
    expect(bandView({ kind: 'failed', utterance_id: 'u', reason: 'no' })).toMatchObject({ visible: true, tone: 'warn' });
  });
  it('confirming is owned by ConfirmCard, band stays hidden', () => {
    expect(bandView({ kind: 'confirming', utterance_id: 'u', intent: { intent: 'event_add', title: 'X', date: '2026-06-15', confidence: 0.7 }, transcript: 't' }).visible).toBe(false);
  });
  it('offline kinds hide the band (chip shows the status)', () => {
    expect(bandView({ kind: 'mic_offline' }).visible).toBe(false);
    expect(bandView({ kind: 'voice_offline' }).visible).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `cd frontend && npx vitest run src/components/voice/bandView.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// frontend/src/components/voice/bandView.ts
import type { OverlayState } from './voiceState';

export type BandTone = 'accent' | 'ok' | 'warn';

export interface BandView {
  visible: boolean;
  tone: BandTone;
  /** Main line — the transcript while thinking, the reply when applied. */
  primary: string;
  /** Sub-line, e.g. "thinking…". Empty when not needed. */
  secondary: string;
  /** Whether to show the animated listening waveform. */
  showVu: boolean;
}

const HIDDEN: BandView = { visible: false, tone: 'accent', primary: '', secondary: '', showVu: false };

/** Pure view-model for VoiceBand. The band is the wall's active-voice surface;
 *  `confirming` is rendered by ConfirmCard and the offline/idle states by the
 *  chip, so the band stays hidden for those. */
export function bandView(state: OverlayState): BandView {
  switch (state.kind) {
    case 'listening':
      return { visible: true, tone: 'accent', primary: 'Listening…', secondary: '', showVu: true };
    case 'thinking': {
      const t = state.transcript_partial.trim();
      return t
        ? { visible: true, tone: 'accent', primary: `“${t}”`, secondary: 'thinking…', showVu: false }
        : { visible: true, tone: 'accent', primary: 'thinking…', secondary: '', showVu: false };
    }
    case 'applied':
      return { visible: true, tone: 'ok', primary: state.reply?.trim() || 'Done', secondary: '', showVu: false };
    case 'failed':
      return { visible: true, tone: 'warn', primary: "Didn't catch that", secondary: '', showVu: false };
    case 'idle':
    case 'confirming':
    case 'mic_offline':
    case 'voice_offline':
      return HIDDEN;
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd frontend && npx vitest run src/components/voice/bandView.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/voice/bandView.ts frontend/src/components/voice/bandView.test.ts
git commit -m "feat(frontend): pure bandView view-model for the voice band"
```

---

### Task 4: `VoiceBand` component

**Files:**
- Create: `frontend/src/components/voice/VoiceBand.tsx`

No unit test (DOM component; repo tests pure logic — `bandView` is the tested core). Verified by `tsc` + manual.

- [ ] **Step 1: Create the component**

```tsx
// frontend/src/components/voice/VoiceBand.tsx
import { Mic, Loader2, Check, AlertCircle } from 'lucide-react';
import type { OverlayState } from './voiceState';
import { bandView, type BandTone } from './bandView';

const TONE_COLOR: Record<BandTone, string> = {
  accent: 'var(--accent)',
  ok: 'var(--ok)',
  warn: 'var(--warn, #d97706)',
};

/** Wall-only active-voice band. Slides up over the ControlBar while voice is
 *  active and collapses (renders nothing) when idle. The persistent status
 *  pill + mute live in VoiceChip; the yes/no card is ConfirmCard. */
export function VoiceBand({ state }: { state: OverlayState }) {
  const v = bandView(state);
  if (!v.visible) return null;

  const color = TONE_COLOR[v.tone];
  const Icon = state.kind === 'applied' ? Check : state.kind === 'failed' ? AlertCircle : state.kind === 'thinking' ? Loader2 : Mic;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex shrink-0 items-center gap-4 border-t"
      style={{
        minHeight: 72,
        padding: '0 24px',
        background: 'var(--surface-2)',
        borderColor: color,
        borderTopWidth: 2,
      }}
    >
      <Icon
        size={22}
        color={color}
        style={{ flexShrink: 0, animation: state.kind === 'thinking' ? 'spin 1s linear infinite' : v.showVu ? 'voicePulse 1.2s var(--ease) infinite' : undefined }}
      />
      {v.showVu && <Waveform color={color} />}
      <span className="flex-1 min-w-0 truncate" style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>
        {v.primary}
      </span>
      {v.secondary && (
        <span style={{ fontSize: 14, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{v.secondary}</span>
      )}
    </div>
  );
}

/** Five bars pulsing on a stagger — a "hearing you" affordance, not a real VU meter. */
function Waveform({ color }: { color: string }) {
  return (
    <span className="flex items-center gap-1" aria-hidden="true" style={{ height: 20 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          style={{
            width: 3,
            height: 16,
            borderRadius: 2,
            background: color,
            animation: `voiceBar 0.9s ${i * 0.12}s ease-in-out infinite`,
            transformOrigin: 'center',
          }}
        />
      ))}
    </span>
  );
}
```

- [ ] **Step 2: Add the `voiceBar` keyframes** to `frontend/src/styles/` (find where `voicePulse`/`spin` are defined — search `@keyframes voicePulse`). Add beside it:

```css
@keyframes voiceBar {
  0%, 100% { transform: scaleY(0.4); }
  50% { transform: scaleY(1); }
}
```

> If `voicePulse`/`spin` live in `index.css` or a tokens file, add `voiceBar` in the same file. Run: `grep -rn "@keyframes voicePulse" frontend/src` to locate it.

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/voice/VoiceBand.tsx frontend/src/styles
git commit -m "feat(frontend): VoiceBand component for active-voice presence"
```

---

### Task 5: `triggerListen` API + hook

**Files:**
- Modify: `frontend/src/core/api/client.ts`
- Modify: `frontend/src/core/hooks/useMutations.ts`

- [ ] **Step 1: Add the client method** (`client.ts`, in the `// voice` group)

```ts
  triggerListen: () => send<{ ok: true }>('POST', '/api/voice/listen'),
```

- [ ] **Step 2: Add the hook** (`useMutations.ts`, beside `useMuteVoice`)

```ts
/** Tap-to-talk: ask the Pi (via the backend poke) to start a listen cycle.
 *  Fire-and-forget; the resulting state changes arrive over the voice SSE. */
export function useTriggerListen() {
  return useMutation({ mutationFn: () => api.triggerListen() });
}
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/core/api/client.ts frontend/src/core/hooks/useMutations.ts
git commit -m "feat(frontend): triggerListen API + useTriggerListen hook"
```

---

### Task 6: VoiceChip — tap-to-talk + long-press mute + event_add label

**Files:**
- Modify: `frontend/src/components/controls/VoiceChip.tsx`

Current behaviour: tap toggles the mute-presets dropdown (when unmuted) / unmutes (when muted). New: a **tap** triggers listening; a **long-press (500ms)** opens the mute menu. Muted tap still unmutes. Offline still inert.

- [ ] **Step 1: Add the event_add applied label** — in `appliedLabel(intent)`'s switch, add before `case 'unknown':`

```ts
    case 'event_add': return `added ${intent.title}`;
```

- [ ] **Step 2: Wire the trigger + press detection.** At the top of `VoiceChip`, add the hook beside `const mute = useMuteVoice();`:

```ts
  const trigger = useTriggerListen();
```
(and import it: `import { useMuteVoice, useTriggerListen } from '../../core/hooks/useMutations';`)

Add a long-press timer ref near the other refs:
```ts
  const longPress = useRef(false);
  const pressTimer = useRef<number | null>(null);
```

Replace `handleClick` and wire pointer handlers. Replace the existing `handleClick` with:
```ts
  const startPress = () => {
    if (offline || muted) return; // muted/offline handled on release
    longPress.current = false;
    pressTimer.current = window.setTimeout(() => {
      longPress.current = true;
      setOpen(true); // long-press → mute presets
    }, 500);
  };
  const endPress = () => {
    if (pressTimer.current !== null) { window.clearTimeout(pressTimer.current); pressTimer.current = null; }
  };
  const handleClick = () => {
    if (offline) return;
    if (muted) { mute.mutate(null); setOpen(false); return; }
    if (longPress.current) { longPress.current = false; return; } // long-press already opened the menu
    if (open) { setOpen(false); return; }
    trigger.mutate(); // tap → start listening
  };
```

On the chip `<button>`, add: `onPointerDown={startPress} onPointerUp={endPress} onPointerLeave={endPress}` (keep `onClick={handleClick}`).

> Rationale comment to include above `startPress`: tap = talk, long-press = mute menu; both share the one chip so the wall corner stays uncluttered.

- [ ] **Step 3: Type-check + suite**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: clean; all pass (existing VoiceChip label tests still green — `appliedLabel`/`labelFor` exports unchanged).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/controls/VoiceChip.tsx
git commit -m "feat(frontend): chip tap-to-talk + long-press mute; event_add label"
```

---

### Task 7: ConfirmCard event_add summary

**Files:**
- Modify: `frontend/src/components/voice/ConfirmCard.tsx`

- [ ] **Step 1: Add event_add to `describe()`** — before `case 'unknown':`

```ts
    case 'event_add': {
      const when = intent.time ? `${intent.date} ${intent.time}` : intent.date;
      return `Add “${intent.title}” — ${when}`;
    }
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean (switch now exhaustive over the extended union).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/voice/ConfirmCard.tsx
git commit -m "feat(frontend): ConfirmCard summarises event_add"
```

---

### Task 8: Render VoiceBand on the wall

**Files:**
- Modify: `frontend/src/layouts/WallLayout.tsx`

- [ ] **Step 1: Import + render.** Add the import:
```tsx
import { VoiceBand } from '../components/voice/VoiceBand';
```
Render the band **directly above** the `<ControlBar … />` (so it sits between the calendar surface and the control bar, sliding up over it visually):
```tsx
      <VoiceBand state={overlay} />
      <ControlBar
        view={view}
        ...
      />
```
(`overlay` is the existing `useReducer` state already in `WallLayout`.)

- [ ] **Step 2: Type-check + suite**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: clean; all pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/layouts/WallLayout.tsx
git commit -m "feat(frontend): mount VoiceBand on the wall"
```

---

### Task 9: Pi — pure poke classifier

**Files:**
- Create: `kiosk/voice/homecal_voice/poke_handlers.py`
- Test: `kiosk/voice/homecal_voice/poke_handlers_test.py`

The SSE thread currently inlines poke handling. Extract the classification so it's testable, then the thread + wake loop consume it.

- [ ] **Step 1: Write failing tests**

```python
# kiosk/voice/homecal_voice/poke_handlers_test.py
from homecal_voice.poke_handlers import classify_poke

def test_listen_request_is_a_trigger():
    assert classify_poke({"kind": "voice", "payload": {"kind": "listen_request"}}) == "listen"

def test_voice_state_invalidates_mute():
    assert classify_poke({"kind": "voice", "payload": {"kind": "mute_changed"}}) == "mute"

def test_voice_state_without_listen_is_mute_refresh():
    # any non-listen voice poke just means "re-check mute cache" (current behaviour)
    assert classify_poke({"kind": "voice", "payload": {"kind": "applied"}}) == "mute"

def test_non_voice_poke_ignored():
    assert classify_poke({"kind": "events"}) is None
    assert classify_poke({}) is None
    assert classify_poke("garbage") is None
```

- [ ] **Step 2: Run, expect fail**

Run: `cd kiosk/voice && python -m pytest homecal_voice/poke_handlers_test.py -q`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```python
# kiosk/voice/homecal_voice/poke_handlers.py
"""Pure classification of SSE pokes for the Pi voice service.

Kept side-effect-free so the SSE thread's reaction (set a trigger Event /
invalidate the mute cache) is trivially testable without a live stream.
"""
from typing import Literal, Optional

PokeAction = Literal["listen", "mute"]


def classify_poke(poke: object) -> Optional[PokeAction]:
    """Return what a received poke means to the Pi, or None to ignore it.

    - "listen": the wall tapped tap-to-talk → start a listen cycle.
    - "mute":   any other voice poke → re-check the mute cache (existing
                behaviour; mute_changed and state echoes both land here).
    """
    if not isinstance(poke, dict):
        return None
    if poke.get("kind") != "voice":
        return None
    payload = poke.get("payload")
    if isinstance(payload, dict) and payload.get("kind") == "listen_request":
        return "listen"
    return "mute"
```

- [ ] **Step 4: Run, expect pass**

Run: `cd kiosk/voice && python -m pytest homecal_voice/poke_handlers_test.py -q`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add kiosk/voice/homecal_voice/poke_handlers.py kiosk/voice/homecal_voice/poke_handlers_test.py
git commit -m "feat(pi): pure poke classifier (listen vs mute-refresh)"
```

---

### Task 10: Pi — SSE thread sets a listen trigger

**Files:**
- Modify: `kiosk/voice/homecal_voice/main.py`

- [ ] **Step 1: Add a module-level trigger Event** near the other module globals (`_mute_state`, `_shutdown`):

```python
# Set by the SSE thread when the wall taps tap-to-talk; consumed (and cleared)
# by run_once to start a listen cycle without the wake word.
_listen_trigger = threading.Event()
```

- [ ] **Step 2: Use the classifier in `_start_mute_sse`.** Replace the inner poke-handling block:

```python
                            try:
                                import json as _json
                                from homecal_voice.poke_handlers import classify_poke
                                action = classify_poke(_json.loads(line[6:].decode()))
                                if action == "listen":
                                    _listen_trigger.set()
                                elif action == "mute":
                                    _mute_state["checked_at"] = 0.0
                            except Exception:
                                pass
```

- [ ] **Step 3: Verify import** — `threading` is already imported in `main.py` (the SSE thread uses it). Type-check by running the Pi test suite:

Run: `cd kiosk/voice && python -m pytest -q 2>&1 | tail -5`
Expected: existing tests still pass (no behavioural change yet — the trigger is set but not consumed until Task 11).

- [ ] **Step 4: Commit**

```bash
git add kiosk/voice/homecal_voice/main.py
git commit -m "feat(pi): SSE thread sets a listen trigger on tap-to-talk poke"
```

---

### Task 11: Pi — wake loop honours the trigger

**Files:**
- Modify: `kiosk/voice/homecal_voice/main.py`

The `run_once` loop breaks on wake-word detection. It must also break when `_listen_trigger` is set — but only when not muted, and it must clear the trigger so it fires once.

- [ ] **Step 1: Modify the `run_once` loop** (lines ~183-189):

```python
    while True:
        f = d.next_frame()
        if d.muted():
            # Drop any trigger that arrived while muted — tap-to-talk must not
            # queue up and fire the instant the user unmutes.
            _listen_trigger.clear()
            continue
        if _listen_trigger.is_set():
            _listen_trigger.clear()
            break
        if d.wake.step(f):
            break
```

- [ ] **Step 2: Run the suite**

Run: `cd kiosk/voice && python -m pytest -q 2>&1 | tail -5`
Expected: pass. (If a `run_once` test injects frames, the trigger defaults clear/unset so wake-word path is unchanged.)

- [ ] **Step 3: Commit**

```bash
git add kiosk/voice/homecal_voice/main.py
git commit -m "feat(pi): run_once starts a cycle on tap-to-talk trigger (bypasses wake word)"
```

---

### Task 12: Pi — thinking transcript + applied reply

**Files:**
- Modify: `kiosk/voice/homecal_voice/main.py`

The band shows the transcript (thinking) and Luna's reply (applied). The transcript is known only after STT, so re-post `thinking` with it; add the reply to the `applied` payload.

- [ ] **Step 1: Re-post thinking with the transcript** — in `_run_after_wake`, immediately after the blank/hallucination filters pass (right before `intent = d.extract_intent(transcript)`, ~line 356), add:

```python
    # Surface what we heard on the wall band now that STT is done (the earlier
    # thinking post had no transcript yet).
    d.post_state(utterance_id=uid, kind="thinking", payload={"transcript_partial": transcript})
```

- [ ] **Step 2: Add the reply to applied** — in `_try_execute`, change the applied post (~line 413):

```python
        d.post_state(utterance_id=uid, kind="applied",
                     payload={"intent": _intent_payload(intent), "reply": out.get("spoken", "")})
```

- [ ] **Step 3: Run the suite**

Run: `cd kiosk/voice && python -m pytest -q 2>&1 | tail -5`
Expected: pass. If a test asserts the exact applied payload, update it to include `reply`.

- [ ] **Step 4: Commit**

```bash
git add kiosk/voice/homecal_voice/main.py
git commit -m "feat(pi): post transcript on thinking + reply on applied for the band"
```

---

### Task 13: Pi — register `event_add` intent

**Files:**
- Modify: `kiosk/voice/homecal_voice/intent.py`

- [ ] **Step 1: Add to `VALID_INTENTS`**

```python
VALID_INTENTS = {
    "dinner_set", "chore_complete", "query_dinner", "query_agenda",
    "event_add",
    "ask_question", "noise_play", "joke_tell",
    "unknown",
}
```

- [ ] **Step 2: Add required fields**

```python
    "event_add": frozenset({"title", "date"}),
```

- [ ] **Step 3: Add the schema line to the prompt** (in `SYSTEM_TEMPLATE`, after the `query_agenda` schema line):

```
{{"intent":"event_add",     "title":"string", "date":"YYYY-MM-DD", "time":"HH:MM", "duration_min":60, "category":"name", "confidence":0..1}}
```

- [ ] **Step 4: Add usage rules** (after the dinner/date rules block, before the chore_complete rules):

```
Use event_add when the user wants to put something on the calendar ("add
soccer practice Thursday at 4pm", "put dentist on the 20th at 9am"). Rules:
- "title": short event name, no date/time words ("Soccer practice").
- "date": YYYY-MM-DD in Brisbane local (same date rules as above).
- "time": HH:MM 24h Brisbane local. OMIT time for an all-day event.
- "duration_min": minutes; default 60 if the user didn't say. Omit for all-day.
- "category": one of the family's category names if the user implies one
  (sport, school, work, family); omit if unclear.
```

> Add `categories` to the prompt context if the function signature supports it; if `build_system_prompt` doesn't take categories, omit the category hint guidance and let the executor default it. Keeping the prompt change minimal (no new template var) avoids touching `build_system_prompt`'s signature — the executor resolves/falls back regardless. **Decision for this plan: do NOT add a categories template var; the executor owns category resolution + fallback.** Drop the last bullet above and instead append: "- "category": optionally the kind of event (sport, school, work); omit if unsure."

- [ ] **Step 5: Test** — add to `intent_test.py` (match the existing parse-test style; confirm filename via `ls kiosk/voice/homecal_voice/*intent*test*`):

```python
def test_event_add_parses_required_fields():
    from homecal_voice.intent import parse_intent_response
    r = parse_intent_response('{"intent":"event_add","title":"Soccer","date":"2026-06-15","time":"16:00","confidence":0.7}')
    assert r.intent == "event_add"
    assert r.fields["title"] == "Soccer"
    assert r.fields["date"] == "2026-06-15"

def test_event_add_missing_title_rejected():
    from homecal_voice.intent import parse_intent_response
    r = parse_intent_response('{"intent":"event_add","date":"2026-06-15","confidence":0.7}')
    assert r.intent == "unknown"  # required-field guard downgrades it
```

> Confirm `parse_intent_response`'s name + its missing-field behaviour by reading `intent.py` lines ~160-200 (it builds `unknown` on missing required fields). Adjust the second assertion to match the actual downgrade shape.

- [ ] **Step 6: Run, expect pass**

Run: `cd kiosk/voice && python -m pytest homecal_voice/intent_test.py -q 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add kiosk/voice/homecal_voice/intent.py kiosk/voice/homecal_voice/intent_test.py
git commit -m "feat(pi): event_add intent — valid set, required fields, prompt schema"
```

---

### Task 14: Pi — always-confirm `event_add`

**Files:**
- Modify: `kiosk/voice/homecal_voice/main.py`

- [ ] **Step 1: Add the infinite threshold** — in `AUTO_APPLY_THRESHOLDS`:

```python
AUTO_APPLY_THRESHOLDS = MappingProxyType({
    "noise_play": -math.inf,
    "joke_tell": -math.inf,
    # Calendar writes are higher-stakes than dinner/chores — always show the
    # confirm card. +inf means it never clears the auto-apply bar, so it always
    # falls into the confirm branch (still silent-fails below 0.6 confidence).
    "event_add": math.inf,
})
```

- [ ] **Step 2: Test** — add to `main_test.py`:

```python
def test_event_add_never_auto_applies():
    from homecal_voice.main import auto_apply_threshold
    import math
    assert auto_apply_threshold("event_add") == math.inf
    # sanity: a normal intent keeps the default
    assert auto_apply_threshold("dinner_set") == 0.85
```

- [ ] **Step 3: Run, expect pass**

Run: `cd kiosk/voice && python -m pytest homecal_voice/main_test.py -q 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add kiosk/voice/homecal_voice/main.py kiosk/voice/homecal_voice/main_test.py
git commit -m "feat(pi): event_add always confirms (infinite auto-apply threshold)"
```

---

### Task 15: Pi — `_event_add` executor handler

**Files:**
- Modify: `kiosk/voice/homecal_voice/executor.py`
- Test: `kiosk/voice/homecal_voice/executor_test.py`

- [ ] **Step 1: Write failing tests** (append to `executor_test.py`, matching its `requests_mock` style)

```python
def test_event_add_posts_event_with_resolved_category(requests_mock):
    posted = {}
    requests_mock.get("http://api/api/categories", json=[
        {"id": "cat-family", "name": "Family"},
        {"id": "cat-sport", "name": "Sport"},
    ])
    def cb(request, _ctx):
        posted.update(request.json()); return {"id": "ev1"}
    requests_mock.post("http://api/api/events", json=cb, status_code=201)
    ex = Executor(base="http://api", token="t")
    res = IntentResult("event_add", {"title": "soccer", "date": "2026-06-15", "time": "16:00", "category": "sport"}, 0.7, "")
    out = ex.apply(res)
    assert out["ok"] is True
    assert posted["categoryId"] == "cat-sport"
    assert posted["title"] == "Soccer"        # canonicalised
    assert posted["start"] == "2026-06-15T06:00:00Z"  # 16:00 Brisbane = 06:00Z
    assert posted["end"] == "2026-06-15T07:00:00Z"    # default 60m
    assert posted["allDay"] is False

def test_event_add_all_day_when_no_time(requests_mock):
    requests_mock.get("http://api/api/categories", json=[{"id": "cat-family", "name": "Family"}])
    posted = {}
    def cb(request, _ctx):
        posted.update(request.json()); return {"id": "ev2"}
    requests_mock.post("http://api/api/events", json=cb, status_code=201)
    ex = Executor(base="http://api", token="t")
    out = ex.apply(IntentResult("event_add", {"title": "nan's birthday", "date": "2026-06-20"}, 0.7, ""))
    assert out["ok"] is True
    assert posted["allDay"] is True
    assert posted["start"] == "2026-06-20" and posted["end"] == "2026-06-20"

def test_event_add_unknown_category_falls_back_to_family(requests_mock):
    requests_mock.get("http://api/api/categories", json=[
        {"id": "cat-family", "name": "Family"}, {"id": "cat-x", "name": "Sport"},
    ])
    posted = {}
    def cb(request, _ctx):
        posted.update(request.json()); return {"id": "ev3"}
    requests_mock.post("http://api/api/events", json=cb, status_code=201)
    ex = Executor(base="http://api", token="t")
    ex.apply(IntentResult("event_add", {"title": "thing", "date": "2026-06-20", "time": "09:00", "category": "nope"}, 0.7, ""))
    assert posted["categoryId"] == "cat-family"
```

- [ ] **Step 2: Run, expect fail**

Run: `cd kiosk/voice && python -m pytest homecal_voice/executor_test.py -k event_add -q`
Expected: FAIL — no `event_add` handler.

- [ ] **Step 3: Implement.** Register the handler in `__init__._handlers`:

```python
            "event_add": self._event_add,
```

Add the timezone constant near the top of `executor.py` (after the imports):

```python
# Brisbane is a fixed UTC+10 (no DST) — safe to model as a static offset.
_BNE = timezone(timedelta(hours=10))
```
(extend the existing datetime import to `from datetime import date as Date, datetime, timezone, timedelta`).

Add the handler (beside `_dinner_set`):

```python
    def _event_add(self, f: dict) -> dict:
        title = _canon_meal(f["title"])  # same title-case-preserving canon as meals
        date = f["date"]
        category_id = self._resolve_category(f.get("category"))
        time = f.get("time")
        if time:
            start_local = datetime.fromisoformat(f"{date}T{time}:00").replace(tzinfo=_BNE)
            dur = int(f.get("duration_min") or 60)
            end_local = start_local + timedelta(minutes=dur)
            start = start_local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            end = end_local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            all_day = False
            when_spoken = f"{self._humanise(date)} at {_speak_time(time)}"
        else:
            start = end = date
            all_day = True
            when_spoken = self._humanise(date)
        r = requests.post(
            f"{self.base}/api/events",
            json={"categoryId": category_id, "title": title, "start": start, "end": end, "allDay": all_day},
            headers=self.headers,
            timeout=API_TIMEOUT_SEC,
        )
        r.raise_for_status()
        return {"ok": True, "spoken": f"Added {title} on {when_spoken}."}

    def _resolve_category(self, name: "str | None") -> str:
        """Match a spoken category name (case-insensitive) to an id; fall back to
        Family, then to the first category. Calendar create requires a categoryId."""
        r = requests.get(f"{self.base}/api/categories", headers=self.headers, timeout=API_TIMEOUT_SEC)
        r.raise_for_status()
        cats = r.json()
        if not cats:
            raise RuntimeError("no categories configured")
        by_name = {c["name"].strip().lower(): c["id"] for c in cats}
        if name and name.strip().lower() in by_name:
            return by_name[name.strip().lower()]
        return by_name.get("family", cats[0]["id"])
```

> Confirm `self._humanise(date)` exists (used by `_dinner_set` — "Got it, X for {self._humanise(...)}"). It does. Confirm `_speak_time` is in scope (module-level, yes).

- [ ] **Step 4: Run, expect pass**

Run: `cd kiosk/voice && python -m pytest homecal_voice/executor_test.py -k event_add -q`
Expected: PASS (3 tests).

- [ ] **Step 5: Full Pi suite**

Run: `cd kiosk/voice && python -m pytest -q 2>&1 | tail -5`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add kiosk/voice/homecal_voice/executor.py kiosk/voice/homecal_voice/executor_test.py
git commit -m "feat(pi): _event_add executor handler — category resolve + Brisbane→UTC + POST /api/events"
```

---

### Task 16: Build, verify, deploy, session log

**Files:**
- Modify: `docs/SESSION-LOG.md`

- [ ] **Step 1: Full build + all suites**

```bash
cd /home/ben/Development/homecal
npm run build && npm --workspace backend test 2>&1 | tail -3
cd frontend && npx vitest run 2>&1 | tail -3
cd ../kiosk/voice && python -m pytest -q 2>&1 | tail -3
```
Expected: build clean; backend all pass; frontend all pass (incl. bandView 8 + voiceState additions); Pi all pass (incl. poke_handlers 4, event_add intent 2, threshold 1, executor 3).

- [ ] **Step 2: Manual verification (dev or deploy).** Backend + frontend dev, wall view:
  - With the Pi service running (or a curl): `curl -fsS -X POST -H "x-pi-token: $PI_API_TOKEN" http://localhost:8787/api/voice/listen` → `{"ok":true}`, and the Pi logs a listen cycle starting without "hey luna".
  - Tap the VoiceChip on the wall → Pi starts listening → band slides up "Listening…" → speak "add soccer practice Thursday at 4pm" → band shows the transcript + "thinking…" → ConfirmCard "Add "Soccer practice" — …" → say "yes"/tap → band shows Luna's reply → event appears on the week grid.
  - Long-press the chip → mute presets menu (not a listen cycle).
  - Confirm the band never appears on phone/desktop (`?mode=` default + `?mode=desktop` when P3 exists).

- [ ] **Step 3: Append SESSION-LOG entry** under `## 2026-06-14 — P2 voice band + tap-to-talk + event_add`: what shipped, the always-confirm-via-inf-threshold decision, transcript-via-existing-field decision, and the suite counts from Step 1.

- [ ] **Step 4: Commit + push + PR**

```bash
git add docs/SESSION-LOG.md
git commit -m "docs: session log for P2 voice band + event_add"
git push -u origin feat/voice-p2
gh pr create --base master --head feat/voice-p2 --title "P2: voice band + tap-to-talk + event_add intent" --body "Phase 2 of calendar UI v2. See docs/superpowers/plans/2026-06-14-p2-voice-band-event-add.md."
```

---

## Self-review

- **Spec coverage (P2 section):** VoiceBand with listening/thinking-transcript/confirming/applied-reply/failed states ✅ (Tasks 3,4,8 + ConfirmCard owns confirming) · slides over ControlBar ✅ (Task 8 placement) · chip tap = trigger, long-press = mute ✅ (Task 6) · muted-tap unmute preserved ✅ (Task 6) · `POST /api/voice/listen` → poke → Pi bypass ✅ (Tasks 1,9,10,11) · ignored while muted / clears so it fires once ✅ (Task 11) · `event_add` always-confirmed via existing confirm branch ✅ (Tasks 13,14) · executor → existing `POST /api/events` with same validation ✅ (Task 15) · category by name → Family fallback ✅ (Task 15) · transcript on thinking + reply on applied ✅ (Tasks 2,12) · no schema migration (payload is `z.unknown()`) ✅ · wall-only ✅ (band only in WallLayout; chip already wall-gated).
- **Placeholder scan:** the only soft spots are explicit "confirm the exact name by reading X" notes for three repo specifics I could not 100% pin (broker `subscribe` name in Task 1; `/api/voice/mute` guard in Task 1; `parse_intent_response` name + missing-field downgrade in Task 13). Each names the file/lines to check and the expected shape — not open-ended TODOs. The implementer must verify these three before their respective commits.
- **Type consistency:** `OverlayState.applied.reply` (Task 2) is read by `bandView` (Task 3) and set by the Pi applied poke (Task 12); `event_add` fields (`title`,`date`,`time?`,`duration_min?`,`category?`) are consistent across the frontend type (Task 2), ConfirmCard (Task 7), the Pi prompt schema (Task 13), and the executor handler (Task 15); `classify_poke` return values (`"listen"`/`"mute"`) match the SSE consumer (Task 10); `_listen_trigger` is defined (Task 10) before use (Task 11).
- **Decision recorded:** Task 13 deliberately avoids adding a categories template var to keep `build_system_prompt`'s signature stable — the executor owns category resolution + fallback. This is the single intentional simplification vs. the spec's "category matched by name" (still satisfied, just resolved server-side on the Pi rather than hinted to Haiku).
- **Ordering:** backend → frontend types/state/band/chip/layout → Pi trigger → Pi intent/executor → build. Each task commits independently; the feature is only end-to-end wired after Task 15, verified in Task 16.
