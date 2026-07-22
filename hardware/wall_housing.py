#!/usr/bin/env python3
"""Parametric rear housing for the homecal wall unit.

An integrated shell that (1) retains the Waveshare 10.1" DSI panel against the
picture-frame mat from behind, (2) gives the Pi (mounted on the panel back) a
bay + a port slot, (3) carries the all-in-one audio: a sealed speaker pod plus
mounting posts for the Class-D amp and the buck converter, and (4) a DC inlet.

Built with CSG (trimesh + manifold3d) so it exports a watertight STL for a print
service. EVERY dimension I don't have yet is a variable below with a `# MEASURE`
or `# EST` tag — change those two or three numbers once the panel is in hand and
re-run; no redraw.

Coordinate system: XY centred on the panel; Z=0 is the front (mat) plane, +Z
runs rearward (into the wall). Units are millimetres.

    python wall_housing.py         # -> wall-housing.stl  (+ prints a fit report)
"""
from __future__ import annotations
import numpy as np
import trimesh
from trimesh.boolean import union, difference

# ---------------------------------------------------------------------------
# PARAMETERS
# ---------------------------------------------------------------------------
# Picture-frame rebate (the well behind the picture) — MEASURED by user.
REBATE_W, REBATE_H, REBATE_DEPTH = 260.0, 180.0, 35.0

# Panel outer glass/PCB outline — the ONE number still to confirm with calipers.
SCREEN_W, SCREEN_H = 233.0, 153.0          # EST — MEASURE outer outline (landscape)
SCREEN_T = 10.8                            # Waveshare 10.1-DSI-TOUCH-A datasheet
BEZEL_OVERLAP = 5.0                        # how far the front lip laps the bezel
FIT_GAP = 0.8                              # clearance around the panel in its pocket

# Shell
WALL = 3.0                                 # PETG wall thickness
LIP = 3.0                                  # front retaining-lip thickness
BODY_D = 32.0                              # shell depth (sits within the 35 rebate)
REBATE_CLEAR = 1.0                         # total slop so the shell drops into the rebate
OUTER_W = REBATE_W - REBATE_CLEAR
OUTER_H = REBATE_H - REBATE_CLEAR

# Raspberry Pi 5 (mounted on the panel back; housing only clears it + its ports).
# The Pi is deeper than the shell, so it pokes through a back-wall hatch — the
# user accepted "the stack pokes out the back".
PI_W, PI_H = 90.0, 62.0                    # EST bounding incl. a little clearance
PI_CX, PI_CY = -50.0, 0.0                  # EST Pi centre on the panel back
PI_PORT_W, PI_PORT_H = 42.0, 14.0          # EST USB+Ethernet stack footprint on its edge

# Speaker — Jaycar AS3034, 3" full-range, in a sealed rear-firing pod.
SPK_BAFFLE_DIA = 74.0                      # EST driver cutout (cone opening)
SPK_SCREW_CIRCLE = 92.0                    # EST mount-hole PCD
SPK_CHAMBER_ID = 96.0                      # sealed inner diameter
SPK_DEPTH = 45.0                           # protrudes past the back wall
SPK_WALL = 3.0
SPK_CX, SPK_CY = 62.0, -18.0               # placed clear of the Pi bay

# Amp + buck board mounting posts (rear-external, beside the Pi) — WxH footprint.
AMP_W, AMP_H, AMP_CX, AMP_CY = 70.0, 50.0, 55.0, 55.0     # EST TPA3116 board
BUCK_W, BUCK_H, BUCK_CX, BUCK_CY = 55.0, 30.0, -40.0, -58.0  # EST 24V->5V buck
POST_H = 8.0                               # standoff height off the back wall
POST_R = 3.0
POST_PILOT_R = 1.3                         # self-tapping M2.5/M3 pilot

DC_JACK_DIA = 8.0                          # panel-mount barrel jack (bottom wall)


def box(sx, sy, sz, cx=0.0, cy=0.0, cz=0.0):
    b = trimesh.creation.box(extents=(sx, sy, sz))
    b.apply_translation((cx, cy, cz))
    return b


def cyl(r, h, cx=0.0, cy=0.0, cz=0.0, sections=64):
    c = trimesh.creation.cylinder(radius=r, height=h, sections=sections)
    c.apply_translation((cx, cy, cz))
    return c


def build():
    eps = 0.5
    solids, cutters = [], []

    # --- Outer shell block (z: 0..BODY_D) -----------------------------------
    solids.append(box(OUTER_W, OUTER_H, BODY_D, cz=BODY_D / 2))

    # Front viewing window through the lip (z: 0..LIP): exposes the active area,
    # leaving a frame of material that laps the panel bezel by BEZEL_OVERLAP.
    win_w = SCREEN_W - 2 * BEZEL_OVERLAP
    win_h = SCREEN_H - 2 * BEZEL_OVERLAP
    cutters.append(box(win_w, win_h, LIP + eps, cz=LIP / 2))

    # Panel locating pocket (z: LIP .. LIP+SCREEN_T): walls here hold the panel
    # laterally; the panel seats against the back face of the lip.
    pocket_z0 = LIP
    pocket_d = SCREEN_T + 0.5
    cutters.append(box(SCREEN_W + FIT_GAP, SCREEN_H + FIT_GAP, pocket_d + eps,
                       cz=pocket_z0 + pocket_d / 2))

    # Main electronics cavity (behind the panel, up to the back wall).
    cav_z0 = pocket_z0 + pocket_d
    back_wall_z0 = BODY_D - WALL
    cav_d = back_wall_z0 - cav_z0
    cutters.append(box(OUTER_W - 2 * WALL, OUTER_H - 2 * WALL, cav_d + eps,
                       cz=cav_z0 + cav_d / 2))

    # Pi access hatch through the back wall — the Pi pokes through here.
    cutters.append(box(PI_W + 8, PI_H + 8, WALL + 2 * eps,
                       cx=PI_CX, cy=PI_CY, cz=back_wall_z0 + WALL / 2))

    # Pi port slot through the LEFT side wall, aligned to the Pi's port edge.
    cutters.append(box(2 * WALL, PI_PORT_W, PI_PORT_H,
                       cx=-OUTER_W / 2 + WALL / 2, cy=PI_CY,
                       cz=cav_z0 + PI_PORT_H / 2 + 1))

    # --- Sealed speaker pod (rear-firing), fused to the back wall -----------
    pod_or = SPK_CHAMBER_ID / 2 + SPK_WALL
    pod_z0 = back_wall_z0                      # front cap merges with the back wall
    pod_z1 = BODY_D + SPK_DEPTH
    pod_h = pod_z1 - pod_z0
    solids.append(cyl(pod_or, pod_h, SPK_CX, SPK_CY, (pod_z0 + pod_z1) / 2))
    cutters.append(cyl(SPK_CHAMBER_ID / 2, pod_h - 2 * SPK_WALL, SPK_CX, SPK_CY,
                       (pod_z0 + pod_z1) / 2))
    # Driver cutout + 4 mount holes on the rear cap.
    cutters.append(cyl(SPK_BAFFLE_DIA / 2, SPK_WALL + 2 * eps, SPK_CX, SPK_CY,
                       pod_z1 - SPK_WALL / 2))
    for a in (45, 135, 225, 315):
        hx = SPK_CX + (SPK_SCREW_CIRCLE / 2) * np.cos(np.radians(a))
        hy = SPK_CY + (SPK_SCREW_CIRCLE / 2) * np.sin(np.radians(a))
        cutters.append(cyl(1.6, SPK_WALL + 2 * eps, hx, hy, pod_z1 - SPK_WALL / 2))

    # --- Board mounting posts on the rear-external back-wall face -----------
    def posts(w, h, cx, cy):
        z = BODY_D + POST_H / 2
        for sx in (-1, 1):
            for sy in (-1, 1):
                px, py = cx + sx * w / 2, cy + sy * h / 2
                solids.append(cyl(POST_R, POST_H, px, py, z))
                cutters.append(cyl(POST_PILOT_R, POST_H + eps, px, py, z))
    posts(AMP_W, AMP_H, AMP_CX, AMP_CY)
    posts(BUCK_W, BUCK_H, BUCK_CX, BUCK_CY)

    # --- DC barrel jack through the bottom wall (hole runs along -Y) --------
    jack = trimesh.creation.cylinder(radius=DC_JACK_DIA / 2, height=2 * WALL, sections=48)
    jack.apply_transform(trimesh.transformations.rotation_matrix(np.radians(90), [1, 0, 0]))
    jack.apply_translation((OUTER_W / 4, -OUTER_H / 2, cav_z0 + DC_JACK_DIA))
    cutters.append(jack)

    body = union(solids, engine="manifold")
    body = difference([body, union(cutters, engine="manifold")], engine="manifold")
    return body


def report(mesh):
    b = mesh.bounds
    dims = b[1] - b[0]
    print(f"  watertight : {mesh.is_watertight}")
    print(f"  volume     : {mesh.volume/1000:.1f} cm^3  (~{mesh.volume*1.24/1000:.0f} g PETG)")
    print(f"  bbox (mm)  : {dims[0]:.1f} W x {dims[1]:.1f} H x {dims[2]:.1f} D")
    print(f"  fits rebate: W {dims[0]<=REBATE_W}  H {dims[1]<=REBATE_H}  "
          f"(depth {dims[2]:.1f} vs rebate {REBATE_DEPTH} -> "
          f"{'protrudes '+format(dims[2]-REBATE_DEPTH,'.1f')+'mm (accepted)' if dims[2]>REBATE_DEPTH else 'within'})")


if __name__ == "__main__":
    m = build()
    m.export("wall-housing.stl")
    print("wrote wall-housing.stl")
    report(m)
