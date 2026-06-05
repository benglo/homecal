# HomeBuddy — relevant patterns for homecal voice work

Snapshot of `/srv/dev/homebuddy/CLAUDE.md` saved alongside as
`homebuddy-CLAUDE.md`. This file is a *digest of decisions worth knowing*
when iterating on homecal's voice stack.

HomeBuddy is a different shape than homecal — Node/Fastify + Postgres in
Docker, browser-side voice (Web Audio API), Spotify/AppleTV/Weather, cloud
STT (Groq). Most of its surface isn't relevant. The voice-related patterns
below are.

## What homebuddy chose differently (and why we might or might not follow)

| Concern | homebuddy | homecal | Worth borrowing? |
|---|---|---|---|
| Wake word engine | Porcupine (commercial) + custom audio-fingerprint training | openWakeWord `hey_mycroft` v0.4 | Porcupine is more selective out of the box but ties to a vendor. Custom training is interesting — homebuddy trains a "Hey HomeBuddy" template per user voice. Could solve our wake threshold drama if we ever train on actual family voices. |
| Audio capture | Browser Web Audio API on the kiosk | Pi-side `pw-record` → openWakeWord → Silero VAD → whisper-server | Browser-side is simpler but ties us to the wall having focus + an open page. Pi-side daemon survives kiosk reload, screensaver, etc. Keep ours. |
| STT | Groq / OpenAI Whisper API (cloud) | Local `whisper.cpp` (now `small.en` after `base.en-q5_1` proved too lossy) | Cloud STT is much more accurate but always-on cost + needs network. Local is the right call for homecal's offline-first stance — but we now know `base.en-q5_1` is too small. |
| Intent extraction | Pattern matching FIRST → LLM fallback | Haiku via OpenRouter for every transcript | **Worth borrowing.** Pattern-match common shapes ("set tonight's dinner to X", "mark Y's chore done") locally → only call Haiku when no pattern fits. Cuts LLM cost on the happy path. |
| LLM abstraction | Multi-provider (OpenAI/Groq/Anthropic) via service layer | OpenRouter SDK directly | Multi-provider is overkill for v1 but the *layered* shape is nicer than reaching into the SDK from `intent.py`. Defer. |
| Wake cooldown bug (2025-08-07) | "Removed `Date.now()` reset that prevented detections for 1.5s post-cooldown" | Our `_refractory` is frame-count + new time-based `_suppress_until` | Similar surface. Their fix was removing a redundant reset that interacted badly with the refractory window. Our `suppress_for` uses `max()` to extend, not clobber — same instinct. |
| Real-time | Socket.io with `/timers`, `/music` namespaces | SSE broker with `poke(kind, payload?)` | SSE is simpler for one-way pokes; Socket.io is heavier. Ours is fine. |
| Voice state | Zustand store with `VOICE_STATES` enum | `voiceState.ts` reducer in WallLayout | Same idea, different lib. We're not switching React state libs. |
| Voice command testing | `POST /api/voice/text` to bypass STT | `intent.parse_intent_response` pure unit | Their text-bypass endpoint is useful for E2E testing without speaking. Worth copying as a maintenance tool once the pipeline stabilises. |
| LLM injection defence | `securePromptBuilder.js` + `securePromptBuilder` mention | `<<<USER>>>...<<<END>>>` delimiters | We do the lighter version of the same thing. Their full builder is overkill but worth reading if we ever take user-provided strings into the prompt. |
| Database sweeper | Cron-based modular cleanup tasks (`cleanup_logs` table, REST API) | Backup-only (`VACUUM INTO`, retention to 10) | Their automated maintenance is nice; ours doesn't need it (SQLite + family-scale data). |
| Secure config | AES-256-GCM encrypted secret storage with audit log | `.env` files, no auth (LAN-only) | We're not on the same threat model. Skip. |

## The single most relevant finding for *right now* (2026-06-05 cascade work)

**Pattern matching before LLM** is the right way to cut OpenRouter spend on
ambient noise. Even with the threshold + paren-hallucination filter we
pushed today, every real wake still pays Haiku. A pattern matcher for the
top intents (`dinner_set`, `chore_complete`, `query_dinner`, `query_agenda`)
would catch >90% of real utterances locally:

```
\b(tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)['']?s?\s+dinner\s+is\s+(.+)\b
\b(\w+)\s+(?:done|complete|finished|did)\s+(?:the|her|his)?\s*(\w+)
\b(?:what'?s?|whats)\s+for\s+dinner\s+(today|tonight|tomorrow)?\b
\b(?:what'?s?|whats|anything)\s+on\s+(today|tomorrow|monday|...)?\b
```

Only fall through to Haiku for novel phrasings. That's a homebuddy
pattern worth porting once the wake-noise floor is calm.

## Pointers

- Project root: `/srv/dev/homebuddy/`
- Full CLAUDE.md snapshot: `./homebuddy-CLAUDE.md` (this directory)
- Wake word: `frontend/src/hooks/usePorcupineWakeWord.js`, `useCustomWakeWord.js`
- Voice command pipeline: `backend/services/voice/voiceCommandServiceSimple.js`
- Pattern + LLM intent extractor: `backend/services/voice/intentExtractorSimple.js`
- Secure prompt builder: `backend/services/voice/securePromptBuilder.js`

The original CLAUDE.md changes over time — re-snapshot if the patterns in
that repo evolve and we want fresh insight.
