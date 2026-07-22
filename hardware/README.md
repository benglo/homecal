# Wall-unit housing (3D-printable)

Parametric rear housing for the homecal wall unit — an **all-in-one** integrated
shell holding the Waveshare 10.1″ DSI panel, the Pi (mounted on the panel back),
the Class-D amp + buck (the shared-DC-bus audio), and a sealed speaker pod.

- **`wall_housing.py`** — the parametric model (CSG via `trimesh` + `manifold3d`).
- **`render_preview.py`** — offscreen preview PNG (matplotlib, no display needed).
- **`wall-housing.stl`** — exported solid (regenerate after any parameter change).
- **`wall-housing-preview.png`** — current preview.

## Regenerate

```bash
uv venv .venv && . .venv/bin/activate
uv pip install manifold3d trimesh numpy matplotlib
python wall_housing.py        # -> wall-housing.stl + fit report
python render_preview.py      # -> wall-housing-preview.png
```

## Parameters to confirm before printing

Everything is a variable at the top of `wall_housing.py`. Tagged `# MEASURE` /
`# EST` are the ones that need real numbers:

| Var | Meaning | Status |
|-----|---------|--------|
| `SCREEN_W`, `SCREEN_H` | panel **outer** outline (landscape) | **EST 233×153 — measure with calipers** |
| `PI_CX`, `PI_CY` | Pi centre on the panel back | EST — confirm from the real unit |
| `PI_PORT_W/H` | USB+Ethernet stack footprint / which edge | EST |
| `AMP_*`, `BUCK_*` | amp/buck board footprints + positions | EST — set from the boards you buy |
| `SPK_BAFFLE_DIA`, `SPK_SCREW_CIRCLE` | driver cutout + mount PCD | EST — from the AS3034 datasheet |
| `REBATE_*` | frame rebate | measured (260×180×35) |

## Current fit report (v2 — measured outline, down-firing speaker)

- Watertight ✔ single body, panel plane **259×179 mm** (drops into 260×180).
- **Down-firing sealed chin** below the frame: hangs **~58 mm** below the frame
  bottom and sticks **~51 mm** past the frame back (a 3″ cone needs ~80 mm in
  plan to fire down — that's the chin's size, not slack).
- ~**505 g** PETG — chunky at a print service; thin walls / smaller driver cut it.

## Known caveats (the iteration list)

1. **Speaker bulk vs driver size.** Down-firing the 3″ AS3034 forces the
   soundbar-style chin (58 mm drop / 51 mm rear). A **2″ driver** shrinks it a
   lot (at some output), or forward-firing avoids the chin entirely. This is the
   main size/acoustics trade to settle.
2. **Board placement.** Amp/buck posts are on the rear-external face beside the
   Pi (the front cavity is only ~15 mm deep — too shallow for boards). Confirm
   against real board sizes; they may want their own shallow sub-tray.
3. **Panel retention** assumes a lip lapping the bezel by `BEZEL_OVERLAP` with
   the panel dropped in from behind and the mat taped to the glass front. Verify
   the lap doesn't clip the active area once `SCREEN_W/H` is real.
4. **No fillets yet** — sharp outer corners (prints fine; round later for feel).
5. **Frame fixing** — currently relies on the frame's own back clips; add screw
   tabs if the frame has none.

## BOM (audio — shared-DC-bus all-in-one)

- 24 V DC supply (one wall plug) → into the housing
- TPA3116 bare amp board (fed from 24 V)
- 24 V→5 V/5 A buck module (powers Pi + panel)
- Jaycar AS3034 3″ full-range driver (in the sealed pod)
- barrel jack (bottom wall)
