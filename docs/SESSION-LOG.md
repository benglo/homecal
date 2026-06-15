# Session Log — homecal

Running log of work per session. Newest first. Pair with `git log` for exact diffs.

---

## 2026-06-15 — P2 voice band + tap-to-talk + event_add (calendar UI v2, phase 2 of 3)

Branch `feat/voice-p2` (off `master` after P1 + the wall touchscreen fixes landed). Spec `docs/superpowers/specs/2026-06-11-ui-slot-create-voice-desktop-design.md` (P2 section); plan `docs/superpowers/plans/2026-06-14-p2-voice-band-event-add.md`. Plan was put through a 5-persona review (factual/senior/security/consistency/redundancy) before implementation — caught an auth bug, a layout-reflow bug, a mid-cycle-tap race, and missing input validation, all folded into the plan first.

Implemented subagent-driven on **Haiku** (16 tasks), with controller-side verification after each (read + run the real suite, never trusting the agent's report — Haiku misattributed test counts twice, both caught).

### What shipped
- **VoiceBand** — wall-only active-voice band that **overlays** the ControlBar (absolute, not a flex sibling — avoids shrinking the calendar on every utterance). Driven by a pure, tested `bandView` view-model (8 tests): listening (waveform) / thinking (live transcript) / applied (Luna's reply) / failed; hidden for idle/confirming/offline.
- **Tap-to-talk** — `POST /api/voice/listen` (unguarded, mirrors `/mute`) → `broker.poke('voice',{kind:'listen_request'})`. Pi's SSE thread classifies pokes via a pure `classify_poke` and sets a `threading.Event`; `run_once` honours it to bypass the wake word, drained at cycle start so mid-cycle taps don't queue, cleared while muted. VoiceChip: tap = talk, long-press (500ms) = mute menu, ignores taps while a cycle is active.
- **event_add intent** — Haiku intent + `_event_add` executor handler → existing `POST /api/events`. Category resolved by name → Family fallback; Brisbane→UTC via the shared `BRISBANE_OFFSET_SECONDS`; title clamped 256, duration clamped 5–1440, date/time parse guarded → honest spoken errors. **Always confirms** via `AUTO_APPLY_THRESHOLDS["event_add"]=math.inf` (no new confirm machinery). Transcript rides the existing `thinking.transcript_partial`; reply is a new `applied.reply` field.

### Verification
build clean · backend 201/201 · frontend 113/113 (incl. bandView 8 + voiceState event_add/reply) · Pi 462 (baseline 452 + 10 new). Followed by a final multi-agent PR review.

### Notable
- Deliberate spec divergences (documented in the plan): `duration_min` (not `duration_minutes`), no `all_day` intent field (derived from `time` presence), `transcript_partial` reuse, ConfirmCard owns the `confirming` view, deferred "tap to cancel".
- Deploy to the Pi pending; live acceptance (utter "add soccer practice Thursday 4pm" → confirm → event on the grid) to be done on next deploy.

## 2026-06-11 — P1 slot-tap creation shipped (calendar UI v2, phase 1 of 3)

New branch `feat/calendar-ui-v2` (cut from `feat/voice-kid-intents` — P2's voice work depends on that code). Brainstormed with the visual companion (mockups for slot-create, voice band, desktop shell), spec at `docs/superpowers/specs/2026-06-11-ui-slot-create-voice-desktop-design.md`, P1 plan at `docs/superpowers/plans/2026-06-11-p1-slot-tap-create.md`. P2 (voice band + tap-to-talk + event_add intent) and P3 (`?mode=desktop` Outlook-style shell) are specced but not planned yet — plans get written against the code as it exists when their turn comes.

### What shipped (6 commits, 9070859..1cf16c0)

Outlook-style creation on the wall: tap an empty week slot → 1-hour draft; drag → exact range; month day tap → timed draft at next half-hour; month multi-day drag → all-day range. `selectMirror` ghost shows the landing zone while the form is open and clears on close (`unselectAuto={false}` + parent-driven `unselect()`).

- `slotSelection.ts` — pure FC-selection → prefill mapper + `defaultSlot()` (7 tests)
- `quickAddPayload.ts` — pure draft → `POST /api/events` body builder, midnight-roll handling (6 tests)
- `GridCalendar` — `selectable`/`selectMirror`/`selectLongPressDelay={250}` + `onSlotSelect`/`selectionOpen` props
- `EventQuickAddForm` (shell-agnostic; P3's popover will reuse it) + `QuickAddSheet` rewritten as a thin Sheet shell. Inline category chip row via the existing `CategoryPicker`; Dinner chip routes to `DinnerEditorSheet` (conscious spec deviation, documented in the plan — reuse beats duplicating the meal form)
- `WallLayout` — slot wiring; **AddChooser deleted** (two-step add flow retired; ControlBar `+` now opens the unified form via `defaultSlot`)
- `PhoneLayout` — FAB opens the unified form (manage-tab FAB still creates categories; phone week grid intentionally stays non-selectable)

### Verification

- frontend: tsc clean, 101/101 vitest (88 existing + 13 new)
- Final whole-diff code review: approved, 0 critical. Its "stale draft via key collision" finding was disproved (QuickAddSheet returns null when closed → form unmounts → state can't survive a reopen). `autoFocus`-pops-virtual-keyboard flagged but is the pre-existing M3 wall behaviour, unchanged.
- Kiosk hardware check (250 ms long-press select vs scroll feel) still pending — do on next deploy.

### Process note

The Bash safety-classifier had rolling outages all session (plain `git` allowlisted, `npm`/`npx` blocked). Subagents wrote files verbatim from the plan; commits + test runs were batched into the recovery windows, with the user running two verification commands via `!` passthrough.

Two stacked features landed on `feat/voice-kid-intents` on top of the existing kid-intents work, both deployed live: a Python Kokoro sidecar on the home server (replaces OpenRouter for TTS) and a swap from "Hey Mycroft" to a custom-trained "Hey Luna" wake word. 30 commits total since the plan landed.

### Brainstorm → spec → plan (TTS sidecar)

Started from yesterday's TTS read-timeout fix (single retry + bool return + WARNING log). The retry was a band-aid; this session was about the cure. Empirical bench-first:

- Pi 5 (Cortex-A76, 2GB): Kokoro fp16 = 2.8× RT (5.6 s synth for 2 s audio). int8 was actually slower (5.5× RT) — ARM int8 GEMM kernels aren't well-optimized in onnxruntime for this CPU. Local-on-Pi ruled out — would replace occasional cloud bad days with consistently mediocre ones.
- Home server (i5-7400 x86, 16GB): Kokoro fp16 = 0.6× RT (1.2 s synth for 2 s audio). Beats typical cloud in the happy path. **This is where the sidecar lives.**

4-persona pre-write review (senior backend, SRE, audio specialist, family-UX) converged on:
- Separate container in compose, `mem_limit: 1500m`, `platform: linux/amd64`, model + voices baked in
- WAV (24 kHz int16 mono) over LAN; no MP3/Opus re-encoding
- Pre-rendered noise + joke catalogs at image build time (kills the empty-string TTS bug + the 1.2s pause before a fart sound)
- Pi-side ladder: `lan → cloud (capped/day) → didnt_catch.mp3 → silent + WARNING`
- 30 s health cache mirroring `is_muted_locally`
- One voice, vary prosody not identity (UX persona was emphatic — Mycroft is a character, multiple voices = multiple characters = confusing for kids)

Spec at `docs/superpowers/specs/2026-06-08-local-tts-sidecar-design.md`. Plan at `docs/superpowers/plans/2026-06-08-local-tts-sidecar.md` — 28 numbered TDD tasks across 5 layers.

### Subagent-driven implementation (28 tasks)

Per-task workflow: implementer subagent → spec-compliance reviewer → code-quality reviewer → mark complete. Started all on Haiku 4.5; bumped to Sonnet 4.6 after T11 (Docker work) for the integration-heavy tasks (T12 compose, T14 backend schema+repo+route, T17 LAN helpers, T21 the big `_speak` ladder, T22 noise_play catalog, T23 joke_tell catalog, T25 VoiceChip dot). Haiku stayed on the mechanical tasks. Reviewers stayed Haiku throughout — caught every issue.

Haiku misses across the session: two minor dead-import amends (T2 dropped `import os` after review caught; T10 redefined `SAMPLE_RATE` locally instead of just removing it). Both fixed with one-line amends. Otherwise verbatim spec → code.

### Final cross-cutting review caught two real integration bugs

After all 27 implementation tasks landed (T28 = manual e2e), a final Sonnet code-reviewer pass surfaced bugs that per-task reviews missed:

1. **`TTS_BACKEND=cloud` env was parsed but never gated `_speak`'s LAN attempt.** The spec's rollout strategy ("ship cloud, validate, flip to lan") wouldn't work — `_speak` always tried LAN first regardless. Fix: `if d.cfg.tts_backend == "lan" and lan_reachable():` — one-line gate.
2. **Catalog hits audited `tts_provider=NULL`.** `_noise_play` and `_joke_tell` returned `{"ok": True, "spoken": ""}` for matcher hits; `_try_execute` called `_speak("")` (no-op) so `_last_tts` was never populated. The wall dot would have been blind to TTS health on the most common kid intents. Fix: executor catalog branches return `"tts_provider": "kokoro_lan"` in the result dict; `_try_execute` prefers that hint over `_last_tts` when present.

Both fixes in commit `01e31e7` with new tests. Total: 451/451 pi-voice + 200/200 backend + 88/88 frontend + 37/37 sidecar.

### Live deploy hiccups

Real-world things the plan didn't anticipate:

- **Docker BuildKit version**: dev server has Docker v20.10 + BuildKit v0.8, which predates `additional_contexts` (needed v0.9+). Worked around by spinning up a `docker-container` buildx builder (`bk-new`, BuildKit v0.30). Worth a one-line note in `docs/deploy.md` — added to follow-up list.
- **Rsync wiped `silero_vad.onnx`**: that file is install-script-seeded (not in the repo) at `~/homecal-voice/silero_vad.onnx`. My initial rsync command dropped `--exclude='models/'` to ship the new `wake_models/` dir; `--delete` wiped Silero. Service crashed on the missing VAD. Restored via `curl` from the snakers4 repo. Added `--exclude='silero_vad.onnx'` for future deploys; properly fixing it (moving Silero into the package proper) is a follow-up PR.
- **`TTS_SERVER_TIMEOUT_S=3` too tight for `ask_question`**: live test of "Hey Luna, what's the time?" timed out at 3 s and fell to cloud. Bench confirmed: a 30-word Haiku answer synthesizes in ~6.7 s on the dev server (the answer is ~9.5 s of audio at 0.6× RT). Bumped to 10 s in `voice-install.sh` + `config.py` defaults (commit `49e0400`). Spec §9 had actually anticipated this ("long answers up the timeout to 8s") — should have read more carefully when picking the default.

### Hey Luna wake word swap

Custom-trained openWakeWord ONNX dropped at repo root. Set up `kiosk/voice/homecal_voice/wake_models/` as the homecal-managed model dir; renamed the ONNX to `hey_luna.onnx` so the scoring key derives cleanly. Extended `wake.py` `load_default_model()` to search `wake_models/` first then fall back to the openWakeWord bundle — `hey_mycroft` and friends still load by name. `WAKE_WORD=hey_mycroft` → `hey_luna` defaults flipped in `config.py` + `voice-install.sh`. Frontend chip's idle hint updated from `say "hey mycroft"` to `say "hey luna"`.

The initial Luna model fired at 0.543–0.761 confidence (threshold is 0.5). User dropped a +20k-steps retrained version (`hey_luna(1).onnx`); after the swap, confidence jumped to 0.825 on the next "Hey Luna" — meaningful improvement.

### State at end of session

- 30 commits ahead of `master` on `feat/voice-kid-intents` (kid-intents + sidecar + wake word + timeout bump + retrained model + chip text)
- PR #5 updated to cover both features. Live wall checklist in the PR body
- Sidecar live at `192.168.1.94:8789`, healthy, serving `/healthz`, `/tts`, `/catalog/{noise,joke}/{key}`
- Backend rebuilt with migration v7 (`tts_provider`, `tts_latency_ms` columns + `/api/voice/status.last_tts_provider`)
- Pi running with `TTS_BACKEND=lan`, `TTS_SERVER_TIMEOUT_S=10`, `WAKE_WORD=hey_luna`
- First successful LAN utterance: "Hey, what's the time?" → ask_question applied, `tts_provider=kokoro_lan`, `tts_latency_ms=15770` (includes synth + 9.5 s playback + 2 s post-decay sleep — perceived first-audio latency ~7 s vs cloud's ~14 s)

### Verify the live build

```bash
# Sidecar
curl -fsS http://192.168.1.94:8789/healthz   # {"ok":true,"model_loaded":true,"warm":true}

# Backend (new columns)
curl -fsS http://192.168.1.94:8787/api/voice/status   # last_tts_provider key present

# Pi service
ssh hbadmin@192.168.1.135 'systemctl is-active homecal-voice && grep -E "TTS_BACKEND|WAKE_WORD|TTS_SERVER_TIMEOUT" /etc/homecal-voice.env'

# Migration
node -e 'const d=require("better-sqlite3")("./data/calendar.db",{readonly:true});console.log(d.pragma("user_version",{simple:true}))'   # 7
```

### Open follow-ups (separate PRs)

- **Move `silero_vad.onnx` into the package** (`vad_models/` mirroring `wake_models/`). User has consented; small PR after this one merges.
- **`tts_latency_ms` for cloud path**: T21's ladder only times the LAN branch. Wrap `d.speak_cloud(text)` in a `time.time()` bracket so the audit captures it for cloud too.
- **Graceful SIGTERM in `_run_after_wake`**: every restart logs a `StopIteration` traceback from `main.py:620` (frame iterator dies on signal). systemd recovers cleanly but the `FAILURE` log is noise. Catch it in `run_once`.
- **`docs/deploy.md` BuildKit note**: hosts with BuildKit < v0.9 need a `docker-container` buildx builder for the `additional_contexts` feature.
- **Live wall checklist** still pending: noise catalog hit, joke catalog playback, sidecar-down failover, wall dot stays green throughout.

### Watch-outs carried forward

- Rsync to Pi MUST `--exclude='silero_vad.onnx'` until the file moves into the package.
- The 3-second TTS timeout was a footgun for `ask_question` — keep the 10s default unless we move to chunked/streaming synth (deferred per spec §4).
- The retrained Luna model is in `wake_models/hey_luna.onnx`. The original `Hey_Luna_20260205_012007.onnx` staging file at repo root is no longer needed but harmless; user may want to delete.
- Wake threshold is 0.5; observed retrained Luna scores 0.825 on clean utterances — there's headroom for tightening if false fires become an issue.

---

## 2026-06-07 (afternoon) — PR #5 review pass + 6 fix-up commits + noise-import tool

5-persona PR review (code, tests, comments, silent-failure, types) on PR
#5's 22-commit kid-intents work. Surfaced 4 criticals and 11 importants;
addressed all of them in 6 focused fix-up commits. Then built an
interactive shell tool to import the real CC0 noise clips into the
catalog, since that was the last outstanding pre-merge gap.

### The criticals (review converged on one theme)
All four criticals came from the silent-failure hunt and were about the
bot lying to the kid:

- **`_noise_play` clip exception bubbled up to `_try_execute`'s catch-
  all** which spoke *"Sorry, I couldn't reach the calendar."* Kid asks
  for a fart, gets an API-error message. Fix: try/except around
  `self._play_clip(...)`, audit as `failed` with `error="clip_play:<msg>"`.

- **`_joke_tell` per-speak failure recorded the wrong audit + spoke the
  wrong error.** Setup-then-punchline-TTS-raises landed in the outer
  error branch with empty `spoken`; the kid heard the setup, then
  silence, then "Sorry, I couldn't reach the calendar". Fix: each
  `_speak` is now independently wrapped; on punchline failure the
  audit's `spoken` field records what the kid actually heard ("Why?").

- **Quiet-hours suppression flashed green ✓ "applied".** Wall lied —
  executor returned `ok=True` even though `_quiet_safe_play_clip` had
  silently swallowed the call. Fix: wrapper now returns `bool`; executor
  returns `ok=False, error="quiet_hours_suppressed"`. None-returning
  callables (backwards compat) still treated as success.

- **`_extract_with_matcher_first` over-coupled.** Fetched family +
  chores + dinners + events in parallel BEFORE attempting any matcher
  pass. An outage on `/api/events` killed `noise_play` and `joke_tell`
  too — even though those matchers need zero backend context. Fix:
  three-stage routing. Stage 1 tries `kid_matcher` (zero API). Stage 2
  fetches family + chores, tries `core_matcher` (v1 + timer). Stage 3
  fetches dinners + events for the Haiku prompt. Required splitting the
  single `default_matcher` into named matchers in `matcher.py`.

### The importants worth pulling out
- **Safety-regex trip was invisible in the audit log.** Spec §7.2
  mandated `error="regex_override"` so the rate could be measured;
  shipped without it. Fix: `_ask_question` now returns
  `regex_override: True` when `safety.check_answer` overrode; `_audit`
  threads that into the audit row's `error` column. Now greppable.
- **`RecentConcernsSection` silently rendered "No recent concerns" on
  query error.** Safety-surface UX disaster — parent reasonably
  concludes "all clear" when system has no idea. Fix: destructure
  `isError`, render "Couldn't load — check your connection" in warn
  colour.
- **`Noises.entries` was a mutable dict.** `@dataclass(frozen=True)`
  freezes the binding, not the dicts; `noises.entries["fart"] = "evil.mp3"`
  would silently corrupt the in-process catalog. Switched to
  `MappingProxyType` mirroring `AUTO_APPLY_THRESHOLDS`. Pinned with a
  test that asserts `TypeError` on write attempt.
- **`voiceAuditBody.intent_name` was an unconstrained string.** Typo at
  the wire (`"ask_quetion"`) would land in the DB column (which has no
  CHECK by design). Tightened to `z.enum([...VOICE_INTENT_NAMES])`.
  Exported the array as `VOICE_INTENT_NAMES` so frontend + tests share
  the source of truth.
- **End-to-end integration tests missing.** Spec §10 listed them;
  shipped without. Added `integration_test.py` with 3 round-trip tests
  (matcher → executor → audit) per new intent. A `catalog_key` vs
  `catalog_id` rename drift between layers would now fail in CI, not
  production.
- **Comment hygiene drift.** Three CLAUDE.md violations: `Spec §3.9` /
  `Spec §3.11` cited subsection refs that don't exist (spec §3 is flat),
  `"Saves ~15ms vs serial fetches"` was the exact "measured numbers that
  rot" the rule bans, `PR #4` references in test comments would rot.
  All rewritten as structural reasoning.

### Test count delta
- Pi: 389 → 413 (+24 tests across the 6 fix-up commits)
- Backend: 193 → 194 (+1 — Zod enum rejection)
- Frontend: 81 (unchanged — the error-state change isn't unit-testable
  without `@testing-library/react`)

### Unexpected finding
Fix E's edge-case test for `noise_play` precedence (both `catalog_key`
AND `play_catalog` present) revealed that the executor returns
`fallback_text` unconditionally — even on the catalog_key path where
`fallback_text` shouldn't logically be spoken. Pinned as a regression
test with a NOTE so a future fix produces a deliberate diff. Not a real
bug in practice (matcher emits only `catalog_key`, Haiku emits only
`play_catalog`+`fallback_text`; the contrived both-present case is
LLM-merge speculation). Documented for follow-up.

### Noise-clip import tool
The 12 catalog entries are still zero-byte placeholders — real CC0
clips are the last pre-merge gap. Built
`kiosk/voice/scripts/import-noises.sh`: interactive bash tool that
walks the 12 entries in order, prompts for source-file path + URL +
creator + notes, runs `ffmpeg -ar 16000 -ac 1 -t 2 -b:a 64k` to
normalise to the spec (mono, 16kHz, 2s hard cap, 64kbps MP3), and
updates the right row in `SOURCES.md` automatically. Handles drag-drop
quoted paths, `~` expansion, skip/replace/quit. Recommended source:
Pixabay sound effects (no account, blanket permissive license).
Freesound CC0 filter as backup with per-file license verification.

Tool committed; the actual clip import is a follow-up since it needs
the user to do the per-clip search/download interactively.

### Files
**New:** `kiosk/voice/scripts/import-noises.sh`,
`kiosk/voice/homecal_voice/integration_test.py`.

**Modified (fix-up):** `kiosk/voice/homecal_voice/{executor,main,matcher,
catalog}.py` + tests, `kiosk/voice/homecal_voice/catalogs/noises.json`
(deduped kitten synonym), `backend/src/schemas.ts`,
`backend/src/repos/voiceUtterances.test.ts`,
`frontend/src/components/manage/RecentConcernsSection.tsx`,
`frontend/src/components/voice/voiceState.test.ts`.

---

## 2026-06-07 — Kid-friendly voice intents (PR #5)

Built three new voice intents aimed at the kids (Imogen and Penelope):
open-ended Q&A, silly sound effects, and jokes. Plus expanded audit
logging — `voice_utterances` now records `intent_name`, `answer`, and
`concern` so we can see what the bot actually says. PR #5 open.

### Process
Followed the full spec → plan → subagent-driven implementation cycle
end-to-end (the first time on this project). Brainstormed the design via
the `superpowers:brainstorming` skill, ran a 5-persona review (factual,
senior engineer, security, consistency, redundancy) before locking the
spec, generated a 21-task plan via `writing-plans`, then executed via
`subagent-driven-development` — fresh subagent per task with spec +
quality review checkpoints between tasks. Two CRITICAL findings were
caught mid-execution (a misleading `concern` return type in the repo;
deleted chore-complete fallback instructions in the prompt) and fixed
inline before the next task.

### Locked design decisions (from the review pass)
- **Single Haiku call** for `ask_question` — intent + answer in one call.
  Idempotency cost is real (a retry re-bills the answer tokens) but at
  home scale it's ~$0.0001 per retry; the ~1s latency win on the only
  latency-sensitive new path is worth more.
- **No CHECK constraint** on `intent_name` in SQLite. SQLite can't ALTER
  a CHECK; adding the 12th intent later would force a table rebuild on
  the live DB. Zod at the API boundary is the gatekeeper.
- **No composite `/api/voice/context` endpoint** — Pi uses a
  `ThreadPoolExecutor` to hit the existing 4 endpoints in parallel.
  Saves the new API surface for no meaningful latency cost at LAN.
- **No dedicated safety judge** (second LLM call) in v1. Four-layer
  defence (system prompt + regex tripwire + concern detection + audit
  log review) ships first. Once the audit log shows real Haiku misses,
  adding a Gemini-Flash safety judge becomes a justified v2 addition
  with a real failure profile to tune against. Building it now means
  tuning blind.
- **Per-intent confidence thresholds.** `noise_play` and `joke_tell`
  auto-apply at ANY confidence — a confirm-card ("did you want a joke?")
  disrupts the gag. `ask_question` keeps the 0.85 threshold because a
  wrong answer is worse than a confirm.
- **Tiered redirect** for hard topics. Bot answers "why do people die"
  with a gentle factual answer; redirects only on genuine parental-
  judgment topics (Santa-truth, specific medical advice, etc).
  Avoids training the kids that the wall is useless.
- **Concerning-disclosure handler.** Haiku flags `concern: true` on
  utterances suggesting medical emergency / abuse / self-harm. Bot
  speaks a fixed disclosure line ("That sounds important. Please tell
  your mum or dad right now — they want to help.") and the audit row
  is flagged with `concern=1`. New phone Manage tab section ("Recent
  voice concerns") surfaces last-7-days flagged rows for parental
  review.

### What landed
**Backend (3 PRs of work):**
- Migration v6: 3 nullable columns on `voice_utterances`
  (`intent_name`, `answer`, `concern`). No CHECK, no new index — defer
  until there's a slow query.
- `voiceAuditBody` Zod + `voiceUtterances` repo accept the new fields.
  `concern` normalised to `boolean | null` at the repo boundary
  (SQLite returns `0 | 1 | null`; type lying would've bitten the
  consumer).
- `GET /api/voice/concerns?since=` returns rows where `concern=1` for
  the phone review tray.

**Frontend:**
- `ParsedIntent` grows 3 variants; `isParsedIntent` validates each;
  parametrised `pokeToAction` round-trip pin across all 11 variants
  (4 timer from PR #4 + 3 new kid + 4 existing = canonical regression
  set).
- `VoiceChip.appliedLabel`: `ask_question` → "answered", `joke_tell` →
  "😄 joke", `noise_play` → empty + suppress render. Same exhaustiveness
  add in `ConfirmCard.describe`.
- `useRecentConcerns` hook + `api.voiceConcerns` method. New
  `RecentConcernsSection` mounted on phone Manage tab between Voice and
  KioskShutdown sections.

**Pi voice service:**
- `catalog.py` — load + integrity check at startup. SystemExit on
  malformed JSON or missing referenced clip so a typo fails at boot,
  not at 6pm in the kitchen.
- `safety.py` — word-boundary regex tripwire (5 unambiguous terms:
  fuck/shit/cunt/rape/suicide). Test pins explicitly rule out false
  positives: "grape" not matching "rape", "the dinosaur died out" not
  matching, "I scraped my knee" not matching.
- `patterns_kid.py` — matcher patterns for `noise_play` (verb + name +
  optional "noise|sound"; synonym lookup with prefix fallback) and
  `joke_tell` (`tell (me)? a joke|riddle` → random catalog pick).
  Registered in default_matcher alongside v1 and timer patterns.
- `intent.py` — `VALID_INTENTS` grows 3; `REQUIRED_FIELDS` covers the
  3 new shapes; `SYSTEM_TEMPLATE` rewritten with kid persona, tiered
  safety, jailbreak resistance (5 manoeuvres), false-attribution
  defence, concerning-disclosure detection. `build_system_prompt`
  accepts `today_dinner`, `today_agenda`, `noise_keys` kwargs.
- `main.py` — per-intent `AUTO_APPLY_THRESHOLDS` map (MappingProxyType
  frozen); `_gather_context_for_intent` uses ThreadPoolExecutor on the
  4 endpoints; `_is_quiet_hours` + `_quiet_safe_play_clip` wrapper
  mirrors the frontend chore-chime quiet window (20:00–07:00 Brisbane).
- `executor.py` — three new handlers. `_noise_play` resolves
  catalog_key OR play_catalog → clip path. `_joke_tell` speaks setup
  → sleep(1.5) → punchline inline, returns `spoken_inline=True` so
  main.py doesn't double-speak. `_ask_question` runs answer through
  `safety.check_answer` (concern path BYPASSES it — distressed child
  should hear the disclosure, not a deflection), truncates to 40 words.
- `server_state.post_audit` + `main._audit` carry the three new
  fields through to the backend.
- `pyproject.toml` package-data glob: `clips/*.mp3` → `clips/**/*.mp3`,
  added `catalogs/*.json` so the new bundled files actually ship.

### Catalog content (v1)
- **30 jokes** hand-curated per §7.4 rubric (no your-mum / appearance /
  race / disability / scary / sarcasm; AU spelling). Setup+punchline
  split so the executor can insert the 1.5s pause. Topic tagging
  deferred to v2.
- **12 noises**: fart, burp, chicken, cow, pig, dog, cat, lion, sneeze,
  raspberry, drum, fanfare. Synonym table for kid forms ("doggy" →
  "dog", "piggy" → "pig", "chook" → "chicken"). Bedtime-adjacent
  entries (evil-laugh, monster, ghost, alarm) deliberately dropped per
  the spec-review pass.
- **The MP3s are zero-byte placeholders** — they satisfy the catalog
  integrity check so the service boots and tests pass, but they're
  silent. `clips/noises/SOURCES.md` documents the TODO: real CC0
  clips need sourcing from Freesound (or recorded ourselves) and
  re-encoded to mono 16kHz before kids hear this for real. This does
  NOT block the rest of the implementation.

### Test counts (start → end)
- Backend: 183 → 196 (+13)
- Frontend: 73 → 81 (+8)
- Pi: 313 → 389 (+76)
- All green, no regressions.

### Deploy + verification
- Docker container rebuilt — backend at `schemaVersion: 6`.
  `/api/voice/concerns` returns `[]` (no flagged rows yet).
- Kiosk reloaded — wall picks up the new `ParsedIntent` types +
  Recent Concerns section.
- Pi voice code rsync'd; `homecal-voice` service restarted; catalog
  integrity check passed at startup; service active with mic_online
  and fresh heartbeat.

### Acceptance gates outstanding
- 20-utterance kid smoke test (the user runs it; only they can speak
  to the wall). Test plan in PR #5 description.
- Real CC0 noise clips before the kids use it.
- Eyeball pass on the joke catalog by the user (the §7.4 user-gate).

### Files
**New:** `backend/src/routes/voiceConcerns.{ts,test.ts}`,
`frontend/src/components/manage/RecentConcernsSection.{tsx,test.tsx}`,
`frontend/src/core/hooks/useData.test.ts`,
`kiosk/voice/homecal_voice/{catalog,safety,patterns_kid}.py` + tests,
`kiosk/voice/homecal_voice/catalogs/{noises,jokes,safety_terms}.json`,
`kiosk/voice/homecal_voice/catalogs/jokes.README.md`,
`kiosk/voice/homecal_voice/clips/noises/{fart,burp,chicken,cow,pig,dog,cat,lion,sneeze,raspberry,drum,fanfare}.mp3` (placeholder)
+ `SOURCES.md`,
`docs/superpowers/specs/2026-06-06-kid-intents-design.md`,
`docs/superpowers/plans/2026-06-06-kid-intents.md`.

**Modified:** `backend/src/db/migrate.ts` (v6),
`backend/src/repos/voiceUtterances.ts`, `backend/src/schemas.ts`,
`backend/src/routes/voice.ts`, `backend/src/server.ts`,
`frontend/src/core/model/types.ts`, `frontend/src/core/api/client.ts`,
`frontend/src/core/hooks/useData.ts`,
`frontend/src/components/voice/voiceState.{ts,test.ts}`,
`frontend/src/components/voice/ConfirmCard.tsx`,
`frontend/src/components/controls/VoiceChip.{tsx,test.ts}`,
`frontend/src/layouts/PhoneLayout.tsx`,
`kiosk/voice/homecal_voice/{intent,main,executor,server_state}.py`
(+ tests), `kiosk/voice/pyproject.toml`.

---

## 2026-06-06 (evening) — Pi voice deploy + timer intent type-guard fix

Deployed the matcher + timer code to the Pi (it had been sitting on master
since the morning's PR #3 merge but the Pi was still running pre-matcher
voice code). First live timer test surfaced a bug the test suite missed.

### Deploy
- `rsync` of `kiosk/voice/homecal_voice/` to the Pi (excluding `.venv`,
  `__pycache__`, `*.egg-info`, `*.pyc`) — added 7 new files the Pi was
  missing: `matcher.py`, `aliases.py`, `date_phrase.py`, `duration.py`,
  `patterns_v1.py`, `patterns_timer.py` (+ tests).
- `systemctl restart homecal-voice` — clean restart, mic online, heartbeat
  fresh. The cosmetic `StopIteration` from the old pid teardown printed as
  expected.

### The bug: chip stuck on "thinking" after a successful timer
First test was *"set a timer for five minutes"*. Logs showed matcher hit
`timer_set` at confidence 1.0, executor POSTed `/api/timers` successfully
(`durationSec: 300`), audit row written as `status=applied source=matcher`.
But the wall VoiceChip never advanced past "thinking" — no ✓ flash, no
auto-fade. The TimerStack chip also didn't render.

Root cause was at the SSE trust boundary on the wall.
`frontend/src/components/voice/voiceState.ts` `isParsedIntent` only
validated the original five intent shapes (`dinner_set`, `chore_complete`,
`query_dinner`, `query_agenda`, `unknown`). The four `timer_*` intents
introduced in the morning's matcher PR fell through to `default: return
false`. `pokeToAction` then rejected the whole `applied` payload as
malformed (the same defensive check that was added in PR #2 review to stop
unknown payloads crashing the reducer) and returned null. The reducer
never ran → chip stayed on `thinking`.

The TimerStack chip rendering separately was the same bug observed from a
different angle: `useTimers` only refetches when the SSE `kind: 'timers'`
poke fires the React Query invalidation. That poke *did* arrive, but the
visible symptom was the VoiceChip stall; the timer chip would have shown
up on the next 30s poll backstop. Verified manually after the fix —
appeared instantly.

### The fix — four files, one type union to rule them all
- `frontend/src/core/model/types.ts` — added four variants to
  `ParsedIntent`: `timer_set` (`duration_sec`, `label`), `timer_query`
  (`label`), `timer_cancel` (`label`), `timer_extend` (`duration_sec`,
  `label`). `label` is `string | null` to mirror the Pi's "the timer"
  semantics.
- `frontend/src/components/voice/voiceState.ts` — added the matching
  branches in `isParsedIntent`. `timer_set`/`timer_extend` require
  `duration_sec: number`; `timer_query`/`timer_cancel` only need `label`.
- `frontend/src/components/controls/VoiceChip.tsx` `appliedLabel` —
  `"timer set"` / `"timer extended"` / `"timer cancelled"` / `"done"`
  (the spoken reply does the heavy lifting; chip just acknowledges).
- `frontend/src/components/voice/ConfirmCard.tsx` `describe` — added for
  exhaustiveness even though matcher confidence is 1.0 (auto-apply path,
  ConfirmCard never sees these). Without it, TypeScript's exhaustive
  switch silently degrades to `undefined`.

### Test pin
Added a parametrised `it.each` in `voiceState.test.ts` over every
`timer_*` shape — round-trips `applied` payloads through `pokeToAction`
and asserts the intent comes back intact. If a future intent variant
lands without updating the guard, this fails loudly instead of producing
a silent reducer no-op.

### Counts
- Frontend tests: 62 → 68 (+6 parametrised timer cases).
- Backend/voice: untouched today.
- Container rebuilt, kiosk reloaded via `kiosk/reload.sh`.

### Why the original PR review missed this
Five specialist agents reviewed PR #3 yesterday. None spotted it because
the Pi-side timer code and the wall-side intent guard live in different
languages on different sides of the SSE wire. `type-design-analyzer`
flagged the discriminated-union design but only inspected what was
declared; the *omission* of the four new variants was invisible in a
file-by-file review. The lesson worth keeping: when a backend adds a new
discriminated-union variant, every front-side trust-boundary validator
that switches on that union has to be updated in lockstep — and the test
that catches the drift has to live at the validator, not at the producer.

### Files
- `frontend/src/core/model/types.ts`
- `frontend/src/components/voice/voiceState.ts` + `.test.ts`
- `frontend/src/components/controls/VoiceChip.tsx`
- `frontend/src/components/voice/ConfirmCard.tsx`

---

## 2026-06-06 — Kitchen timers (voice + wall chip) on PR #3

Built out the timer intents the matcher already recognised but the executor
stubbed as "I can't set timers yet". End-to-end: SQLite table + CRUD +
SSE pokes, voice executor wiring for all four `timer_*` intents, minimal
placeholder chip on the wall, then a full PR review pass with five
specialist agents and a follow-up fix commit. Two commits on top of the
existing PR #3.

### What landed
- **Migration v5** — `timers` table. `expires_at` is the source of truth
  for the countdown (wall + voice both compute remaining from now);
  `duration_sec` is a running sum across explicit extensions, kept for
  audit. `acknowledged_at` flips when someone taps an expired chip.
- **Backend repo + routes** — `createTimer` / `listActiveTimers` /
  `findTimerByLabel` / `extendTimer` / `cancelTimer` / `acknowledgeTimer`.
  `GET/POST/PATCH/DELETE /api/timers` + `POST /api/timers/:id/acknowledge`,
  with `broker.poke('timers')` on every mutation. Zod caps duration at
  [5s, 8h]. `findTimerByLabel(null)` returns the sole active timer (or
  null when ambiguous) — drives the voice "the timer" semantics.
- **Voice executor** — all four timer intents (`_timer_set`,
  `_timer_query`, `_timer_cancel`, `_timer_extend`) hit the real API.
  `humanise_duration` for spoken replies ("10 minutes", "1 hour and 5
  minutes"). `_resolve_target` returns a typed `Literal[no_timer|
  ambiguous|unknown_label]` error tag; `_speak_resolve_error` collapses
  the three identical error ladders that lived in each handler.
- **Wall chip (`TimerStack`)** — bottom-right pill stack, counts down via
  shared `useClock`, flashes red on expiry, tap to cancel (running) or
  dismiss (expired). Explicitly minimal — the visual design pass is
  deferred. Mounted in `WallLayout`.

### The SW bug that ate 30 minutes
First live test on the docker container: chip never appeared after POST,
even though SSE delivered `kind: 'timers'` correctly and React Query's
invalidation fired the refetch. Traced through:
- SSE wire ✓ (curl confirmed delivery)
- KIND_TO_KEYS mapping ✓ (grepped the bundle)
- useTimers mounted with the right query key ✓
- GET /api/timers returning `[]` after POST — wait what

Service worker was using **stale-while-revalidate** for `/api/*`. The cached
`[]` from the initial GET kept being returned to React Query after every
SSE invalidation; the fresh response only updated the cache for *next* time.
The chores feature has been masking this with optimistic mutations; without
an optimistic path, the wall never sees fresh data until the cache happens
to mismatch.

Fix: SW is now **network-first with cache fallback** for `/api/*` GETs.
Network errors fall back to cached if any; otherwise empty 503 (not a fake
`{}` body — that confuses consumers expecting an array). The never-blank
guarantee still holds via the cache fallback path.

### PR review with 5 agents in parallel
Ran `/pr-review-toolkit:review-pr` after pushing the first commit. Agents:
`code-reviewer`, `pr-test-analyzer`, `comment-analyzer`,
`silent-failure-hunter`, `type-design-analyzer`. They converged sharply on
real issues — three critical, eight important, five comment trims.

Worth pulling out the ones that mattered most:
- **`extendTimer` on an expired timer** was adding `addSec*1000` to the
  *stored* `expires_at`. "Add 2 minutes" on a timer that expired 5 minutes
  ago would set new expiry 3 minutes in the past; voice would say "added
  2 minutes — 0 seconds left." Fix: clamp the base to `max(now,
  expiresMs)` before adding.
- **`extendTimer` on a row with malformed `expires_at`** silently produced
  a `RangeError` from `isoUtc(new Date(NaN))` that bubbled to Fastify as an
  opaque 500. Now validates `Number.isFinite(Date.parse(...))` and throws
  `DATA_CORRUPT`.
- **TimerStack mutations had only `onSuccess`** — a failed cancel/ack
  would leave the chip on screen forever with no log, no toast, no
  refetch. Switched to `onSettled` so error paths also invalidate.
- **`useTimers` had `staleTime: 5 * 60_000`** — wrong for a live
  countdown. A remount within 5 minutes serves a stale list. Now `0`.
- **Five comments would have rotted** — "placeholder", "deferred design
  pass", "typically 0-3" (measured number), a CSS keyframe labelled
  "placeholder", and a `humanise_duration` "safety net" branch that was
  unreachable per the math. All trimmed.

### Test backfill
Added 8 backend + 6 voice tests covering the review gaps: duration cap
boundaries (4/5/28800/28801), `extendTimer` past-expiry clamp,
`DATA_CORRUPT` path, `acknowledgeTimer` idempotency preserving
`updated_at`, acknowledge 404, `_timer_extend`'s four missing branches
(no_timer, ambiguous, unknown_label, singleton-no-label), and
`_remaining_seconds` tolerating None + malformed inputs.

### Counts
- Backend tests: 145 → 182 (+37 across both commits)
- Voice tests: 307 → 313 (+6 after review; the timer commit added 13)
- Frontend tests: 62 (no change — chip verified manually via Playwright)
- All builds clean, full E2E loop reverified on the docker container after
  each commit (POST → SSE → chip ticks → expires red → tap → vanishes).

### How to verify
```bash
# Container is running the new code — schemaVersion: 5
curl -s localhost:8787/api/health

# Create a 10s timer; chip should appear bottom-right on the wall
curl -s -X POST localhost:8787/api/timers \
  -H 'content-type: application/json' \
  -d '{"label":"pasta","durationSec":10}'

# Tap the chip on the wall (or, equivalently):
TIMER_ID=$(curl -s localhost:8787/api/timers | jq -r '.[0].id')
curl -s -X POST localhost:8787/api/timers/$TIMER_ID/acknowledge
```

### Not done (deliberately)
- Visual design pass for the chip — placement, chime, expiry animation.
  Today it's a functional placeholder.
- Phone editor manage-timers view — no UI to set timers from the phone
  yet; voice is the only entry point besides direct curl.
- E2E test in CI for the chip — verified manually via Playwright; not
  worth wiring into Vitest for a single component.
- Pi-side deploy of the voice timer intents — code is on
  `feat/voice-intent-matcher`; needs the same kitchen-FP gate as voice v1
  before kitchen rollout.

### Files
- `backend/src/db/migrate.ts` (v5)
- `backend/src/repos/timers.ts` + `.test.ts`
- `backend/src/routes/timers.ts` + `.test.ts`
- `backend/src/schemas.ts` (timerCreate, timerExtend)
- `backend/src/realtime.ts` (`'timers'` poke kind)
- `backend/src/model/types.ts`, `backend/src/server.ts`
- `frontend/public/sw.js` (network-first for `/api/*`)
- `frontend/src/components/timers/TimerStack.tsx`
- `frontend/src/core/{model/types,api/client,hooks/useData,hooks/useRealtime}.ts`
- `frontend/src/layouts/WallLayout.tsx`, `frontend/src/styles/index.css`
- `kiosk/voice/homecal_voice/executor.py` + `executor_test.py`

---

## 2026-06-05 (night) — Regex-first intent matcher (PR #3 + review pass)

Built the HomeBuddy-style pattern-matcher-before-LLM layer. ~80–90% of real
voice utterances fit a known shape ("tonight's dinner is X", "Mia did the
bathroom", "what's for dinner") and don't need an OpenRouter round-trip to
resolve. Matcher emits `IntentResult(source="matcher")`; on miss falls
through to Haiku unchanged. Audit log gains a `source` column so we can
measure hit rate from production data. Branch `feat/voice-intent-matcher`,
PR #3 open.

### Intent inventory first
User asked for a list of current + future intents before writing any
matcher code. Surfaced v1 (4 intents: dinner_set, query_dinner,
query_agenda, chore_complete) plus v2 candidates from spec §15 (event_add,
event_edit, event_delete, query_chores_*, chore_uncomplete, dinner_clear,
query_weather, screensaver_*, set_mute, backup_now). User added **timer**
to the list — recognised it deserves its own backend state + wall UI, not
just an intent. Scope locked via AskUserQuestion: multiple named timers,
memory-only state, matcher-first build with timer intents registered as
no-op until the feature lands.

### 8 tasks, TDD throughout
Built incrementally with tests-first:
- **matcher.py** — `Matcher` class + `IntentPattern` registry. Extractors
  return `IntentResult | None`; None = "regex matched but slot-fill failed,
  try next pattern." `default_matcher` singleton for prod; tests use their
  own.
- **date_phrase.py** — `parse_date_phrase` for "tonight"/"tomorrow"/
  "friday"/"next Monday"/"this Saturday" → ISO date. Possessive (both
  `'s` and `'s`), case-insensitive. Bare day = next occurrence ≥ today;
  `next X` strictly future (skips today even if today is that day).
- **duration.py** — `parse_duration` digit + word numbers (`one`–`twenty`,
  `thirty`–`ninety`, `a`/`an`), abbreviations (`hrs`/`mins`/`secs`),
  combined units (`2 hours and 30 minutes`), filler words (`add 2 more
  minutes`). `extract_timer_label` returns 1–3 word labels (`pasta`,
  `boiled egg`, `flip the steak`) with leading/trailing exclude-word
  strip.
- **aliases.py** — `match_person` (longest name wins, possessive accepted)
  + `match_chore` (restricted to person.id, longest title wins).
  Word-boundary anchored so `Sam` doesn't match `Samuel`.
- **patterns_v1.py** — dinner_set / query_dinner / query_agenda /
  chore_complete patterns + extractors. chore_complete uses a permissive
  verb regex and lets `match_person` + `match_chore` reject false
  positives.
- **patterns_timer.py** — single `\btimer\b` pattern, one extractor that
  branches on verb shape (cancel/stop → cancel; how long/time left →
  query; add/extend + duration → extend; duration → set).
- **Wiring** — `IntentResult` gains `source` field; matcher stamps it
  centrally via `dataclasses.replace`. `main._extract_with_matcher_first`
  fetches family + chores once, tries matcher, falls through to Haiku on
  miss. `_audit` threads source. Executor gets four timer_* handlers (all
  route to "I can't set timers yet").
- **Backend** — migration v4 adds `source TEXT` column. Zod
  `voiceAuditBody.source` enum('matcher','llm').nullable(). Repo updated.

### Comprehensive PR review (5 agents in parallel)
code-reviewer, pr-test-analyzer, silent-failure-hunter,
type-design-analyzer, comment-analyzer.

**Three reviewers independently flagged the same critical bug:**
`_try_execute` audited `status="applied"` regardless of executor's `ok`
flag. The timer no-op (returning `ok=False`) would write a "successful"
audit row + flash green ✓ on the wall while speaking "I can't set timers
yet." Same bug already affected chore_complete unknown-person and empty
query_dinner paths — the matcher just made it widely visible. Fixed by
branching on `out["ok"]`; soft failures audit `failed` with the executor's
error tag (`timer_not_built`, `unknown_person`, `unknown_chore`) for
greppability.

**Other criticals:**
- `query_agenda` over-captured `"whats on netflix"` / `"anything on the
  menu"` → triggered today's agenda. Fixed by requiring a terminal anchor
  on the "on" branch (date phrase, optional punctuation, EOL).
- `chore_complete` at confidence 1.0 + permissive verb regex auto-applied
  questions like `"did Mia do the bathroom?"`. Demoted to 0.8 so it lands
  in the confirm-card flow. Side effect: the mid-confidence path is now
  reachable from the matcher path (was dead code).
- Matcher fall-through (extractor returns None) had no breadcrumb. Added
  `log.debug` so a misfiring regex is debuggable.

**Type tightenings:**
- `IntentSource = Literal["matcher", "llm"]` shared between Pi
  (`intent.py`) and backend (`voiceUtterances.ts`). Typo "match" now
  caught at type-check.
- `Extractor` callable → `Protocol` with explicit `(re.Match, str,
  MatchContext) → IntentResult | None`. Catches arity drift.
- `MatchContext.family/chores` typed `list[FamilyMember]` /
  `list[Chore]` via structural TypedDicts.
- `IntentPattern.name` required (was default `""`). A test already keyed
  off names; the default would silently bypass.

**DB hardening:**
Migration v4 (this PR) now embeds `CHECK (source IN ('matcher','llm') OR
source IS NULL)` on the new column, mirroring the existing status enum
constraint. Closes the direct-SQL escape hatch past Zod.

**Comment hygiene** — three CLAUDE.md violations: `main.py:496` and two
test docstrings referenced "the 2026-06-05 review caught" / "the cascade
saga". All rewritten as standing invariants. `matcher.py` order-of-
registration docstring strengthened with a concrete failure-mode example.
`duration.py` HomeBuddy port attribution dropped — replaced with the
footgun each helper avoids.

### Stats
- Pi tests: 292/292 (was 159 pre-matcher, +133). New test files:
  `matcher_test.py` (12), `date_phrase_test.py` (19), `duration_test.py`
  (23), `aliases_test.py` (23), `patterns_v1_test.py` (31),
  `patterns_timer_test.py` (16). +9 in `main_test.py` (source threading,
  matcher-first wiring, ok=False audit, matcher 1.0 auto-apply,
  backend-fetch propagation), +2 in `executor_test.py` (timer no-op),
  +2 in backend `voiceUtterances.test.ts` (source CHECK + null default).
- Backend tests: 149/149 (was 145).
- Frontend: 62/62 unchanged.
- Build clean.

### Deferred (not PR blockers)
- Unicode-name `\b` word-boundary issue — Python's `re` uses ASCII `\w`
  by default. No homecal family currently has non-ASCII names; pin a
  fix when one does.
- Real-world phrasings missing patterns: `"we're having X tonight"`
  (date trailing), `"dinner tonight is X"`, `"is there anything on
  tomorrow"`. Pattern expansion in a follow-up PR.
- `extract_timer_label` filter-rejection logging — low priority; timer
  feature not built yet.
- `parse_date_phrase` malformed-today warning — defensive, never fires
  today.

### Resume sequence
PR #3 is open with the fix commit pushed. To deploy:
```bash
# Backend container (picks up migration v4)
docker compose up -d --build

# Sync homecal_voice/ to Pi + restart service
rsync -a --exclude '.venv' --exclude '__pycache__' --exclude '*.pyc' \
  kiosk/voice/homecal_voice/ \
  hbadmin@192.168.1.135:/home/hbadmin/homecal-voice/homecal_voice/
ssh hbadmin@192.168.1.135 'sudo systemctl restart homecal-voice'

# Watch hit rate in the audit log
docker compose exec calendar node -e 'const d=require("better-sqlite3")("/data/calendar.db",{readonly:true}); console.log(d.prepare("SELECT source, COUNT(*) FROM voice_utterances WHERE created_at > datetime(\"now\",\"-24 hours\") GROUP BY source").all())'
```

Acceptance gate: after 24h of mixed-source audit data, matcher hit rate
≥ 50% on `applied` outcomes. Lower means too many real utterances are
wandering off-pattern and the registry needs another sweep.

---

## 2026-06-05 (late) — PR #2 review pass + merge to master

Ran the comprehensive PR review (5 specialist agents in parallel) on the
day's `feat/voice-tts-ui-polish` branch. Surfaced four critical and six
important issues that the original "make it work" passes missed because
each agent was focused on a different angle (silent failures, type design,
test coverage gaps, comment rot, general code quality). Addressed all of
them in one fix commit, then merged to master.

### Critical fixes (`879d828`)
- **STT hallucination filter** — cloud audio models occasionally answer
  the user instead of transcribing ("I'm an assistant…", "Please provide
  the audio…"). These aren't blank so they bypassed `_is_blank_transcript`
  and reached Haiku, wasting calls and burying the failure mode in audit.
  New `_is_hallucination` matches a known refusal-phrase set; audited
  with `status="failed", error="hallucination"` for cost-attribution
  greppability (stayed in existing enum, no DB migration).
- **Mic recovery on playback exception** — `_speak` and `_play_didnt_catch`
  had no try/finally. If TTS playback or the MP3 player raised
  (BT speaker drop, OSError), the mic stayed closed and the wall went
  deaf. Wrapped both.
- **`transcribe_with_fallback` exception narrowed** — bare `except
  Exception` silently fell through to local Whisper on auth (401/403),
  quota (402/429), and config bugs. Narrowed to `RequestException` + 5xx
  RuntimeError; 4xx config errors now raise so they're visible.
- **Executor failure handled in run_once** — backend 5xx from `d.execute`
  propagated up and crashed `run_once` before any audit row wrote. User
  got no feedback. New `_try_execute` helper audits `failed` and speaks
  "Sorry, I couldn't reach the calendar."

### Important fixes
- `is_muted_locally` fails safe to muted on outage (was failing open →
  cloud STT kept firing despite operator's intent).
- `_list_bare` propagates HTTP errors instead of silent `[]` returns —
  empty family/chores list made Haiku say "I don't know that person"
  indistinguishably from a real miss.
- Endpointer tuning (`vad_gain`, `energy_rms_threshold`) moved into
  `Config` with env var overrides. Mic swap is now a config change.
- Outdated VAD comment removed (claimed "must send everything to STT"
  but the energy gate fix landed in the same PR).

### Test additions
- `_is_hallucination` unit table + routing test pinning the audit shape.
- Mic recovery on `_speak`/`_play_clip` exception.
- `transcribe_with_fallback`: auth/quota propagate, network falls back.
- Executor + intent-extraction failure audit shape.
- Low-confidence branch plays didn't-catch clip (was only pinned for
  unknown-intent before).
- `wake.reset` called on EVERY exit path — table-driven across applied,
  blank, unknown, stt-exception, intent-exception, executor-exception,
  hallucination. Pins the cascade fix so a refactor can't regress it.

### CLAUDE.md commenting rule
New rule under Conventions: comments explain WHY, not WHAT. No dated
debug narrative ("Measured live 2026-06-05"), no specific measured
numbers that rot when hardware changes ("peak ~3800/32768"), no
references to "the X saga". Research-log content lives in SESSION-LOG.
Trimmed comments accordingly across `main.py`, `endpointer.py`,
`executor.py`, `wake.py`, `stt.py`, `config.py`.

### Merge
- PR #2 merged to master via merge commit `9aaa3df` (matches PR #1's
  convention; preserves the 9 individual commit messages).
- 31 files, +2617/-263.
- `feat/voice-tts-ui-polish` branch deleted (local + remote).
- Tests: 159 passing on Pi venv (was 145 pre-fixes).

---

## 2026-06-05 (afternoon) — Voice v1: cloud STT + endpointer fix + natural speech

Took the round trip from ~17s → ~11s and made it actually work at normal
speaking volume. Five threads, mostly empirical: tried each plausible
fix, measured, iterated. PR #2 still — same `feat/voice-tts-ui-polish`
branch.

### Whisper swap that wasn't (`base.en-q5_1` → `small.en-q5_1`)
First instinct was to optimise local Whisper. Quantised `small.en` →
`small.en-q5_1` on the Pi (922MB → 180MB), updated install script + env
+ unit. **Got slower, not faster** — 13s → 20s on the same query.
Cause: q5_1 on the Pi 5 Cortex-A76 incurs dequant overhead per matmul
that exceeds the FP16 cost — the smaller model wins on memory-bandwidth-
bound hardware, loses on chips with good FP16 SIMD. Kept the swap (used
later as the offline fallback baseline) and pivoted to cloud STT.

### OpenRouter STT model bake-off (the surprise)
Hypothesised cloud STT would land sub-2s. OpenRouter has no dedicated
`/audio/transcriptions` endpoint — audio-in goes through `/chat/completions`
with `input_audio`. 20 audio-input models available; ran each on the
canonical JFK 11s clip:

| Model | Latency | Transcript |
|---|---|---|
| openai/gpt-audio-mini | 1.4–1.6s | clean |
| mistralai/voxtral-small-24b-2507 | 1.6–2.2s | clean |
| google/gemini-2.5-flash-lite | 2.4–3.4s | clean |
| google/gemini-3-flash-preview | 2.6s | clean |
| local whisper.cpp small.en-q5_1 | 21–26s | clean |

13–18× speedup vs local. **But the bake-off lied** — JFK is oratory.
Real-world questions are different. Voxtral on "what's for dinner tomorrow?"
returned `"I'm not sure, what do you feel like?"` — *answering* the
question instead of transcribing it. Mistral's audio model has trained-in
chat behaviour that overrides system prompt instructions. Tried strict
"you are a stenographer, do not answer" prompts. Voxtral kept answering.
Swapped to gpt-audio-mini which followed instructions cleanly — was the
production default for ~30 minutes.

### The post-rsync venv break + cascade reintroduction (`6bca7…`-ish)
A normal `rsync -a` of the source dir to the Pi clobbered the Pi's
`.venv` symlinks with the dev box's absolute paths (uv-managed
interpreter that doesn't exist on the Pi). Service failed with `status=
203/EXEC`. Rebuilt the venv from system python3. Lesson: `--exclude=.venv
--exclude=__pycache__ --exclude='*.egg-info'` from now on.

Restart introduced the post-reply cascade again. Cause: the `wake.reset()`
fix from this morning lived inside `_speak()` only. With Voxtral
hallucinating non-blank refusal text ("I'm an assistant that operates
solely on text-based inputs..."), the flow exited at the unknown-intent
branch — bypassing `_speak` entirely — leaving the openWakeWord LSTM
primed and ambient frames cascading at 0.99+. Fix: moved the reset into
a `try/finally` around the whole `run_once` body so every exit path
(blank STT, unknown intent, STT error, hallucination) clears the model
state. Refactored the body into `_run_after_wake` for clarity.

### Natural-sounding TTS templates
`"Today dinner: Curry."` was the spoken reply and read like a stiff
header. Rewrote spoken templates:
- `Tonight's dinner is Curry.` (possessive for relative dates; ISO date
  falls back to `Dinner on YYYY-MM-DD is ...`)
- `Got it, Curry for today.` (replaced "Saved")
- `Nice work, Mia.` (added comma — Kokoro pauses naturally)
- `Today you've got Soccer at 5pm, Dentist at 9am, and Pickup at 3:30pm.`
  (was: `"On today: Soccer at 17:00, Dentist at 09:00..."`). Two new
  helpers `_speak_time` (HH:MM → 5pm) and `_join_natural` (Oxford comma
  with "and").

### VAD endpointer fix — saved ~5s of the round trip
Silero VAD never crossed threshold even on clear speech (logs showed
`vad max=0.001 mean=0.001` across full captures). Added per-frame peak
diagnostic — peak max=3796 (12% of int16 range). PCM2902 USB mic is
genuinely low-gain, Silero needs `|x| ≳ 0.05` sustained for its
spectral model. Two changes:
- **5× software gain on the VAD input** + peak-normalise the assembled
  audio to 16384 before STT (both in `endpointer.py`, wake path
  untouched). VAD max went 0.001 → 0.079 — still wasn't enough.
- **Energy-RMS secondary gate** at 5500 (boosted), parallel to Silero:
  speech if either fires. First attempt at 700 broke endpointing
  entirely — background noise sits at RMS ~4000 boosted, so every
  frame read as speech and silent_run never accumulated. Raised to
  5500 (above background floor, below speech bursts ~6000–17000).

Result: `endpoint: silence after 31 frames` (2.5s) instead of always
hitting the 100-frame hard cap (8s). Test capture: 20 frames (1.6s).

### Pre-recorded "didn't catch that" fallback
User noticed that quiet utterances → silent_low_conf → silent revert
gave no feedback. Generated a Kokoro clip (`Sorry, I didn't catch that.
Could you try again?`) once, bundled as `clips/didnt_catch.mp3` via
pyproject `package-data`. Play it via the same `_detect_player()` chain
TTS uses, wrapped in `mic_off`/`sleep`/`mic_on` to prevent the BOOM
echoing back into wake. Pre-recorded specifically because the fallback
fires when the cloud STT path is misbehaving — synthesising "didn't
catch that" via TTS risks the same network hiccup.

### The model that actually worked (`gemini-3-flash-preview`)
After the endpointer fix, the dump showed 1.6s of healthy audio (peak
16384, RMS 3206, dynamic 5.1×) — but `gpt-audio-mini` still hallucinated
"Please go ahead and upload the audio file" on it. Sent the same WAV
through six STT models:

| Model | Result |
|---|---|
| gpt-audio-mini | ❌ "Please upload..." |
| voxtral 24b | ❌ Hallucinated *Italian*: "Cosa vuol dire?" |
| gemini-2.5-flash-lite | ⚠️ "What's the meaning" (partial) |
| **gemini-3-flash-preview** | ✅ **"What's for dinner tonight?"** |
| gpt-audio (full) | ❌ "Sure, please provide..." |
| **local whisper.cpp small.en-q5_1** | ✅ "What's for dinner today?" |

Model choice was the bottleneck, not the mic. Swapped default to
`google/gemini-3-flash-preview`. ~600ms slower than gpt-audio-mini but
actually transcribes this mic's signal. Local whisper.cpp stays as the
offline fallback via `transcribe_with_fallback` (tries OR first, falls
back on any RuntimeError).

### OneShotDeps + tests
Added `play_clip: Callable` to `OneShotDeps` for the didn't-catch
fallback. Tests for the new STT models (`transcribe_openrouter`,
`transcribe_with_fallback`), gain helpers (`_boost_int16`, `_peak_normalise`),
energy gate, natural-language templates, didn't-catch playback. All 38
relevant tests pass on the Pi venv.

### Status — green
- **Pi voice service:** end-to-end ~11s, transcribes normal-volume
  speech, plays natural-sounding replies, no cascade.
- **Tests:** endpointer 14/14, executor 26/26, stt 13/13, main 38/38.
- **PR #2:** updated with the day's work.

### Still standing (next session)
- HomeBuddy regex-first intent pattern matcher — saves ~1s of Haiku
  latency + cost on the happy path. Patterns sketched in
  `docs/references/homebuddy-notes.md`. User explicitly deferred until
  audio work settles.
- 24h kitchen FP test + 10-utterance per-family-member accuracy gates.
- Pre-existing SIGTERM `StopIteration` during `systemctl restart` —
  cosmetic, recovers on auto-restart.

### Round trip breakdown (current)
- You talking: ~2s
- Endpoint detect: ~0.7s after stop
- STT (gemini-3-flash-preview): ~1.5–2.2s
- Intent (Haiku 4.5): ~1s
- Executor (homecal API): ~0.3s
- TTS playback (Kokoro): ~1.5–2s
- Post-TTS BT settle: 2s
- **Total: ~9–11s** (was 17s pre-fixes)

---

## 2026-06-05 (day) — Voice v1: live test + TTS fix + the post-TTS wake cascade saga

Pi came back online mid-morning. Did the resume-sequence smoke test, hit
production bugs in TTS, then spent the rest of the day hunting an
increasingly weird false-wake cascade that turned out to be three layers
deep. Ended green: voice command → spoken reply → silence. Merged PR #1
to master mid-session; today's work is on PR #2 (`feat/voice-tts-ui-polish`).

### Pi resume + first live test (`fb374d6` already deployed)
- `rsync` homecal_voice/ to Pi, `pip install -e .[dev]`, restart service.
- `Hey Mycroft. Tonight's dinner is tacos.` → applied (`tacos` → dinners
  row `2026-06-05`), 6.8s round-trip. STT worked, intent parsed at 1.0
  confidence, dinner saved. **But TTS failed with OpenRouter 500.**

### TTS 500 → OpenRouter SDK + Kokoro (`538a4ff` later squashed into PR #2)
- Probed `/audio/speech`: `voice: "default"` + missing `response_format`
  was returning opaque 500. Gemini TTS only supports `response_format=pcm`,
  not mp3.
- Switched default TTS model to `hexgrad/kokoro-82m` (spec-documented
  fallback, MP3 native, cheaper than Gemini). New `TTS_VOICE=af_bella`
  config var wired through.
- Refactored `intent.py` to use the official `openrouter` Python SDK
  (`client.chat.send`). TTS stays on `requests` — SDK v0.9.1 doesn't yet
  wrap `/audio/speech`.

### Meal name canonicalization (`5ac627a`)
- STT was emitting lowercase ("tacos", "pasta"). `_canon_meal()` title-
  cases but preserves all-caps acronyms (`"BBQ chicken"` → `"BBQ Chicken"`,
  not `"Bbq Chicken"`). Applied before both the API payload and the
  spoken reply.
- Backfilled prod rows: `tacos → Tacos`, `pasta → Pasta`.

### UI consolidation: VoiceChip (`44c97f6`)
- Wall had two mic icons stacked in the bottom-right: `MuteToggle` pill
  (interactive) and a floating `EarGlyph` (status-only). Glued on, not
  integrated.
- Replaced both with single state-driven `VoiceChip` in the ControlBar:
  `🎤 say "hey mycroft"` / `listening…` / `thinking…` / `✓ saved Tacos` /
  `🔇 muted · 11:00am` / `⚠ voice offline`. Tap-when-idle opens mute
  presets; tap-when-muted instantly unmutes.
- `VoiceOverlay` shrinks to just the `ConfirmCard` portal. `EarGlyph`
  deleted. Phone keeps `MuteToggle` as-is.

### Quiet-on-empty-wake — tried, reverted
- Implemented Alexa-style silent revert on `had_speech=False`, blank
  transcript, or unknown intent. Pi 400'd on the silent_low_conf audit
  because backend `voiceAuditBody.transcript = z.string().min(1)` — sent
  `""` and the service crashed every utterance. **Fixed with sentinel
  transcripts** (`"[no_speech]"`, `"[blank]"`) at the Pi side (`21290ba`).
- THEN the `had_speech=False` short-circuit broke real speech detection:
  Silero VAD on the PCM2902 mic never crosses threshold 0.5 even on
  clear speech. Reverted that gate; STT now runs on every wake and
  Whisper's blank-transcript output drives the silent revert instead.

### PR reorg + merge
- Split today's work into a new branch `feat/voice-tts-ui-polish`,
  reset `feat/voice-v1` to its pre-today head, force-pushed, then merged
  PR #1 to master (`merge-commit 85728d6`, 44 commits of voice v1
  foundation). Rebased the new branch onto master and opened PR #2.

### UE Boom Bluetooth pairing (no code)
- WS-30052 screen has no speakers + Pi 5 has no 3.5mm jack. Paired the
  user's UE Boom 3 (MAC `10:94:97:29:E5:81`) via `bluetoothctl` one-shot
  commands. PipeWire auto-routed it as default sink (audio-card class,
  vol 0.57). Played a test Kokoro mp3 to confirm.

### STT misrecognition → small.en
- After Bluetooth was working, `"tonight's dinner is curry"` was
  transcribed as `"Friday's dinner is actually curry."` Whisper
  `base.en-q5_1` is too small + quantized — hallucinates phonetic
  neighbors. Switched whisper-server to `small.en` (244M FP16). Better
  accuracy but ~12s STT latency (was ~3s). Worth trying `small.en-q5_1`
  next session for the speed/accuracy balance.
- Fixed the wrong-day row via API: `Curry` moved from `2026-06-12` →
  `2026-06-05`, overwriting `Tacos`.

### The post-TTS wake cascade saga (`8071b55` — the marathon)

After every successful command, 5–10 false wake events fired within 60
seconds, each running through STT + Haiku. At OpenRouter rates that's
real money per minute. Took most of the day; the cause was three layers
deep.

**Layer 1 — Defensive measures** (cut the bleeding while hunting):
- Wake config tighter: threshold `0.5 → 0.7`, trigger_level `1 → 2`.
- Whisper paren-hallucination filter: `_is_blank_transcript` now matches
  `^\s*[\(\[][^\)\]]+[\)\]]\.?\s*$` — `"(wind blowing)"`, `"[silence]"`,
  `"(applause)"` short-circuit to silent_low_conf without a Haiku call.
- Mute gates the **whole** pipeline. Was only blocking TTS — wake/STT/
  Haiku still ran during mute windows and billed for hallucinations.
  Now the wake loop drains frames but skips `wake.step` while muted.

**Layer 2 — The pipe buffer** (necessary but not sufficient):
- `mpg123` blocks the main thread during TTS playback; `pw-record` keeps
  writing to its pipe. Several seconds of TTS-echo audio accumulates in
  the OS buffer. When the wake loop resumes, it reads those frames at
  full pipe-speed and fires on TTS phoneme patterns.
- Fix: stop `pw-record` entirely during TTS. New `mic_off`/`mic_on`
  callables in OneShotDeps. `_speak` does
  `mic_off → speak → sleep(2.0) → mic_on`. The 2s sleep covers BT A2DP
  buffer drain + BOOM 3 speaker physical decay.
- Reordered `post_state(applied)` + `_audit` **before** `_speak` so the
  chip's ✓ flash and 2s auto-fade run in parallel with TTS + drain
  (which together are 5–10s for long replies). User sees confirmation
  immediately instead of staring at "thinking…" for the full reply.

**Layer 3 — openWakeWord's internal state** (the actual cure):
- Even with mic killed and BT drained, wake still fired at 0.987–0.999
  ~3s after `mic_on`. A 60s mic recording during a real test showed
  ABSOLUTE SILENCE during the false-wake window — the model was
  producing high-confidence scores on no audio at all.
- `openwakeword.Model.reset()` is misleadingly named. It only clears
  `prediction_buffer` (the post-processing score deque). The actual
  "memory" lives in `model.preprocessor` (AudioFeatures), which keeps
  FOUR buffers across `predict()` calls:
    - `raw_data_buffer`: deque of recent samples (10s window)
    - `melspectrogram_buffer`: 76×32 mel features (initialized to ones,
      NOT zeros — important)
    - `accumulated_samples`: sample counter
    - `feature_buffer`: 116×96 embedding features
  Those carry context from the user's "Hey Mycroft" + the STT-captured
  speech for ~10 seconds. Fresh post-reply ambient frames combine with
  that context to produce 0.99+ scores on silence.
- `WakeDetector.reset()` now zeros all four preprocessor buffers back to
  `AudioFeatures.__init__` defaults. The feature_buffer rebuild calls
  the embedding ONNX model on 10s of zeros — heaviest line but only runs
  once per TTS cycle.

The diagnostic that broke it open: live `pw-record` capture to wav file,
copied back to dev box for the user to listen to. Confirmed silence in
the false-wake window → ruled out echo/BT tail/ambient → pointed at
model internal state → led to actually reading the `Model.reset()`
source → found it was a no-op for what we needed.

### HomeBuddy reference saved (`dbf71eb`)
User runs a sibling voice-controlled kitchen project at
`/srv/dev/homebuddy/` (Fastify + Postgres + cloud Groq STT + Porcupine
wake word + custom training). They've already solved analogous problems.
Saved `docs/references/homebuddy-CLAUDE.md` (literal snapshot) +
`docs/references/homebuddy-notes.md` (digest of patterns worth
borrowing). Most actionable item for next session: pattern-match common
intents locally before falling through to Haiku — cuts cost on the
happy path.

### Status — green
- **Pi voice service:** stable. Voice command → spoken reply → silence,
  no cascade.
- **Tests:** Pi 120/120, frontend 62/62, backend untouched today, all
  green.
- **PR #1:** merged to master (44 commits of voice v1 foundation).
- **PR #2:** open, 4 commits (TTS fix, meal canonicalization, VoiceChip
  + quiet-on-empty-wake, sentinel transcripts, wake cascade saga,
  HomeBuddy reference).

### Still standing (next session)
- STT model: `small.en` works but slow (12s). Try `small.en-q5_1`
  quantized for speed/accuracy balance.
- VAD `seen_speech=False` on real speech — Silero on PCM2902 mic never
  crosses 0.5. Currently masked (STT runs regardless). Would matter if
  we re-enable any VAD-gated short-circuit.
- Pre-existing SIGTERM `StopIteration` during `systemctl restart` — race
  in next_frame iterator teardown, recovers on auto-restart. Cosmetic.
- Pattern-matching intent extractor before Haiku (from HomeBuddy
  pattern) — cuts cost on the happy path.
- 24h kitchen FP test + 10-utterance per-family-member accuracy ≥80%
  acceptance gates from spec.

### Resume sequence (when needed)

```bash
# Pi service health
ssh hbadmin@192.168.1.135 'sudo systemctl is-active homecal-voice whisper-server'
curl -s http://localhost:8787/api/voice/status

# Bluetooth — BOOM 3 should auto-reconnect; if not:
ssh hbadmin@192.168.1.135 'bluetoothctl connect 10:94:97:29:E5:81'
ssh hbadmin@192.168.1.135 'XDG_RUNTIME_DIR=/run/user/1000 wpctl status | head -25'

# Live smoke test
# Say: "Hey Mycroft. Tonight's dinner is X."
# Expected: chip listening → thinking → ✓ saved X (2s fade)
#           BOOM 3 speaks "Saved X for today."
#           2s sleep → mic back on
#           chip stays idle, no cascade.

# Audit log if you want to see what was captured:
docker compose exec -w /app calendar node -e 'const d=require("better-sqlite3")("/data/calendar.db",{readonly:true}); console.log(JSON.stringify(d.prepare("SELECT created_at, status, substr(transcript,1,50) t FROM voice_utterances ORDER BY rowid DESC LIMIT 10").all(), null, 2))'

# If a false wake cascade reappears, RECORD THE MIC to diagnose:
ssh hbadmin@192.168.1.135 'XDG_RUNTIME_DIR=/run/user/1000 pw-record --rate 16000 --channels 1 --format=s16 /tmp/mic.wav & sleep 60; kill %1'
scp hbadmin@192.168.1.135:/tmp/mic.wav /tmp/
# Listen — silence in the false-wake window points at model state;
# audible TTS tail points at BT chain; ambient points at room/threshold.
```

---

## 2026-06-05 (early hours) — Voice v1: Pi deploy + PR review hardening (paused mid-smoke)

Continuation of the voice v1 session. Got the Pi service running end-to-end,
hit an endpointer bug mid-test, then while Pi was off ran a full PR review
(`/pr-review`) and folded all findings + negative test coverage into the branch.

### Pi deploy (took the night to land)
- Server-side: rebuilt container from `feat/voice-v1`. Migration v3 applied
  (`schemaVersion: 3`). Added `PI_API_TOKEN=${PI_API_TOKEN:-}` env passthrough
  in `docker-compose.yml` + generated a token into `.env` (gitignored).
- Pi-side install was iterative — install script broke in seven distinct ways,
  each fixed in its own commit:
  1. `python3.12` not in trixie apt — loosened `requires-python` to `>=3.11`
     and switched the install to system `python3` (3.13).
  2. `openwakeword>=0.6.0` pulls `tflite-runtime` which has no Py3.13 aarch64
     wheel — pinned to `>=0.4.0,<0.5.0` (the version that scored 0.998 in the
     feasibility test).
  3. `silero-vad>=6.2.1` pulled torch + CUDA toolkit (~900MB) and overflowed
     the Pi's 1GB `/tmp` tmpfs — first attempt: `--no-deps`. Failed because
     `silero_vad/__init__.py` transitively imports torch even without it
     installed. Real fix: vendor `silero_vad.onnx` (1.8MB) via `curl` from
     github raw; `endpointer.load_silero_vad()` searches `SILERO_VAD_ONNX`
     env → package-adjacent path → `~/homecal-voice/silero_vad.onnx`.
  4. whisper.cpp `quantize` target renamed to `whisper-quantize` upstream —
     install script updated to use new target name + binary path.
  5. `/etc/homecal-voice.env` was root:root 0600 but the service runs as
     `hbadmin` — Python-dotenv tried to re-read and got PermissionError.
     `chown hbadmin:hbadmin` (still 0600) — LAN-only Pi, secret-in-userdir
     is acceptable.
  6. `pw-record` couldn't find PipeWire socket from systemd service env —
     added `Environment=XDG_RUNTIME_DIR=/run/user/1000` to the unit.
  7. Silero VAD v6 ONNX requires fixed 512-sample chunks at 16kHz; our 80ms
     (1280-sample) frames blew up the LSTM with 5-dim input. Split each
     frame into 2× 512 in `endpointer.vad()`, take max prob across chunks.

### First end-to-end attempt
Wake word fires at **0.997+ confidence** consistently. Speech captured.
But whisper got `[BLANK_AUDIO]` — the endpointer was closing the recording
~24ms after wake because Python tore through the pre-speech silence backlog
(the gap between "Hey Mycroft" and "Tonight's …") in the pw-record buffer
faster than realtime, hitting `silent_frames_needed=8` before any speech
arrived. Fixed with a `_seen_speech` gate in `Endpointer.feed()` — silence
end can't fire until at least one frame ≥ threshold has been heard. Pushed
the fix (commit `fb374d6`); user shut down for the night.

### PR review (`/pr-review`) — 5 specialist agents
- code-reviewer, pr-test-analyzer, silent-failure-hunter, type-design-analyzer,
  comment-analyzer, code-simplifier in parallel against the 35-commit diff.
- 4 CRITICAL findings, 10 IMPORTANT, 4 NICE-TO-HAVE.

### Critical fixes folded in
- **`tts.py` used `aplay` for MP3** — `aplay` is WAV-only and `check=False`
  hides the failure. Auto-detect mpg123 → ffplay → pw-play → paplay via
  `shutil.which`. `mpg123` added to install script's apt list. Tempfile
  cleanup on exit instead of `/tmp` leak.
- **Chore-complete prompt vs executor mismatch** — `_chore_strings()` was
  building `"Bathroom (Mia)"` strings and the prompt told the LLM to use
  them as-is, but the executor looked up by bare title. Every chore-complete
  would have failed in production with "I don't know that chore for Mia".
  Reformatted as per-person grouping (`"Mia: Bathroom, Dishes"`); prompt
  template tells the LLM that `chore` is a bare title, `person` is a name,
  and the grouping tells you who owns which chore. The unit test was masking
  this because it hand-fixtured `chore="Bathroom"`.
- **`as OverlayAction` cast at SSE boundary** — wall was casting raw `unknown`
  into a discriminated union with `action.intent!` non-null assertions. A Pi
  bug emitting `{kind:'confirming'}` without an intent would crash React with
  "useReducer state is undefined". Added `pokeToAction(raw)` parser that
  rejects: non-object input, unknown kinds (`mute_changed`, future schema
  drift), confirming/applied missing intent, malformed intent shapes,
  NaN/Infinity numbers. Wall now uses `pokeToAction`; cast removed.
- **Reducer no `default` case** — same crash mode for unknown kinds. Added
  `default: return state;` so wire-format drift never produces undefined.
  Also added explicit `intent` presence checks in `confirming` and `applied`
  branches so the `action.intent!` non-null assertion is gone.

### Important fixes folded in
- **SSE reconnect refetch** — useRealtime's refactor dropped the `'open'`
  listener that called `invalidateQueries()` after EventSource reconnects,
  leaving up to 30s of stale UI after network blips. Re-added with a
  `hasOpened` flag — first open is silent (initial connect), every
  subsequent open fires `reconnectHandlers` so `useRealtime()` consumers
  re-fetch.
- **Dead in-memory mute state** — `VoiceState.setMuteUntil/muteUntil/isMuted`
  were never called from any route (DB-backed `voiceSettings` is the source
  of truth). Deleted to remove the drift hazard.
- **Heartbeat timestamp kept milliseconds** — only mixed-precision timestamp
  in the API. Switched to `isoUtc()` from `util/time.ts` so it matches
  spec §0 ("`Z`-suffixed, no millis").
- **Confirm timeout vs no were indistinguishable** — both audited as
  "cancelled" with no audible feedback. Now: `timeout` speaks "I didn't hear
  yes or no — cancelled", `no` speaks "Cancelled.", `edit`/`ambiguous` speak
  "I didn't catch that — say yes or no." Different audit payload reasons
  for each.
- **`confirm_loop` never short-circuited "no audio captured"** — `ep.feed()`
  always appends, so `ep.audio().size` was always > 0; the guard never fired
  and pure silence was being shipped to a paid STT endpoint. Exposed
  `Endpointer.had_speech` as a `@property` and gate the STT call on it.
- **`intent.parse_intent_response` could crash main loop** — `float(obj.get(
  "confidence", 0.0))` raised `ValueError` for `"high"` and `TypeError` for
  `null`; missing required fields produced "valid intent" results that hit
  `KeyError` downstream in the executor. Both now return `intent="unknown"`
  with specific reasons (`bad_confidence`, `missing_fields:date,meal`).
- **`confirm.py` `startswith` matching** — "yesterday" classified as yes,
  "northern lights" as no, "stopwatch" as no. Switched to word-tokenised
  first-word matching; edit hints still beat short no for "no, change …".
- **OneShotDeps god struct** — flagged but deferred (deep refactor; not a
  correctness bug).
- **Pi CI** — flagged but deferred (needs GitHub Actions setup).

### Polish
- All R/T-code prefixes stripped from comments (R3, R4, R13, R14, R15, R16,
  R17, R20, T20b, BUG FIX). Kept substance; in several cases added the failure
  mode that the R-code originally documented in the plan's revision history.
- `EarGlyph` 7-deep nested ternaries → `ICON_BY_KIND` / `LABEL_BY_KIND` tables
  with exhaustiveness checking via `Record<Kind, …>`.
- Magic numbers → named constants (`AUTO_APPLY_CONFIDENCE = 0.85`,
  `SILENT_FAIL_CONFIDENCE = 0.6`, `HEARTBEAT_INTERVAL_SEC = 30`,
  `APPLIED_AUTO_FADE_MS = 2000`, `MUTE_CACHE_TTL_SEC = 5`, etc).
- `timezone.py` shared module — `today_brisbane()` + `BRISBANE_OFFSET_SECONDS`
  replace 3 inline copies of the `+10*3600` math (was in `main.py` twice and
  `executor.py` once).
- `executor.py` dispatch table; `API_TIMEOUT_SEC` + `AGENDA_MAX_ITEMS` constants.
- `main.py` `_audit()` helper consolidates the repeated 7-arg `post_audit`
  calls; `_intent_payload()` consolidates the repeated intent dict.

### Test coverage added — 76 new cases
- **Frontend (vitest):** +16 cases. `pokeToAction` (12), reducer default,
  confirming/applied without intent, cancel returns idle, failed reason.
- **Backend (node:test):** +2 cases. ms-strip invariant, 60s boundary exclusive.
- **Pi (pytest):** +58 cases across 7 modules.
  - `intent_test.py`: bad confidence type (string), null confidence, missing
    field per intent shape, empty/None input, OpenRouter 5xx propagation.
  - `executor_test.py`: unknown person, `assignedTo` composite disambiguation
    (the masked failure mode), `_unwrap` data envelope, query_dinner empty,
    query_agenda empty + 3-item cap + all-day events + Brisbane window
    assertion.
  - `confirm_test.py`: 7 negative cases incl. "yesterday" not yes, "northern
    lights" not no, "stopwatch" not no, edit beats no for "no, change …",
    uppercase normalised, empty + whitespace + punctuation only.
  - `confirm_loop_test.py`: yes/no/edit/ambiguous outcomes, no-speech timeout
    doesn't pay for STT, hard-cap-without-speech short-circuits, backward
    compat for old endpointer fixtures without `had_speech` attr.
  - `main_test.py`: STT exception path, low-confidence silent, unknown intent,
    mid-confidence confirm yes/no/timeout/edit/ambiguous (5 distinct
    outcomes), applied payload structure assertion.
  - `endpointer_test.py`: pre-speech silence backlog regression test,
    `had_speech` False before any threshold frame.
  - `wake_test.py`: refractory exact-N block (predict NOT called during
    refractory), low-score-after-drain doesn't fire.
  - New `timezone_test.py`: offset constant, format check.

Three pre-existing test bugs found during the full pytest run and fixed —
wake refractory call pattern (didn't account for predict-not-called during
refractory window), endpointer assertion math (the `>=` expression evaluated
to 256000 but actual is 16640), confirm_loop `iter([speech()] * 1000)`
exhausted in a 200ms tight loop (millions of iterations). Switched to
`itertools.repeat()` for an infinite source.

### Status — green
- **Backend:** 146/146 tests pass
- **Frontend:** 49/49 tests pass (was 33 before tonight)
- **Pi (pytest):** 109/109 tests pass (was 33 before tonight; ran in a local
  Python 3.13 venv via `uv venv` to validate cross-version)
- **Build:** clean (backend tsc + frontend vite + Pi `py_compile`)
- **44 commits ahead of master** on `feat/voice-v1`. PR #1 open at
  https://github.com/benglo/homecal/pull/1.

### Resume sequence (when Pi is back online)

```bash
# 1) Sync the latest Pi-side code (endpointer fix + all PR-review fixes)
rsync -a --exclude '.venv' --exclude '__pycache__' --exclude '*.pyc' \
  kiosk/voice/homecal_voice/ \
  hbadmin@192.168.1.135:/home/hbadmin/homecal-voice/homecal_voice/

# 2) Install the new mpg123 dep + refresh Python deps; restart service
ssh hbadmin@192.168.1.135 'sudo apt-get install -y mpg123 \
  && source ~/homecal-voice/.venv/bin/activate \
  && pip install -e .[dev] \
  && sudo systemctl restart homecal-voice'

# 3) Pi heartbeat should appear within ~30s
curl -s http://localhost:8787/api/voice/status
# Expected: {"mic_online":true,"last_heartbeat_at":"...","muted":false}

# 4) Reload the kiosk browser
bash kiosk/reload.sh

# 5) Live smoke test
#    Stand ~1m from the mic. Wall corner glyph: "say 'hey mycroft'".
#    Say:  "Hey Mycroft. Tonight's dinner is tacos."
#    Expected within ~6s:
#      glyph: listening → thinking → applied (✓)
#      TTS speaks "Saved tacos for today"
#      curl localhost:8787/api/dinners?start=$(date +%F)&end=$(date +%F)
#      shows the row.

# 6) If wake fires but the cycle stalls again, tail the Pi:
ssh hbadmin@192.168.1.135 'journalctl -u homecal-voice -n 50 --no-pager'
```

### Outstanding (not blocking merge, but worth doing)
- Pi pytest in CI — currently only runs locally on a 3.12+ venv. Add a
  GitHub Actions job for `kiosk/voice/**`.
- `OneShotDeps` → five small Protocols (`AudioSource`, `Endpointer`, `STT`,
  `IntentExtractor`, `Sink`) — flagged by type-design review.
- 24h kitchen FP test (acceptance gate: <2 false wakes/day).
- 10-utterance per-family-member accuracy gate (≥80% reach `applied`).

### Spec & plan
- Spec: `docs/superpowers/specs/2026-06-04-voice-commands-design.md`
- Plan: `docs/superpowers/plans/2026-06-04-voice-commands.md`
- Plan rev 2 + 8 follow-on commits during deploy/PR-review hardening.

---

## 2026-06-04 (cont.) — Voice v1: implemented on `feat/voice-v1` branch

### Built
- **Backend (T1–T5):** migration v3 (`voice_utterances` + `voice_settings`); Pi-token auth helper + voice state singleton; voice repos; 5 new routes (`/api/voice/{state,audit,heartbeat,status,mute}`); SSE foundation widened (`broker.poke(kind, payload?)`, frontend `useSsePoke` hook).
- **Frontend (T6–T9):** voice types + hooks (`useVoiceStatus`, `useMuteVoice`); `VoiceOverlay` + `EarGlyph` + `ConfirmCard` + pure reducer (4 vitest cases); wall integration (`useSsePoke` wiring, `useIdleReset` + `useScreensaver` suppress while voice active); `MuteToggle` on `TogglePill` in ControlBar + phone Manage.
- **Pi service (T10–T20b):** Python 3.12 service under `kiosk/voice/`. Modules: `mic.py` (pw-record subprocess), `wake.py` (openWakeWord WakeDetector), `endpointer.py` (Silero VAD ONNX), `stt.py` (whisper-server client), `intent.py` (Haiku via OpenRouter), `tts.py` (Gemini TTS), `confirm.py` (yes/no/edit grammar), `executor.py` (per-intent dispatch with real homecal API contract: bare arrays, chores.title/assignedTo, chore-complete {date} body), `server_state.py` (state/audit/heartbeat posters), `main.py` (orchestration loop + SIGTERM + heartbeat thread + SSE mute listener + daily request cap), `confirm_loop.py` (5s listening window for mid-confidence confirmations).
- **Deploy (T21):** systemd unit `kiosk/homecal-voice.service` + install script `kiosk/voice-install.sh` (also installs whisper-server systemd unit).

### Design process
- Brainstormed via `superpowers:brainstorming` skill with 3-persona review (senior engineer / voice-audio / family-UX).
- Hardware ground-truthed: USB PCM2902 + Pi 5 + hey_mycroft = 0.998 peak score at 1m.
- Spec + plan went through 2 review rounds; rev 2 folded 20 persona-review findings (R1–R20) inline before execution.
- Subagent-driven execution: fresh implementer per task, two-stage review (spec compliance + code quality) per task; 1 inline fix loop per task on average.

### Tests
- Backend: 145/145 pass (incl. 8 new voice route tests + voice repo tests + state/auth tests).
- Frontend: 33/33 pass (incl. 4 voiceState reducer tests).
- Pi service: 30+ pytest tests written; runs on Pi only (Python 3.12). Local syntax verified via `python3 -m py_compile`.
- Build: backend tsc + frontend vite both clean.

### Spec & Plan
- Spec: `docs/superpowers/specs/2026-06-04-voice-commands-design.md` (a6ca56b → 2fec177)
- Plan: `docs/superpowers/plans/2026-06-04-voice-commands.md` (2610824 → 367af35 rev 2)

### Deploy + next session
- All work on `feat/voice-v1` branch; needs merge to master.
- Pi install: `bash kiosk/voice-install.sh` (creates venv with python3.12, builds whisper.cpp, installs both systemd units).
- Env file `/etc/homecal-voice.env` needs: OPENROUTER_API_KEY, HOMECAL_API_BASE, PI_API_TOKEN.
- Acceptance gate before merging: 24h kitchen FP test (target <2 false wakes/day) + 10-utterance per-family-member accuracy ≥80%.

---

## 2026-06-04 — Recurrence overrides: design locked (no code yet)

### What happened
- Shipped dinner upgrade to the Pi (`docker compose up -d --build` +
  `bash kiosk/reload.sh`).
- Brainstormed the next roadmap item: **single-occurrence event overrides**
  (the long-deferred v2 from spec §10). Scoped tighter than expected once
  the existing code was read.

### Discovery (what's already done)
- `event_exceptions` table has `kind/title/start/end_at/location` columns
  (migration v1).
- `recurrence.ts:67` already overlays `kind='modified'` exceptions on read.
- `cancelOccurrence` write path and `DELETE /api/events/:id/occurrences/:date`
  already wired (kind='cancelled').
- **Gap is just the write path for `modified`** + the editor UX flow.

### Locked design decisions
- **Scope:** "this event only" edit (modify exception). "This-and-following"
  edit/delete remain deferred — not on this work.
- **API:** `PUT /api/events/:id/occurrences/:date` body
  `{title?, start?, end?, location?}` (only present fields overridden).
  `DELETE /api/events/:id/occurrences/:date` collapsed to delete-whatever-
  kind-exists (PK is `(event_id, date)` so one row max).
- **UX:** Prompt on Save (Apple-style). User edits the form freely; pressing
  Save opens a small scope sheet — "This event only / All in series" —
  reusing the existing delete-scope pattern. A "Reset to series default"
  footer button appears when the occurrence has an existing modified
  exception.
- **No visual marker** on overridden occurrences (user call) — they just
  render with the overridden values. Family trusts the wall.
- **Not overridable:** category, all_day, rrule (schema doesn't support;
  YAGNI). `start`/`end` can shift time but not move to a different day —
  cross-day moves = delete + create.
- **iCal RECURRENCE-ID export** — out of scope; separate follow-up.

### Status
- Brainstorming complete; spec doc + implementation plan not yet written.
- Container is running the dinner upgrade in prod on the LAN.

### Next session
- Write `docs/superpowers/specs/2026-06-04-recurrence-overrides-design.md`,
  user reviews, then `writing-plans` → subagent-driven execution.

---

## 2026-06-03 — Dinner planning upgrade

### What was built
- **`GET /api/dinners/suggestions`** — derived from the dinners table via a
  SQLite window-function query that deduplicates case-insensitively and ranks
  by frequency then recency then meal-name (deterministic tiebreaker for
  canonical casing). Returns `{ meal, count, lastUsed }[]`; Zod-validated
  `?limit=` (default 50, max 200, `VALIDATION` 400 on bad input).
- **`dinnerUpsert`** schema gained `.trim()` so `"Tacos "` and `"Tacos"`
  collapse on write (prevents long-tail history rot).
- **`DinnerEditorSheet`** rebuilt to own its own date + week-anchor state. A
  new `DinnerDateStrip` (7×72px pills, 64×64 chevrons) sits at the top; the
  sheet fetches its own `useDinners(start, end)` via the shared `weekDates`
  util so its query key collides with the parent layouts' identical query
  and TanStack dedupes the network call. Save no longer auto-closes — the
  user closes with Done/X. A "Saved" pill flashes for ~2s on successful
  save (sticky top-right of body scroll so it stays visible). Footer
  wording is dynamic: "Cancel" while edits are unsaved, "Done" once
  `meal === currentMeal`. A new `DinnerSuggestionsList` renders below
  the input; `filterSuggestions` does case-insensitive contains.
- **HeroBand day cells** are now `<button>`s. Empty cells show a `+`;
  planned cells show a pencil (18–20px, opacity 0.75). The "— tap to add"
  CTA in the Tonight panel is gone (cards make the affordance now).
  WallLayout passes `onTapDay` → opens the editor pre-filled. While the
  editor is open the wall's 90s idle dismiss is suppressed.
- **Cache invalidation** — `useDinnerMutations.settle` now also invalidates
  `['dinner-suggestions']` for instant local feedback; the `dinners` SSE
  poke fans out to the same key so cross-device edits stay fresh.

### Design process
- 3-persona pre-implementation review of the plan (senior engineer, UX, DBA)
  caught 4 blockers + ~9 strong concerns: broken test-injection pattern,
  wrong error code, undersized chevrons, idle-reset wiping the editor,
  broken-build commit sequence, missing Save feedback, ambiguous Cancel/Done
  wording, non-deterministic SQL canonical casing, missing trim-on-write,
  week-key drift between parent + modal queries. All folded into plan rev 2
  before implementation.
- Subagent-driven execution: fresh implementer per task, spec-compliance
  reviewer then code-quality reviewer per task. Quality reviewer on Task 9
  caught an Important Saved-pill scroll-with-content bug (absolute inside
  overflow-y-auto); fix subagent made it sticky in one commit.

### Tests
- +5 backend repo tests (`listSuggestions` truth-table incl. deterministic
  tiebreaker).
- +5 backend route tests (default + explicit limit + non-numeric + zero +
  trim-on-write).
- +6 frontend unit tests (`filterSuggestions`).
- Backend 124/124, frontend 29/29, build clean.
- Manual Playwright verify at 1280×800: hero strip glyphs, editor open
  pre-filled, "Matches" typeahead, Saved pulse, dynamic Done/Cancel, next
  week chevron, end-to-end save reflected on wall via SSE.

### Verify
```bash
npm --workspace backend test
npm --workspace frontend test
npm run build
docker compose up -d --build
bash kiosk/reload.sh
# Wall: tap any day pill in the hero strip → editor opens with that date.
#       chevrons in the strip step weeks; typing partial meal name → matches.
```

---

## 2026-06-02 — Chores board + whole-codebase cleanup

### What was built

#### Chores board (M5)
- **3 new SQLite tables** — `family_members`, `chores`, `chore_completions`. v2 migration via
  the existing `user_version` runner. CHECK constraints on `(frequency, day_of_week)` (DB layer
  has a known three-valued-logic gap on `(weekly, NULL)` — closed at Zod + repo layers).
  Composite PK `(chore_id, completed_date)` makes completion idempotent.
- **Backend CRUD** — `/api/family-members` (CRUD with 409 on duplicate name) and `/api/chores`
  (CRUD + `INVALID_DAY_OF_WEEK` on bad frequency/dayOfWeek combos).
- **Board endpoint** — `GET /api/chore-board?date=YYYY-MM-DD` (defaults to today in Brisbane).
  3-query design: members (name order) + due chores (LEFT JOIN completions, frequency filter
  via `strftime('%w', date)`) + all-time star totals (COALESCE sum, INNER JOIN). No N+1.
- **Completion endpoints** — `POST /api/chores/:id/complete` returns 201 first time, 200 on
  idempotent re-complete; `DELETE /api/chores/:id/complete/:date` returns 204 or 404.
- **SSE poke kinds** — added `'chores'` and `'family-members'`. Frontend `KIND_TO_KEYS` fans
  these out to invalidate both the entity list and the `chore-board` query.
- **Wall UI** — `⭐ Chores` view in ControlBar. `ChoresBoard` renders columns per member with
  icon + name + ⭐ totalStars. `ChoreCard` is a tap-to-complete button (disabled when done)
  with `choreCardPop` animation. `StarBurst` fires N ⭐ particles from card to star counter
  via `starFly` keyframe + CSS custom props. `useChimeSound` plays a Web Audio sine sweep
  (muted 8pm-7am Brisbane).
- **Optimistic completion** — `useChoreCompletion` flips `completed:true` and bumps
  `totalStars` in the cache before the request, rolls back on error. Guards against double-tap
  (skips if already completed) so star bump can't double-count.
- **Phone managers** — `FamilyMemberManager` (list, edit, delete with cascade warning, add)
  and `ChoreManager` (grouped by member, frequency toggle, day-of-week picker storing 0=Sun,
  position swap via two sequential PUTs).
- **`useBrisbaneDate`** hook — returns today's Brisbane date, re-evaluates at local midnight
  (luxon-based; the frontend already had luxon).

#### Whole-codebase DRY + god-files review
Three parallel review agents (backend / frontend / cross-cutting) audited the post-chores
branch. Triage doc saved at `docs/superpowers/reviews/2026-06-02-dry-godfiles-review.md`.
Four cleanup PRs landed.

- **PR 1** — `nowIso`/`uniqueOr` lifted to backend utils; frontend `maxLength` on TextInputs
  to match backend Zod caps; blank-icon disables Save in both managers; `ChoreManager.move`
  chains the second mutation in the first's `onSuccess` (so a partial failure no longer leaves
  duplicate positions); `BRISBANE_OFFSET_MS` documented (frontend uses luxon
  `Australia/Brisbane`; if Brisbane ever adopts DST the constants will skew by 1h).
- **PR 2** — Manage primitives extracted: `SectionHeading`, `ManagerRow`,
  `InlineConfirmDelete`, `InlineAddButton` (`components/manage/primitives/`). `TogglePill` +
  `TogglePillGroup` extracted (`components/ui/`). 6 toggle-pill sites migrated. ChoreManager
  split into `ChoreManager` + `ChoreForm` + `ChoreRow`: **642 → 247 lines**.
- **PR 3** — `registerCrud` helper handles the 4 standard handlers
  (`GET list / POST 201+poke / PUT 200+poke / DELETE 204+poke`). `familyMembers`, `categories`,
  and `chores` migrated; `events` left bespoke (its list endpoint takes a window query and
  returns expanded occurrences — different shape). Test bootstrap helpers
  (`setupIsolatedDb`, `createTestApp`) lifted to `backend/src/test/util/bootstrap.ts`.
- **PR 4** — `EventEditorSheet` split into `EventEditorBody` + `EventForm` +
  `EventRecurrenceField` + `EventDeleteConfirm`: **349 → 26 lines**. Generic `optimisticPatch<T>`
  helper in `core/hooks/optimisticPatch.ts`; `useChoreCompletion` adopted it.

### Design process
- Brainstorming sub-skill → spec doc + 3-persona review (Parent A, Parent B, Senior Engineer).
- Writing-plans sub-skill → 15-task implementation plan with explicit task boundaries.
- Subagent-driven execution: per task a fresh implementer + spec reviewer + code-quality
  reviewer. Caught + fixed a real bug mid-stream: `updateChore` could PATCH `frequency=daily`
  while preserving a non-null `dayOfWeek`, producing a 500 from the DB CHECK; added
  `INVALID_DAY_OF_WEEK` 400 in the repo (commit `feca914`).
- Final cross-cutting review caught `StarBurst` was wired-but-never-rendered. Plumbed it
  through `ChoreCard` in `46b8d20` so the star-fly animation actually fires.

### Tests
- **+38 backend tests** — 12 board truth-table cases (daily, weekly, completion, idempotency,
  cascades, CHECK violations), 9 family-member route integration tests, 17 chore route
  integration tests.
- **+4 frontend tests** — `useBrisbaneDate` logic-only (no React testing infra in this project).
- Backend **114/114**, frontend **23/23**, build clean throughout.

### Files changed
Too many for a flat list this session — roughly 30 new files plus modifications. Highlights:
- New backend: `repos/{familyMembers,chores}.ts`, `routes/{familyMembers,chores}.ts`,
  `routes/crud.ts`, `test/util/bootstrap.ts`, migration v2 in `db/migrate.ts`.
- New frontend: `components/chores/{ChoresBoard,MemberColumn,ChoreCard,StarBurst,useChimeSound}`,
  `components/manage/{FamilyMemberManager,ChoreManager,ChoreForm,ChoreRow}`,
  `components/manage/primitives/{SectionHeading,ManagerRow,InlineConfirmDelete,InlineAddButton}`,
  `components/ui/TogglePill`, `components/sheets/event/{EventEditorBody,EventForm,EventRecurrenceField,EventDeleteConfirm}`,
  `core/hooks/{useBrisbaneDate,optimisticPatch}.ts`.
- Touched: `realtime.ts` (PokeKind), `schemas.ts` (+Zod), `model/types.ts` (both workspaces),
  `useMutations.ts` / `useData.ts` / `useRealtime.ts`, `WallLayout.tsx`, `PhoneLayout.tsx`,
  `ControlBar.tsx`.

### Deploy
- Container rebuilt + restarted in dev (`docker compose up -d --build`).
- v2 migration applied to existing DB on first boot; `schemaVersion: 2` reported by
  `/api/health`. No data loss — events/categories/dinners untouched.
- Kiosk reload deferred (no family members or chores seeded yet; nothing to display).

### Verify
```bash
npm --workspace backend test          # 114/114
npm --workspace frontend test         # 23/23
npm run build                         # clean
curl -s localhost:8787/api/health     # {"ok":true,"db":"ok","schemaVersion":2}
curl -s localhost:8787/api/chore-board  # {"date":"2026-06-02","members":[]}
# Phone: manage tab → add family members and chores
# Wall: ⭐ Chores button shows the board with tap-to-complete + star animation + chime
bash kiosk/reload.sh                  # once there's something to display
```

---

## 2026-06-02 — v2: Weather sidebar + wall UI polish

### What was built

#### Docker fix
- **Backend workspace node_modules** — `@fastify/multipart` was hoisted into `backend/node_modules/`
  by npm workspaces but the Dockerfile only copied root `node_modules/`. Container was crashing on
  startup. Fixed by adding `COPY --from=build /app/backend/node_modules ./backend/node_modules`.

#### Wall UI polish
- **Australian date formatting** — ControlBar period labels now day-first (e.g. "2 – 8 Jun" not
  "Jun 2 – 8"). FullCalendar locale set to `en-au`. Agenda view shows single date with daily
  stepping ("Tuesday 2 Jun") instead of a 10-day range.
- **Week view chevron nav** — changing weeks with chevrons now updates the FullCalendar grid
  (key includes date so FC remounts on nav).
- **Kiosk reload command** — `/reload-kiosk` slash command + `kiosk/reload.sh` documented in CLAUDE.md.

#### Weather sidebar (BOM observations)
- **`GET /api/weather`** — proxies Australian Bureau of Meteorology JSON observations for Brisbane
  (station IDQ60901/94576, configurable via `BOM_STATION_CODE`/`BOM_STATION_ID` env vars).
- **In-memory cache** — 15-min TTL. On fetch failure with existing cache → returns stale data with
  `stale: true`. On fetch failure with no cache → 503 with error envelope. No DB, no filesystem cache.
- **Eager prefetch** — `getCachedWeather()` called fire-and-forget after `app.listen()` so the cache
  is warm before the first request.
- **Logging** — `warn` on fetch failure, `info` on first success and recovery after failure.
  Avoids logging every successful 15-min fetch.
- **No new dependencies** — uses Node 20 built-in `fetch` with `AbortSignal.timeout(10s)`.
- **Frontend** — `WeatherSidebar` component in HeroBand right panel: condition icon (day/night aware —
  Sun/Moon for clear, Cloud/CloudMoon at night) + 32px temperature + feels-like + humidity.
  Clock tightened (64→56px time, 26→22px date) to make room. Stale weather rendered at 60% opacity.
  Weather section returns null when unavailable (additive, never breaks display).
- **TanStack Query** — `useWeather()` hook, 15-min refetch, `staleTime: 0` (backend cache is
  authoritative), `retry: 1`, `refetchOnWindowFocus: false`.

### Design process
- 3-persona review (senior engineer, UX, SRE) of the implementation plan before coding.
- Key findings adopted: eager prefetch, staleTime:0, fetchedAt timestamp over boolean stale,
  drop wind (not actionable), tighten clock, 60% opacity for stale, weather out of healthcheck,
  warn-level logging on failure.

### Tests
- 28 new backend tests in `weather.test.ts`: safeParseFloat (6), mapBomCondition (15),
  fetchBomWeather (4: parse/non-200/bad-structure/empty), getCachedWeather (3: TTL/stale/throw).
- Backend 76/76, frontend 19/19, build clean.

### Files changed
- `Dockerfile` — added `COPY --from=build /app/backend/node_modules`
- `backend/src/config.ts` — added `bomStationCode`, `bomStationId`, `bomStationName`, `weatherCacheTtlMs`
- `backend/src/weather.ts` — new: BOM fetch + in-memory cache + condition mapping
- `backend/src/routes/weather.ts` — new: GET /api/weather route
- `backend/src/routes/weather.test.ts` — new: 28 tests
- `backend/src/server.ts` — registered weatherRoutes, eager prefetch
- `frontend/src/core/model/types.ts` — added WeatherData type
- `frontend/src/core/api/client.ts` — added weather() method
- `frontend/src/core/hooks/useData.ts` — added useWeather() hook
- `frontend/src/components/weather/weatherIcons.ts` — new: condition → lucide icon mapping
- `frontend/src/components/weather/WeatherSidebar.tsx` — new: weather display component
- `frontend/src/components/hero/HeroBand.tsx` — integrated WeatherSidebar, accepts weather prop
- `frontend/src/components/primitives/Clock.tsx` — tightened sizing (56px/22px)
- `frontend/src/components/controls/ControlBar.tsx` — Australian date format, daily agenda step
- `frontend/src/components/calendar/GridCalendar.tsx` — key includes date, locale en-au
- `frontend/src/layouts/WallLayout.tsx` — wired useWeather, daily agenda step

### Verify
```bash
npm --workspace backend test          # 76/76
npm --workspace frontend test         # 19/19
npm run build                         # clean
docker compose up -d --build
curl -s localhost:8787/api/weather | jq .  # {"temperature":24,"condition":"Clear",...}
bash kiosk/reload.sh                  # reload Pi
# Wall: HeroBand shows weather icon + temp + feels-like + humidity in right panel
# Agenda: chevrons step one day, label shows "Tuesday 2 Jun"
# Week: chevrons update the calendar grid
# Month: unchanged
```

---

## 2026-06-01 (cont.) — v2: Photo screensaver + ControlBar redesign

### What was built

#### ControlBar redesign
- **Centered period label** — `‹ Jun 1 – 10 ›` between circular nav buttons (was static "Today" label).
  Adapts to view: "Jun 1 – 10" (agenda), "Jun 1 – 7" (week), "June 2026" (month).
  Handles cross-month ranges ("May 26 – Jun 1").
- View switcher pill left, Today chip + FAB right. Category legend removed.

#### Photo screensaver backend
- **`POST /api/photos`** — multipart upload via `@fastify/multipart`. `sharp` resizes to max 1920px
  long edge, strips EXIF, converts to JPEG q80. `sequentialRead`, 100MP pixel limit, 10s timeout.
  Accepts JPEG/PNG/WebP/HEIC only. 500 photo cap (configurable via `MAX_PHOTO_COUNT`).
- **`GET /api/photos`** — filesystem listing (no DB table), newest-first via UUIDv7 sort.
  Returns `{ data: [{ id, filename, url, createdAt }] }`.
- **`DELETE /api/photos/:id`** — soft-delete to `DATA_DIR/photos/.trash/`. Auto-purge after 7 days
  on server startup.
- **`GET /api/photos/:filename`** — serves resized JPEG. Strict UUIDv7 regex + path traversal guard.
  Headers: `image/jpeg`, `nosniff`, `immutable` cache.
- **Security:** FILENAME_RE validation, `startsWith` path check, format validation via `sharp.metadata()`,
  original buffer never written to disk.

#### Photo screensaver frontend (wall)
- **5-minute idle timer** — independent of the 90s idle reset. Resets on `pointerdown`/`touchstart` only.
- **Dual-buffer Ken Burns slideshow** — two `<img>` elements with GPU-composited `scale3d`/`translate3d`.
  10s per photo (20s for ≤3, 30s for 1), 1.5s crossfade. Outgoing buffer frozen during transition.
- **Portrait-aware** — detects via `naturalWidth`/`naturalHeight`, reduces pan range.
- **Fisher-Yates shuffle** — no repeats until exhausted, then reshuffle. List refreshed from API each
  activation. Broken images skipped via `skipPhoto()` (removed from queue). 8s load timeout.
- **Clock overlay** — bottom-left, 48px time (weight 300), 16px date (uppercase), tabular-nums.
  Gradient scrim (25%, rgba(0,0,0,0.55)) + text-shadow safety net.
- **Reduced motion** — `prefers-reduced-motion: reduce` disables Ken Burns, keeps simple crossfade.
- **Dismiss** — any touch fades out (300ms), re-arms timer, invalidates TanStack Query cache.

#### Photo manager (phone)
- **Manage tab section** — below Categories. Header with count badge ("5 photos · max 500").
- **3-column square grid** — thumbnails with `object-fit: cover`, lazy loading.
- **Upload** — native file picker (multiple, accept JPEG/PNG/WebP/HEIC). XHR with per-file progress bar.
- **Delete** — tap thumbnail → preview overlay → Delete button (two-tap protection).

#### Remote kiosk shutdown
- **`POST /api/kiosk/shutdown`** — server proxies to a tiny socat-based HTTP listener on the Pi
  (port 8788). Requires `KIOSK_HOST` env var. Returns 503 if not configured, 502 if Pi unreachable.
- **Pi service** — `kiosk/shutdown-service.sh` + `homecal-shutdown.service` systemd unit. Listens
  for `POST /shutdown`, responds 200, then runs `sudo shutdown -h +0`.
- **Phone UI** — "Shutdown display" button at bottom of Manage tab with confirmation step.

### Design process
- 3-persona review (UX/kiosk, backend/infra, security) of the screensaver spec before implementation.
- Key findings addressed: GPU compositing hints, clock sizing for 1-2m viewing, portrait photo handling,
  `@fastify/multipart` streaming, strict filename regex, soft-delete for recovery, photo count cap,
  format restriction (no SVG/TIFF/GIF).

### Tests
- 18 new backend tests in `photos.test.ts`: initPhotos, FILENAME_RE, savePhoto (write/convert/cap/resize),
  listPhotos (sort/exclude), softDelete (move/idempotent), purgeTrash, photoPath (valid/traversal/invalid).
- 4 new frontend tests: Fisher-Yates shuffle (completeness, immutability, single, empty).
- Backend 48/48, frontend 19/19, build clean.

### Files changed
- `backend/package.json` — added `sharp`, `@fastify/multipart@8`, `@types/sharp`
- `backend/src/config.ts` — added `photosDir`, `maxPhotoCount`, `kioskHost`, `kioskPort`
- `backend/src/photos.ts` — new: storage module (init, list, save, softDelete, purgeTrash, photoPath)
- `backend/src/routes/photos.ts` — new: photo API routes
- `backend/src/routes/photos.test.ts` — new: 18 tests
- `backend/src/server.ts` — registered photoRoutes, initPhotos, purgeTrash at startup
- `backend/src/realtime.ts` — added 'photos' to PokeKind
- `frontend/src/core/model/types.ts` — added Photo type
- `frontend/src/core/api/client.ts` — added photos/deletePhoto to api object
- `frontend/src/core/hooks/useData.ts` — added usePhotos() hook
- `frontend/src/core/hooks/useMutations.ts` — added usePhotoMutations() hook
- `frontend/src/components/screensaver/useScreensaver.ts` — new: idle timer + shuffle hook
- `frontend/src/components/screensaver/Screensaver.tsx` — new: Ken Burns slideshow component
- `frontend/src/components/screensaver/useScreensaver.test.ts` — new: 4 shuffle tests
- `frontend/src/components/manage/PhotoManager.tsx` — new: phone photo manager
- `frontend/src/components/controls/ControlBar.tsx` — redesigned: centered period label
- `frontend/src/layouts/WallLayout.tsx` — mounted Screensaver, passed anchor to ControlBar
- `frontend/src/components/manage/KioskShutdown.tsx` — new: shutdown button with confirmation
- `frontend/src/layouts/PhoneLayout.tsx` — added PhotoManager + KioskShutdown to Manage tab
- `backend/src/routes/kiosk.ts` — new: kiosk shutdown proxy route
- `kiosk/shutdown-service.sh` — new: Pi-side socat HTTP listener
- `kiosk/homecal-shutdown.service` — new: systemd unit for the shutdown listener

### Verify
```bash
npm --workspace backend test          # 48/48
npm --workspace frontend test         # 19/19
npm run build                         # clean
rm -rf /tmp/d && DATA_DIR=/tmp/d STATIC_DIR=frontend/dist PORT=8799 node backend/dist/server.js &
sleep 2
# Upload
node -e "require('sharp')({create:{width:800,height:600,channels:3,background:{r:200,g:50,b:50}}}).jpeg().toFile('/tmp/test.jpg')"
curl -s -X POST -F "file=@/tmp/test.jpg" localhost:8799/api/photos | jq .
curl -s localhost:8799/api/photos | jq '.data | length'  # 1
curl -sI localhost:8799/api/photos/$(curl -s localhost:8799/api/photos | jq -r '.data[0].filename') | grep content-type
kill %1
# Wall screensaver: open ?mode=wall, wait 5 min (or temporarily set IDLE_MS=10000), touch to dismiss
# Phone: open /, tap Manage tab, upload/delete photos
```

---

## 2026-06-01 (cont.) — v2: iCal subscription feed

### What was built
- **`GET /api/feed.ics`** — read-only iCalendar (RFC 5545) subscription feed. Phones on the LAN
  subscribe to this URL to get native calendar notifications without an account.
- **Events → VEVENTs** with native RRULE + EXDATE (not pre-expanded). UID `{id}@homecal`, CATEGORIES
  from category name, LOCATION when present, LAST-MODIFIED from updatedAt.
- **Dinners → all-day VEVENTs** with `Dinner: {meal}` summary, UID `dinner-{date}@homecal`.
- **RRULE+EXDATE** via ical-generator's raw-string path: EXDATE lines appended to the RRULE string.
  VALUE=DATE for all-day events, UTC datetime for timed events.
- **Per-event try/catch** — one bad record never breaks the whole feed.
- **Calendar envelope:** PRODID `-//homecal//EN`, METHOD PUBLISH, CALSCALE GREGORIAN,
  X-WR-TIMEZONE Australia/Brisbane.
- **Headers:** `text/calendar; charset=utf-8`, `Content-Disposition: inline`, `Cache-Control: no-cache`.
- New dependency: `ical-generator` (backend only, CJS-compatible via exports map).

### Design process
- 3-persona review (iCal standards, security, backend engineer) before implementation.
- Key findings addressed: DTSTAMP = generation time (not updatedAt), EXDATE VALUE=DATE branching,
  CALSCALE:GREGORIAN, CRLF injection test, per-event resilience, flat queries (no N+1).

### Tests
- 11 new tests in `feed.test.ts`: empty calendar, timed event, all-day, RRULE, EXDATE (timed + all-day),
  dinner, CRLF injection, bad RRULE resilience, metadata, LAST-MODIFIED.
- Backend 30/30 (19 existing + 11 new), frontend 15/15, build clean.

### Files changed
- `backend/package.json` — added `ical-generator`
- `backend/src/repos/events.ts` — added `listAllMasters()`, `listAllCancelledExceptions()`
- `backend/src/repos/dinners.ts` — added `listAllDinners()`
- `backend/src/routes/feed.ts` — new: buildFeed() pure function + feedRoutes plugin
- `backend/src/routes/feed.test.ts` — new: 11 tests
- `backend/src/server.ts` — registered feedRoutes

### Verify
```bash
npm --workspace backend test          # 30/30
npm --workspace frontend test         # 15/15
npm run build                         # clean
rm -rf /tmp/d && DATA_DIR=/tmp/d STATIC_DIR=frontend/dist PORT=8795 node backend/dist/server.js &
curl -s localhost:8795/api/feed.ics   # valid VCALENDAR
curl -sI localhost:8795/api/feed.ics | grep content-type  # text/calendar
kill %1
# Subscribe on phone: Settings → Calendar → Add Account → Other → URL: http://server:port/api/feed.ics
```

---

## 2026-06-01 (cont.) — Kiosk UX overhaul: keyboard, FAB flow, modals

### Virtual keyboard improvements
- **Bigger keys** — 56px tall buttons, 18px font, day/night themed via CSS custom properties
  (`keyboard.css` overrides react-simple-keyboard defaults).
- **Done button** — accent-colored toolbar bar above the keyboard to dismiss.
- **Scroll into view** — `--kb-height` CSS variable broadcast by the keyboard; Sheet and modal
  containers use it to shrink above the keyboard. Input scrolls into view after layout settles
  (double-rAF measurement to avoid reading 0 on Pi).
- **Shift auto-reset** — Shift reverts to lowercase after one character (Caps Lock still toggles
  sticky). Was latching permanently before.

### FAB → AddChooser → category-specific form
- **AddChooser overlay** — FAB now opens a centered chooser dialog ("What are you adding?") with
  large colored category tiles in a grid. Dinner separated below a divider.
- **Category tap → QuickAddSheet** — pre-selected category shown as a read-only chip; form has
  only Title + When (no in-form category picker needed).
- **Dinner tap → DinnerEditorSheet** — "Dinner · Monday 1 June" title, single "What's for dinner?"
  input. Creates the correct dinner entity (not an event with Dinner category).
- Dinner filtered by stable id (`cat-dinner`) not display name. Color/icon looked up from the
  categories API response, not hardcoded.

### Sheet → Modal conversion
- Sheet component gained `variant` prop: `'modal'` (centered, 640px wide, default) vs `'sheet'`
  (bottom-anchored, full-width).
- All editor sheets (QuickAdd, Dinner, EventEditor, CategoryEditor) render as centered modals —
  better for a 10" fridge-mounted screen at eye level.
- DayDetailSheet stays as a bottom sheet (read-only glance, `variant="sheet"`).

### Kiosk touch target sizing (UX persona review)
- Close button 40→48px with visible `bg-surface-2` background.
- Footer buttons 44→52px min-height, 17px font.
- Field labels 13→14px, more margin below.
- Input padding 11/13→12/14px.
- All Day / Repeat buttons 40→48px.
- DayDetail event rows: padding increased, color strip 4→6px, time/location text 13→14px.

### Removed left border from calendar chips
- Week/month view event chips no longer have `borderLeft: 4px solid` — the tinted background fill
  + icon + label already carry the category signal (per the colourblind-safe spec).

### Code review fixes (8 findings)
1. **Modal + keyboard overlap** — `paddingBottom: var(--kb-height)` on backdrop so modals sit above
   the keyboard (was only applied to sheet variant).
2. **maxHeight constant** — 156→168px to match enlarged header (80px) + footer (84px).
3. **Shift auto-reset** — non-modifier keypress reverts shift to lowercase.
4. **--kb-height race** — measurement moved inside double-rAF so layout is settled before reading.
5. **AddChooser id-based filter** — `c.id !== 'cat-dinner'` instead of fragile `c.name !== 'Dinner'`.
6. **AddChooser dynamic color** — looks up Dinner category color/icon from API, not hardcoded.
7. **AddChooser a11y** — added Escape key, body scroll lock, focus management (matching Sheet).
8. **Overlay mutual exclusion** — opening any overlay calls `dismissAll()` first; no more stacking.

### Files changed
- `frontend/src/components/keyboard/VirtualKeyboard.tsx` — Done bar, theming, shift reset, rAF fix
- `frontend/src/components/keyboard/keyboard.css` — new, kiosk key overrides
- `frontend/src/components/controls/AddChooser.tsx` — new, category chooser overlay
- `frontend/src/components/sheets/Sheet.tsx` — modal/sheet variant, kb-height, maxHeight fix
- `frontend/src/components/sheets/QuickAddSheet.tsx` — pre-selected category, no CategoryPicker
- `frontend/src/components/sheets/DayDetailSheet.tsx` — variant="sheet", enlarged rows
- `frontend/src/components/sheets/EventEditorSheet.tsx` — 48px touch targets
- `frontend/src/components/sheets/fields.tsx` — label/input sizing
- `frontend/src/components/primitives/Button.tsx` — 52px min-height
- `frontend/src/components/calendar/renderChip.tsx` — removed borderLeft
- `frontend/src/layouts/WallLayout.tsx` — AddChooser flow, overlay mutual exclusion

### Verify
```bash
npm --workspace backend test          # 19/19
npm --workspace frontend test         # 15/15
npm run build                         # clean
docker compose up -d --build          # deploy
bash kiosk/reload.sh                  # reload Pi
# FAB → chooser → Sport → modal with keyboard
# FAB → chooser → Dinner → "What's for dinner?" modal
# Tap event → bottom sheet (DayDetailSheet)
```

### State at end
- All changes uncommitted, ready to commit.
- Backend 19/19, frontend 15/15, build clean.
- Deployed and tested on Pi kiosk (192.168.1.135) via CDP screenshots.

---

## 2026-06-01 (cont.) — M4 post-deploy fixes + kiosk tuning

### Code review fixes (from high-effort 7-angle review)
- **SW undefined fallback** — API/static handlers now return a 503 Response on cache-miss +
  network-failure instead of undefined (TypeError).
- **SW fire-and-forget cache write** — navigation cache write wrapped in `event.waitUntil()`.
- **Backup concurrency guard** — 409 `BACKUP_IN_PROGRESS` prevents concurrent `VACUUM INTO`.
- **Dev buildId** — defaults to `'dev'` instead of `Date.now()` to avoid stale cache accumulation.
- **`__BUILD_ID__` declare** — moved from inline in main.tsx to `vite-env.d.ts`.

### Sheet focus steal fix
- `Sheet.tsx` effect depended on `[open, onClose]` — since `onClose` was a new arrow each render
  (from SSE-triggered re-renders in WallLayout), the effect re-fired and yanked focus from inputs
  to the panel div after ~2-3s. Fixed with a stable ref pattern (`onCloseRef` + `useCallback`).

### Kiosk deployment
- Pi autostart: `~/.config/labwc/autostart` with Chromium Wayland kiosk flags pointed at
  `http://192.168.1.94:8787/?mode=wall`.
- **Remote debugging:** `--remote-debugging-port=9222` on Chromium (binds localhost only on
  Bookworm); `socat` on port 9223 forwards from LAN. Reload script at `kiosk/reload.sh`.
- **On-screen keyboard:** Wayland virtual keyboard (wvkbd/squeekboard) failed to trigger from
  Chromium kiosk. Solved with `react-simple-keyboard` — JS keyboard portaled to `document.body`
  (z-index 200, above Sheet portal at z-50), wall-only (mounted in `WallLayout`, not phone).
  Activates on text/search input focus, ignores date/time/checkbox. `useIsWall` hook extracted
  from `ModeRouter` for shared wall-mode detection.

### Deploy docs updated
- Remote debugging section with `socat` workaround and reload one-liner.
- `kiosk/launch.sh` updated with `--remote-debugging-port=9222`.

### Pi details (for reference)
- Pi IP: `192.168.1.135`, server IP: `192.168.1.94`
- Pi user: `hbadmin`, hostname: `homebuddy`
- Chromium 142.0.7444.175, labwc 0.9.2, Bookworm (trixie)
- `socat` required (`sudo apt install socat`) for LAN debug access

---

## 2026-06-01 — M4: deploy + kiosk + backup

### What was built
- **`POST /api/backup`** — `VACUUM INTO` creates a timestamped standalone `.db` in the data dir.
  Auto-prunes to 10 most recent. Tests-first (3/3 in `backup.test.ts`): path format, round-trip
  integrity, and prune behaviour.
- **Graceful SSE shutdown** — `drainSSE()` tracks all hijacked SSE `ServerResponse` objects in a
  module-level `Set`; the SIGTERM handler calls `drainSSE()` → `.end()` on every open connection
  before `app.close()` + WAL checkpoint. `stop_grace_period: 30s` in compose so Docker waits for
  the drain instead of SIGKILL-ing.
- **SW cache versioning** — shell cache name now includes a build-time ID (`__BUILD_ID__` via Vite
  `define`); SW registration passes `?v=${buildId}` so the browser byte-compares and activates a
  new worker after each redeploy. Navigation switched from cache-first to **network-first with
  cache fallback** — the wall always gets the latest `index.html` when the server is up, but still
  renders last-good when it's down. On activate, old shell caches are evicted.
- **Prod logging** — Fastify logger level set to `warn` when `NODE_ENV=production` (overridable
  via `LOG_LEVEL`). Docker compose adds `json-file` log driver with `max-size: 10m`, `max-file: 3`.
- **Kiosk launcher** — `kiosk/launch.sh`: polls `/api/health` until 200 (up to 5 min), then
  launches Chromium in kiosk mode with Wayland flags. Falls back to launching anyway after timeout
  (SW may have a cached shell).
- **Deploy guide** — `docs/deploy.md` covers: Docker build-on-target-arch, config env vars,
  backup endpoint usage, reverse-proxy SSE snippets (nginx + Caddy), Pi kiosk setup (labwc
  autostart + systemd alternative), screen blanking, and chaos-test checklist.

### Verify
```bash
npm --workspace backend test          # 19/19 (16 recurrence/broker + 3 backup)
npm --workspace frontend test         # 15/15 (rrule + color + time)
npm run build                         # tsc both workspaces + vite (clean)
rm -rf /tmp/d && DATA_DIR=/tmp/d STATIC_DIR=frontend/dist PORT=8794 node backend/dist/server.js &
curl -s localhost:8794/api/health     # {"ok":true,...}
curl -s -X POST localhost:8794/api/backup  # {"ok":true,"file":"backup-...","sizeBytes":...}
ls /tmp/d/backup-*                    # standalone .db, no -wal/-shm
kill %1                               # SIGTERM → drainSSE → WAL checkpoint → exit
```

### State at end
- All M0–M4 milestones complete. Backend 19/19 tests, frontend 15/15 tests, build clean.
- Tree clean (no uncommitted changes yet — ready for commit).
- M4 acceptance criteria from the spec: backup endpoint works, SW serves fresh assets after
  rebuild, kiosk launcher + deploy docs written, graceful shutdown drains SSE.

---

## 2026-06-01 — M3 hardening (pre-M4 persona review fixes)

Ran a 2-lens check-in (principal-engineer/deploy-readiness + UX) on the built M0–M3 product;
actioned all findings except the ones that are genuinely M4 scope (see "Deferred to M4").

### Fixed
- **Never-blank, two holes closed:** (1) `ErrorBoundary` at the top of `AppProviders` — a render
  throw now falls back to the live clock + "Reconnecting…" (auto-retries after 4s) instead of
  white-screening the wall. (2) **Bad stored RRULE no longer blanks the calendar** — `expandEvent`
  wraps parse/expand and returns `[]` on failure; `listOccurrences` also try/catches per master.
  Tests-first (recurrence test #16: malformed rule is skipped, not thrown).
- **Wall idle reset** (`useIdleReset`, 90s) — returns to Agenda + today and dismisses sheets, so the
  wall is never stuck on a paged-away view. (Was specced but missing.)
- **Loading ≠ empty** — `AgendaView` shows "Loading today…" on cold load instead of "Nothing scheduled".
- **Whole-series edit is now explicit** — `EventEditorSheet` titles "Edit series", shows a repeat banner,
  and a Save on a recurring event asks "apply to every occurrence?" before mutating (no silent rewrite).
- **Wall staleness covers events** (not just dinners) — `StatusDot` driven by the older/errored of both.
- **Category delete 409 → guided recovery** — new `POST /api/categories/:id/reassign {toId}` +
  `reassignEvents` repo; Manage offers "Move to Uncategorized & delete" in one tap, reworded as guidance.
- **Wall touch targets to spec** — ControlBar bar 72→88px, segments/Today/nav ≥64, quick-add 72;
  CategoryManager edit/delete 40→48.
- **Frontend tests exist now** — added vitest (`npm --workspace frontend test`); 15 tests covering
  `rrule` build/parse round-trip + bounded, `color` contrast/isHex6/fgForBg, and `inWindow`.

Verify: backend 16/16, frontend 15/15, build clean. Playwright re-verified Edit-series title+banner+
save-confirm, category-in-use → reassign offer, bigger wall controls. Screenshots `/tmp/m3shots/h*`.

### Deferred to M4 (written down, not lost)
`POST /api/backup` (VACUUM INTO) · SW shell cache versioning (cache-first `v1` can pin the wall to an
old build after redeploy — fix during M4, the first redeploy over a live wall) · graceful-shutdown SSE
socket drain + `stop_grace_period: 30s` · reverse-proxy SSE snippet (or "direct host:port" note) ·
Fastify log level + Docker log rotation · build-on-target-arch runbook note.

---

## 2026-05-31 (cont.) — M3: editing (phone + sheets + mutations + SSE)

### What was built
- **Backend realtime:** `realtime.ts` in-process pub/sub `broker` (tests-first, 5/5) + `GET /api/stream`
  SSE route (hijacked raw socket, `retry`/heartbeat, double-cleanup guard). Every event/dinner/category
  mutation route now `poke()`s. Also fixed the test script glob (`find src -name '*.test.ts'`) — the old
  `src/**/*.test.ts` matched nothing under npm's `sh`, so tests had been silently not running.
- **Frontend data layer:** `api/client.ts` gained POST/PUT/DELETE + a typed `ApiError` (carries
  `code`/`status`). `useMutations.ts` — event/dinner/category mutations (optimistic create + cache patch,
  invalidate-on-settle). `useRealtime.ts` — SSE → invalidate matching query family; reconnect refetches.
  `useEventMaster` hook. `usePhoneTheme` (OS scheme).
- **Sheets:** `Sheet` primitive (portal, focus, Esc/tap-out, scroll-lock, slide-up). `EventEditorSheet`
  (full fields, repeat→bounded RRULE via `util/rrule.ts` build/parse, delete scope This/All),
  `QuickAddSheet` (wall fast path, optimistic/quiet), `DayDetailSheet` (wall read), `DinnerEditorSheet`,
  `CategoryEditorSheet` (Okabe–Ito presets + hex + icon + AA-contrast warning via `contrastRatio`).
- **Phone:** `PhoneLayout` (Agenda/Week/Manage tabs) + `PhoneHeader` + `TabBar` + `Fab`; `CategoryManager`
  (edit/delete → 409 surfaced) + `DinnerWeekEditor`. `AgendaView`/`EventRow` gained a `phone` density.
  `ModeRouter` now renders `PhoneLayout` unless `?mode=wall`.
- **Wall wiring:** event tap → `DayDetailSheet`; quick-add → `QuickAddSheet`.

### Decisions / deviations
- Forms use plain controlled state + light client validation, **not** react-hook-form/zod (avoid deps;
  API Zod is authoritative; `ApiError.code` drives UX). Recorded in CLAUDE.md.
- M3 recurrence editing = whole-series edit + This/All delete only; following-split + modified overrides
  are v2 (no backend route).

### Verify
```bash
npm --workspace backend test          # 15/15 (10 recurrence + 5 broker)
npm run build                         # tsc both workspaces + vite
rm -rf /tmp/d && DATA_DIR=/tmp/d STATIC_DIR=frontend/dist PORT=8793 node backend/dist/server.js &
# phone: http://<ip>:8793/   ·   wall: http://<ip>:8793/?mode=wall
```
Playwright (cached chromium, `waitUntil:'load'`) verified: phone adds weekly event → appears on a fresh
wall (recurrence expanded 31 May + 7 Jun); delete "This event only" → cancels just that instance (server
left with only 7 Jun; UI converges to 1). Screenshots in `/tmp/m3shots`.

### Post-build code review (HIGH/MED fixed)
EventEditorSheet now shows an error state on master-load failure (was stuck on "Loading…"); phone agenda
chip shows icon+**label** (was icon-only, breaking the "colour-never-alone" rule); SSE cleanup guarded;
QuickAddSheet fully resets on close; dropped the unused `RecurrenceScope` `'following'`.

### Carried forward
- Bundle ~565KB (FullCalendar) — fine for LAN; code-split in M4 polish if wanted.
- No frontend test runner yet; `util/rrule.ts` + `color.ts` contrast were validated via the live flow,
  not unit tests. Consider vitest in M4 for those pure helpers.

---

## 2026-05-31 — Spec review → design sign-off → M0/M1/M2

### What happened (in order)
1. **Read the build spec** (`family-calendar-build-spec.md`).
2. **Three-persona review** (principal engineer, UX, DBA) of the spec, then **folded the findings in** —
   produced spec **v2** with the binding **§0 Post-Review Decisions (locked)**. Key additions: UTC date
   convention, app-side bounded recurrence + `event_exceptions` (EXDATE/override), category-delete RESTRICT,
   error envelope, service-worker never-blank, colour+icon+label chips, custom agenda default view.
3. **Locked frontend design** → `docs/frontend-design.md` (Calm & minimal · auto day/night · dinner
   top-hero band) and **component architecture** → `docs/frontend-components.md` (FullCalendar MIT for
   week/month, custom AgendaView; FAB/toolbars/view-switcher per surface).
4. **HTML sign-off mockup** → `docs/mockups/family-calendar.html` (3 views, day/night toggle). User signed
   off; tweaks applied: removed the always-on "live" status badge (AI-slop); showed all 3 views statically.
5. **M0 — scaffold + container** (`f419063`): Fastify (CJS) serving API + built frontend single origin;
   SQLite WAL + `user_version` migration runner + seeded Okabe–Ito categories; multi-stage Dockerfile
   (target-arch native build) + compose with host-volume **data dir**; Vite/React placeholder. Verified
   LAN serving + **DB persists across image rebuild** (PERSIST-MARKER test). `f01b0c6` = gitignore cleanup.
6. **M1 — data + API** (`24d7651`): categories/events/dinners CRUD on Fastify + zod validation + error
   envelope. Bounded app-side `rrule` expansion with EXDATE cancel + modified-override. Endpoints incl.
   `GET /events/:id`, `DELETE /events/:id/occurrences/:date`, dinners get/set/clear. **Tests-first:**
   10/10 recurrence truth-table. All §7 endpoints curl-verified incl. 400/404/409 paths.
7. **M2 — wall UI** (`5b3d5ed`): tokens + Tailwind (day/night), TanStack Query data layer, custom
   AgendaView + FullCalendar week/month (restyled, toolbar off), shared colour+icon+label chip, HeroBand
   (dinner rolls to tomorrow after 8pm), StatusDot (stale-only), ControlBar (view switch + DateNav +
   legend + FAB), service-worker never-blank, Geist self-hosted. **Verified via 1280×800 screenshots** of
   all 3 views (caught the auto night theme live at 20:28 Brisbane).

### State at end of session
- Commits: `f419063` (M0) → `f01b0c6` (gitignore) → `24d7651` (M1) → `5b3d5ed` (M2). Tree clean.
- Backend: full §7 API working, recurrence engine tested. Frontend: read-only wall complete.
- No test servers left running; `data/` is gitignored (root-owned from container runs — harmless).

### Verify the current build
```bash
npm install
npm --workspace backend test            # 10/10 recurrence tests
npm run build
rm -rf /tmp/d && DATA_DIR=/tmp/d STATIC_DIR=frontend/dist PORT=8791 node backend/dist/server.js &
curl -s localhost:8791/api/health       # {"ok":true,...}
# open http://<lan-ip>:8791/?mode=wall   (wall) ; switch Agenda/Week/Month
```

### Next session — M3 (editing)
Build the phone side + write paths (see `docs/frontend-components.md` §3–4):
- `PhoneLayout` + `TabBar` (Agenda/Week/Manage) + floating `Fab`.
- Sheets: `EventEditorSheet` (full fields + **recurrence scope** This/This-and-following/All),
  `QuickAddSheet` (wall fast path), `DayDetailSheet`, `DinnerEditorSheet`, `CategoryEditorSheet`.
- `CategoryManager` (colour+icon, AA-contrast warning, delete→409 reassign), `DinnerWeekEditor`.
- **Mutations** (POST/PUT/DELETE) with optimistic update + invalidate; wire wall quick-add + tap→sheet.
- Add `GET /api/stream` (SSE) on the backend → client refetch on poke (M2 currently polls 30s).
- Acceptance: phone adds a weekly event → appears on wall within refresh; cancel one occurrence removes
  only that instance.

### Watch-outs carried forward
- Tool channel drops output intermittently — verify, don't trust silence.
- Recurrence is the riskiest code; keep it tests-first.
- Bundle is ~530KB (FullCalendar) — fine for LAN; code-split later if wanted (M4 polish).
- `npm audit` shows dev/build-dep vulns only (no runtime path); revisit before v1 ship.
