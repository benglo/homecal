# Wall-unit housing (3D-printable)

## Current design — integrated wedge shell

A single Nest Hub-style wall-mount enclosure: screen flush in front,
wedge-tapered body (thin at top, thick at bottom), rear-firing 3" speaker,
Pi + amp + buck all inside.  No picture frame, no separate soundbar.

- **`wall_housing.py`** — parametric model (build123d / Open CASCADE).
- **`render_preview.py`** — offscreen preview PNG (matplotlib + trimesh).
- **`wall-housing.stl`** + **`wall-housing.step`** — exported solids.
- **`wall-housing-preview.png`** — current preview.

### Shape

- **Front:** 260 × 175 mm rounded rectangle (14 mm corner radius, 6 mm fillets).
  Screen window 232 × 139 mm, 10 mm bezel all sides except 18 mm bottom.
- **Profile:** Wedge taper — 22 mm deep at top, 50 mm at bottom.
- **Speaker:** Rear-firing through the back wall (sound bounces off the wall).
  Keyhole standoffs create a ~10 mm gap for sound to escape.
- **Internals:** Panel pocket, Pi access hatch (pokes through back wall),
  amp + buck on internal standoffs, DC barrel jack, bottom vent slots.
- **Mounting:** Two keyhole slots on the upper back wall (160 mm span).

### Fit report

- Watertight (manifold) single body.
- ~**334 g** PETG, **260 × 175 × 50 mm** bounding box.
- Front-face fillets applied; back edges left sharp (taper geometry).

## Regenerate

```bash
cd hardware
uv venv .venv && . .venv/bin/activate
uv pip install build123d trimesh numpy matplotlib
python wall_housing.py        # -> wall-housing.stl + wall-housing.step + fit report
python render_preview.py      # -> wall-housing-preview.png
```

## Parameters to confirm before printing

Everything is a variable at the top of `wall_housing.py`.  Tagged `# MEAS`
(confirmed) or `# EST` (needs real numbers):

| Var | Meaning | Status |
|-----|---------|--------|
| `SCREEN_W`, `SCREEN_H` | panel outer outline (landscape) | MEAS 240 × 147 |
| `PI_W`, `PI_H` | Pi bounding box incl. clearance | EST |
| `PI_PORT_W/H` | USB+Ethernet stack footprint | EST |
| `AMP_*`, `BUCK_*` | board footprints + positions | EST — set from real boards |
| `SPK_DIA`, `SPK_PCD` | driver cutout + mount PCD | EST — from AS3034 datasheet |
| `DC_CX`, `DC_CY` | barrel jack position on back wall | EST |

## Known caveats

1. **Back-edge fillets** — front-face edges fillet cleanly; the Z-running edges
   on the tapered back fail (radius too large for the short edges at the top).
   Could be fixed with a smaller radius or edge-specific selection.
2. **Speaker sealed volume** — the driver fires through the back wall with no
   dedicated sealed chamber partition.  Adding an internal wall between the
   speaker zone and electronics bay is a v2 improvement.
3. **Panel retention** — the lip laps the bezel by 4 mm; verify it doesn't clip
   the active area once `SCREEN_W/H` is confirmed with calipers.
4. **Acoustics** — rear-firing depends on a consistent wall gap (~10 mm from
   keyhole standoffs).  If mounted flush, sound will be muffled.

## BOM (audio — shared-DC-bus)

- 24 V DC supply, ≥ 4 A (one wall plug) → barrel jack
- TPA3116 bare amp board (fed from 24 V)
- 24 V→5.1 V buck, **≥ 8 A** (Pi 5 alone needs 5 A; panel + USB mic on top).
  Set the output to 5.1–5.2 V under load — the Pi browns out below ~4.8 V.
- Pi fed via a short, thick USB-C pigtail (or the 5 V/GND header pins).
  A buck can't do USB-PD, so the Pi assumes a 3 A supply and caps USB at
  600 mA unless the EEPROM is told otherwise:
  `sudo rpi-eeprom-config --edit` → `PSU_MAX_CURRENT=5000`
- Jaycar AS3034 3" full-range driver (rear-firing through back wall)
- DC barrel jack (5.5 × 2.1 mm)

## Legacy files

- `soundbar.py` — standalone down-firing soundbar (superseded by integrated shell).
- `Display_case.3mf` — earlier hand-modelled display case (superseded).
