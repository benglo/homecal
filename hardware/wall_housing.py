#!/usr/bin/env python3
"""Parametric rear housing for the homecal wall unit.

An integrated shell that (1) retains the Waveshare 10.1" DSI panel against the
picture-frame mat from behind, (2) gives the Pi (mounted centred on the panel
back) a bay + a port slot, (3) carries the all-in-one audio: a DOWN-FIRING
sealed speaker chin below the frame plus mounting posts for the Class-D amp and
the buck converter, and (4) a DC inlet.

Built with CSG (trimesh + manifold3d) so it exports a watertight STL for a print
service. Dimensions I don't have yet are tagged `# EST`; measured ones `# MEAS`.

Coordinate system: XY centred on the panel; Z=0 is the front (mat) plane, +Z
runs rearward (into the wall), -Y is down. Units are millimetres.

    python wall_housing.py         # -> wall-housing.stl  (+ prints a fit report)
"""
from __future__ import annotations
import numpy as np
import trimesh
from trimesh.boolean import union, difference
from trimesh.transformations import rotation_matrix

# ---------------------------------------------------------------------------
# PARAMETERS
# ---------------------------------------------------------------------------
REBATE_W, REBATE_H, REBATE_DEPTH = 260.0, 180.0, 35.0     # MEAS frame rebate

# Panel outer glass/PCB outline, edge-to-edge (landscape: long edge along width).
SCREEN_W, SCREEN_H = 240.0, 147.0          # MEAS
SCREEN_T = 10.8                            # Waveshare 10.1-DSI-TOUCH-A datasheet
BEZEL_OVERLAP = 4.0                        # lip lap (<6mm short-axis bezel)
FIT_GAP = 0.8                              # clearance around the panel in its pocket

# Shell
WALL = 3.0
LIP = 3.0
BODY_D = 32.0                              # shell depth (within the 35 rebate)
REBATE_CLEAR = 1.0
OUTER_W = REBATE_W - REBATE_CLEAR
OUTER_H = REBATE_H - REBATE_CLEAR

# Raspberry Pi 5 — mounted centred on the panel back; pokes through a back-wall
# hatch (deeper than the shell; "stack pokes out the back" is accepted).
PI_W, PI_H = 90.0, 62.0                    # EST bounding incl. clearance
PI_CX, PI_CY = 0.0, 0.0                    # MEAS roughly centred
PI_PORT_W, PI_PORT_H = 42.0, 14.0          # EST USB+Ethernet stack on its edge

# Down-firing speaker — Jaycar AS3034 3" full-range, sealed chin below the frame.
SPK_BAFFLE_DIA = 74.0                      # EST driver cutout (cone opening)
SPK_SCREW_CIRCLE = 92.0                    # EST mount-hole PCD
SPK_WALL = 3.0
CHIN_W = 112.0                             # chin width (X)
CHIN_DROP = 58.0                           # how far the chin hangs below the frame
CHIN_FRONT_Z = 0.0                         # chin front flush with the frame front
CHIN_BACK_Z = 86.0                         # chin depth back-plane (>= driver dia + walls)

# Amp + buck posts on the rear-external back wall, clear of the centred hatch.
AMP_W, AMP_H, AMP_CX, AMP_CY = 74.0, 44.0, 0.0, 64.0      # EST TPA3116 board (top strip)
BUCK_W, BUCK_H, BUCK_CX, BUCK_CY = 50.0, 30.0, 92.0, 0.0  # EST buck (right of hatch)
POST_H, POST_R, POST_PILOT_R = 8.0, 3.0, 1.3

DC_JACK_DIA = 8.0                          # barrel jack (back wall, top-left)


def box(sx, sy, sz, cx=0.0, cy=0.0, cz=0.0):
    b = trimesh.creation.box(extents=(sx, sy, sz)); b.apply_translation((cx, cy, cz)); return b


def cyl(r, h, cx=0.0, cy=0.0, cz=0.0, sections=64):
    c = trimesh.creation.cylinder(radius=r, height=h, sections=sections)
    c.apply_translation((cx, cy, cz)); return c


def cyl_y(r, h, cx, cy, cz, sections=64):
    """Cylinder with its axis along Y (for down-firing driver/screw holes)."""
    c = trimesh.creation.cylinder(radius=r, height=h, sections=sections)
    c.apply_transform(rotation_matrix(np.radians(90), [1, 0, 0]))
    c.apply_translation((cx, cy, cz)); return c


def build():
    eps = 0.5
    solids, cutters = [], []
    half_h = OUTER_H / 2

    # --- Outer shell block --------------------------------------------------
    solids.append(box(OUTER_W, OUTER_H, BODY_D, cz=BODY_D / 2))

    # Front viewing window through the lip.
    cutters.append(box(SCREEN_W - 2 * BEZEL_OVERLAP, SCREEN_H - 2 * BEZEL_OVERLAP,
                       LIP + eps, cz=LIP / 2))
    # Panel locating pocket.
    pocket_d = SCREEN_T + 0.5
    cutters.append(box(SCREEN_W + FIT_GAP, SCREEN_H + FIT_GAP, pocket_d + eps,
                       cz=LIP + pocket_d / 2))
    # Main electronics cavity up to the back wall.
    cav_z0 = LIP + pocket_d
    back_wall_z0 = BODY_D - WALL
    cav_d = back_wall_z0 - cav_z0
    cutters.append(box(OUTER_W - 2 * WALL, OUTER_H - 2 * WALL, cav_d + eps,
                       cz=cav_z0 + cav_d / 2))
    # Pi access hatch (Pi pokes through) — centred.
    cutters.append(box(PI_W + 8, PI_H + 8, WALL + 2 * eps,
                       cx=PI_CX, cy=PI_CY, cz=back_wall_z0 + WALL / 2))
    # Pi port slot through the RIGHT side wall.
    cutters.append(box(2 * WALL, PI_PORT_W, PI_PORT_H,
                       cx=OUTER_W / 2 - WALL / 2, cy=PI_CY, cz=cav_z0 + PI_PORT_H / 2 + 1))

    # --- Down-firing sealed speaker chin (below the frame) -----------------
    chin_top = -half_h + 2                     # 2mm overlap fuses to the housing bottom
    chin_bot = -half_h - CHIN_DROP
    chin_cy = (chin_top + chin_bot) / 2
    chin_hy = chin_top - chin_bot
    chin_cz = (CHIN_FRONT_Z + CHIN_BACK_Z) / 2
    chin_dz = CHIN_BACK_Z - CHIN_FRONT_Z
    solids.append(box(CHIN_W, chin_hy, chin_dz, 0, chin_cy, chin_cz))
    cutters.append(box(CHIN_W - 2 * SPK_WALL, chin_hy - 2 * SPK_WALL, chin_dz - 2 * SPK_WALL,
                       0, chin_cy, chin_cz))
    # Driver fires down through the chin's bottom face.
    cutters.append(cyl_y(SPK_BAFFLE_DIA / 2, SPK_WALL + 2 * eps, 0, chin_bot + SPK_WALL / 2, chin_cz))
    for a in (45, 135, 225, 315):
        hx = (SPK_SCREW_CIRCLE / 2) * np.cos(np.radians(a))
        hz = chin_cz + (SPK_SCREW_CIRCLE / 2) * np.sin(np.radians(a))
        cutters.append(cyl_y(1.6, SPK_WALL + 2 * eps, hx, chin_bot + SPK_WALL / 2, hz))

    # --- Board mounting posts on the rear-external back wall ----------------
    def posts(w, h, cx, cy):
        z = BODY_D + POST_H / 2
        for sx in (-1, 1):
            for sy in (-1, 1):
                px, py = cx + sx * w / 2, cy + sy * h / 2
                solids.append(cyl(POST_R, POST_H, px, py, z))
                cutters.append(cyl(POST_PILOT_R, POST_H + eps, px, py, z))
    posts(AMP_W, AMP_H, AMP_CX, AMP_CY)
    posts(BUCK_W, BUCK_H, BUCK_CX, BUCK_CY)

    # --- DC barrel jack through the back wall (top-left) -------------------
    cutters.append(cyl(DC_JACK_DIA / 2, 2 * WALL, cx=-OUTER_W / 2 + 25, cy=half_h - 20,
                       cz=BODY_D, sections=48))

    body = union(solids, engine="manifold")
    body = difference([body, union(cutters, engine="manifold")], engine="manifold")
    return body


def report(mesh):
    b = mesh.bounds
    dims = b[1] - b[0]
    print(f"  watertight : {mesh.is_watertight}")
    print(f"  volume     : {mesh.volume/1000:.1f} cm^3  (~{mesh.volume*1.24/1000:.0f} g PETG)")
    print(f"  bbox (mm)  : {dims[0]:.1f} W x {dims[1]:.1f} H x {dims[2]:.1f} D")
    hang = (OUTER_H / 2) - (-b[0][1])            # how far the chin drops below the frame bottom
    print(f"  chin hangs : {(-b[0][1]) - OUTER_H/2:.1f} mm below the frame bottom")
    print(f"  rear stick : {dims[2]-REBATE_DEPTH:.1f} mm past the frame back (chin depth)")
    print(f"  in-rebate  : W {dims[0]<=REBATE_W} (panel plane {OUTER_W}x{OUTER_H} fits {REBATE_W}x{REBATE_H})")


if __name__ == "__main__":
    m = build()
    m.export("wall-housing.stl")
    print("wrote wall-housing.stl")
    report(m)
