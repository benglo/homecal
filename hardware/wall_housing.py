#!/usr/bin/env python3
"""Parametric integrated wall-mount housing for the homecal smart display.

A single Nest Hub-style shell: Waveshare 10.1" DSI panel flush in front,
wedge-tapered body (thin at top, thick at bottom), rear-firing 3" speaker,
Raspberry Pi + amp + buck converter all inside.  Mounts flat on the wall via
keyhole slots; no picture frame, no separate soundbar.

Built with build123d (Open CASCADE kernel).  Exports watertight STL + STEP.
Dimensions tagged # EST need real measurements; # MEAS are confirmed.

Coordinate system: XY centred on the shell; Z=0 is the front face, +Z runs
rearward (into the wall), -Y is down.  Units are millimetres.

    pip install build123d
    python wall_housing.py       # -> wall-housing.stl, wall-housing.step
"""
from __future__ import annotations
import math
from build123d import *

# ---------------------------------------------------------------------------
# PARAMETERS
# ---------------------------------------------------------------------------

# Waveshare 10.1" DSI panel (landscape)
SCREEN_W, SCREEN_H = 240.0, 147.0          # MEAS outer glass/PCB
SCREEN_T = 10.8                             # datasheet
BEZEL_OVERLAP = 4.0                         # lip over panel bezel
FIT_GAP = 0.8                               # clearance in pocket

# Outer shell — wedge taper: thin top, thick bottom
OUTER_W = 260.0
OUTER_H = 175.0
DEPTH_TOP = 22.0                            # depth at top edge
DEPTH_BOT = 50.0                            # depth at bottom edge
CORNER_R = 14.0                             # front-face corner radius
FILLET_R = 6.0                              # exterior edge fillet
WALL = 3.0
LIP = 3.0                                   # front lip behind bezel overlap

# Screen placement: 10 mm top bezel, 18 mm bottom bezel
SCREEN_CY = (OUTER_H / 2 - 10) - SCREEN_H / 2

# Raspberry Pi 5
PI_W, PI_H = 90.0, 62.0                    # EST bounding box
PI_CX, PI_CY = 0.0, SCREEN_CY
PI_PORT_W, PI_PORT_H = 42.0, 14.0          # EST USB + Ethernet

# Rear-firing speaker — Jaycar AS3034 3"
SPK_DIA = 74.0                              # EST cutout
SPK_PCD = 92.0                              # EST screw PCD
SPK_CY = -OUTER_H / 2 + 38                 # centre Y (in the thick bottom zone)

# Electronics standoffs (inside the cavity)
AMP_W, AMP_H = 74.0, 44.0                  # EST TPA3116
AMP_CX, AMP_CY = -55.0, -25.0              # EST
BUCK_W, BUCK_H = 50.0, 30.0                # EST buck converter
BUCK_CX, BUCK_CY = 55.0, -25.0             # EST
POST_H, POST_R, POST_PILOT = 8.0, 3.0, 1.3

# DC barrel jack — lower-left of back wall
DC_DIA = 8.0
DC_CX = -OUTER_W / 2 + 25
DC_CY = -OUTER_H / 2 + 20

# Bottom-face vent slots (heat + sound escape)
VENT_W, VENT_D = 40.0, 3.0
VENT_COUNT = 3
VENT_PITCH = 14.0

# Keyhole wall-mount slots (upper rear)
KH_SPAN = 160.0                            # horizontal spacing
KH_CY = OUTER_H / 2 - 25                   # near top where shell is thin
KH_SLOT_R = 2.5                             # screw shaft
KH_HEAD_R = 5.0                             # screw head
KH_DROP = 10.0                              # slot length below head


# ---------------------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------------------

def depth_at(y: float) -> float:
    """Shell depth (Z) at a given Y — linear taper, top thin to bottom thick."""
    t = (OUTER_H / 2 - y) / OUTER_H
    return DEPTH_TOP + (DEPTH_BOT - DEPTH_TOP) * t


# ---------------------------------------------------------------------------
# BUILD
# ---------------------------------------------------------------------------

def build():
    eps = 0.5

    # --- Outer shell: rounded-rect extrusion, wedge-cut --------------------
    body = extrude(RectangleRounded(OUTER_W, OUTER_H, CORNER_R), amount=DEPTH_BOT)

    # Wedge cut: triangle in YZ plane removes the back taper.
    # At y=+H/2 (top) the back face moves to DEPTH_TOP; at y=-H/2 it stays.
    cut_plane = Plane.YZ.offset(-(OUTER_W / 2 + 10))
    wedge = extrude(
        cut_plane * Polygon(
            (OUTER_H / 2 + eps, DEPTH_TOP),
            (OUTER_H / 2 + eps, DEPTH_BOT + eps),
            (-OUTER_H / 2 - eps, DEPTH_BOT + eps),
        ),
        amount=OUTER_W + 20,
    )
    body -= wedge

    # --- Exterior fillets (must come before hollowing) ---------------------
    front_edges = body.edges().group_by(Axis.Z)[0]
    body = fillet(front_edges, radius=FILLET_R)

    # --- Interior cavity (follows the wedge taper) -------------------------
    pocket_d = SCREEN_T + 0.5
    cav_z0 = LIP + pocket_d
    iw = OUTER_W - 2 * WALL
    ih = OUTER_H - 2 * WALL
    ir = max(2.0, CORNER_R - WALL)

    cavity = Pos(0, 0, cav_z0) * extrude(
        RectangleRounded(iw, ih, ir),
        amount=DEPTH_BOT - WALL - cav_z0,
    )
    # Match the taper so the back wall stays WALL-thick everywhere
    cavity -= extrude(
        cut_plane * Polygon(
            (OUTER_H / 2 + eps, DEPTH_TOP - WALL),
            (OUTER_H / 2 + eps, DEPTH_BOT),
            (-OUTER_H / 2 - eps, DEPTH_BOT),
        ),
        amount=OUTER_W + 20,
    )
    body -= cavity

    # --- Screen window + panel pocket --------------------------------------
    win_w = SCREEN_W - 2 * BEZEL_OVERLAP
    win_h = SCREEN_H - 2 * BEZEL_OVERLAP
    body -= Pos(0, SCREEN_CY, -eps) * extrude(
        RectangleRounded(win_w, win_h, 4), amount=LIP + 2 * eps,
    )
    body -= Pos(0, SCREEN_CY, LIP) * extrude(
        RectangleRounded(SCREEN_W + FIT_GAP, SCREEN_H + FIT_GAP, 2),
        amount=pocket_d + eps,
    )

    # --- Pi access hatch (through angled back wall) ------------------------
    pi_z = depth_at(PI_CY)
    body -= Pos(PI_CX, PI_CY, pi_z - WALL / 2) * Box(
        PI_W + 8, PI_H + 8, WALL + 2 * eps,
    )
    # Port slot through right side wall
    body -= Pos(OUTER_W / 2 - WALL / 2, PI_CY, cav_z0 + PI_PORT_H / 2 + 2) * Box(
        WALL + 2 * eps, PI_PORT_W, PI_PORT_H,
    )

    # --- Speaker driver cutout + screw holes (back wall) -------------------
    spk_z = depth_at(SPK_CY)
    body -= Pos(0, SPK_CY, spk_z) * Cylinder(SPK_DIA / 2, WALL + 2 * eps)
    for deg in (0, 90, 180, 270):
        hx = (SPK_PCD / 2) * math.cos(math.radians(deg))
        hy = SPK_CY + (SPK_PCD / 2) * math.sin(math.radians(deg))
        body -= Pos(hx, hy, depth_at(hy)) * Cylinder(1.6, WALL + 2 * eps)

    # --- DC barrel jack (back wall) ----------------------------------------
    body -= Pos(DC_CX, DC_CY, depth_at(DC_CY)) * Cylinder(
        DC_DIA / 2, WALL + 2 * eps,
    )

    # --- Bottom-face ventilation slots -------------------------------------
    for i in range(VENT_COUNT):
        vx = (i - (VENT_COUNT - 1) / 2) * VENT_PITCH
        body -= Pos(vx, -OUTER_H / 2, DEPTH_BOT * 0.7) * Box(
            VENT_W, WALL + 2 * eps, VENT_D,
        )

    # --- Keyhole wall-mount slots (head above, slot below) -----------------
    for sx in (-1, 1):
        kx = sx * KH_SPAN / 2
        kz = depth_at(KH_CY)
        body -= Pos(kx, KH_CY, kz) * Cylinder(KH_HEAD_R, WALL + 2 * eps)
        body -= Pos(kx, KH_CY - KH_DROP / 2, kz) * Box(
            KH_SLOT_R * 2, KH_DROP, WALL + 2 * eps,
        )

    # --- Board mounting posts + pilot holes --------------------------------
    def posts(bw, bh, cx, cy):
        nonlocal body
        for sx in (-1, 1):
            for sy in (-1, 1):
                px, py = cx + sx * bw / 2, cy + sy * bh / 2
                pz = cav_z0 + POST_H / 2
                body += Pos(px, py, pz) * Cylinder(POST_R, POST_H)
                body -= Pos(px, py, pz) * Cylinder(POST_PILOT, POST_H + eps)

    posts(AMP_W, AMP_H, AMP_CX, AMP_CY)
    posts(BUCK_W, BUCK_H, BUCK_CX, BUCK_CY)

    return body


# ---------------------------------------------------------------------------
# REPORT + EXPORT
# ---------------------------------------------------------------------------

def report(body):
    bb = body.bounding_box()
    w = bb.max.X - bb.min.X
    h = bb.max.Y - bb.min.Y
    d = bb.max.Z - bb.min.Z
    vol = body.volume / 1000
    print(f"  manifold   : {body.is_manifold}")
    print(f"  volume     : {vol:.1f} cm³  (~{vol * 1.24:.0f} g PETG)")
    print(f"  bbox (mm)  : {w:.1f} W × {h:.1f} H × {d:.1f} D")
    print(f"  taper      : {DEPTH_TOP:.0f} mm top → {DEPTH_BOT:.0f} mm bottom")
    print(f"  speaker    : y={SPK_CY:.0f}, depth={depth_at(SPK_CY):.1f} mm")
    print(f"  bezels     : {(OUTER_W - SCREEN_W) / 2:.0f} side, "
          f"{OUTER_H / 2 - SCREEN_CY - SCREEN_H / 2:.0f} top, "
          f"{SCREEN_CY - SCREEN_H / 2 + OUTER_H / 2:.0f} bottom")


if __name__ == "__main__":
    m = build()
    export_stl(m, "wall-housing.stl")
    export_step(m, "wall-housing.step")
    print("wrote wall-housing.stl + wall-housing.step")
    report(m)
