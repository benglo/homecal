# Noise clip provenance

All clips in this directory should be **CC0** (Creative Commons Zero / public domain).

## Current state

**The clips currently checked in are zero-byte placeholders.** They satisfy the
catalog integrity check (`catalog.check_integrity()`) at service startup so the
test suite passes and the service boots, but they do not produce audible sound.

**Before deploying to the Pi for real kid testing, replace each `<name>.mp3`
with a CC0-licensed clip:** mono, 16kHz, ≤2 seconds, MP3 (re-encode with
`ffmpeg -i in.wav -ar 16000 -ac 1 -b:a 64k out.mp3`).

## Sourcing

[Freesound](https://freesound.org/) tagged `CC0` is the recommended source. For
each entry, record:

- Source URL (link to the Freesound page)
- Original creator handle
- Date downloaded
- Any post-processing (trim, normalise, format conversion)

Verify per-file license — Freesound's CC0 tag has historically had occasional
mislabels; cross-check the page's license badge before downloading.

| Clip | Source URL | Original creator | License | Notes |
|---|---|---|---|---|
| fart.mp3 | TODO | TODO | CC0 | |
| burp.mp3 | TODO | TODO | CC0 | |
| chicken.mp3 | TODO | TODO | CC0 | |
| cow.mp3 | TODO | TODO | CC0 | |
| pig.mp3 | TODO | TODO | CC0 | |
| dog.mp3 | TODO | TODO | CC0 | |
| cat.mp3 | TODO | TODO | CC0 | |
| lion.mp3 | TODO | TODO | CC0 | |
| sneeze.mp3 | TODO | TODO | CC0 | |
| raspberry.mp3 | TODO | TODO | CC0 | |
| drum.mp3 | TODO | TODO | CC0 | |
| fanfare.mp3 | TODO | TODO | CC0 | |

## What is NOT in the catalog (deliberately)

The earlier draft included `evil-laugh`, `monster`, `ghost`, `alarm`, `owl`,
`snore`, `robot`, `laugh`. They were dropped in the 5-persona spec review:
bedtime-adjacency risk and aesthetic spam. If you want any of them back, weigh
the same trade-off (the wall is in a kitchen near where kids sleep) and update
`noises.json` plus add the matching clip here.

## What is NOT acceptable

- Non-CC0 clips (Attribution-required, NonCommercial, ShareAlike) — the Pi
  package gets distributed beyond local LAN if a clone is shared.
- Anything that punches down (no fart-noise mockery of a real person, etc).
- Anything potentially scary at bedtime adjacency.
