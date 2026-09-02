#!/usr/bin/env python3
"""Standalone rounded down-firing soundbar for the homecal wall unit.

Decoupled from the display case: a sealed, rounded (soundbar-profile) enclosure
that sits under the picture frame with the driver firing DOWN toward the room.
Only thin speaker wires leave it (via a rear grommet) and run back to the amp/Pi
— no electronics live in here.

Built with CSG (trimesh + manifold3d + shapely). -> soundbar.stl

Axes: X = length (along the frame), Y = up, Z = depth (front/back). Units = mm.
"""
from __future__ import annotations
import numpy as np
import trimesh
from trimesh.boolean import union, difference
from trimesh.transformations import rotation_matrix
from shapely.geometry import box as sbox

# --- Parameters ---
LEN = 245.0            # length, matches the case width so it reads as one unit
DEPTH = 90.0           # front-to-back — a down-firing 3" cone needs ~80mm in plan
HEIGHT = 66.0          # tall; flat top sits under the frame, flat bottom = baffle
CORNER_R = 22.0        # cross-section rounding — the "soundbar" look
WALL = 3.0
DRV_DIA = 74.0         # AS3034 3" cutout            # EST
SCREW_PCD = 92.0       # driver mount-hole circle    # EST
WIRE_DIA = 6.0         # rear grommet for thin speaker wires
MOUNT_SPACING = 160.0  # top mounting-hole spacing (bracket to frame underside)


def cyl_y(r, h, cx, cy, cz, sections=48):
    c = trimesh.creation.cylinder(radius=r, height=h, sections=sections)
    c.apply_transform(rotation_matrix(np.radians(90), [1, 0, 0]))
    c.apply_translation((cx, cy, cz)); return c


def cyl_z(r, h, cx, cy, cz, sections=48):
    c = trimesh.creation.cylinder(radius=r, height=h, sections=sections)
    c.apply_translation((cx, cy, cz)); return c


def prism(depth, height, length, r):
    """Rounded-rectangle cross-section (depth x height) extruded along X."""
    prof = sbox(-depth / 2 + r, -height / 2 + r, depth / 2 - r, height / 2 - r).buffer(r, resolution=16)
    m = trimesh.creation.extrude_polygon(prof, height=length)   # extrudes along +Z
    m.apply_translation((0, 0, -length / 2))
    m.apply_transform(rotation_matrix(np.radians(90), [0, 1, 0]))  # length -> X
    return m


def build():
    eps = 0.6
    outer = prism(DEPTH, HEIGHT, LEN, CORNER_R)
    inner = prism(DEPTH - 2 * WALL, HEIGHT - 2 * WALL, LEN - 2 * WALL, max(2.0, CORNER_R - WALL))
    solids = [outer]
    cutters = [inner]

    # Down-firing driver + mount screws through the flat bottom (y = -HEIGHT/2).
    yb = -HEIGHT / 2 + WALL / 2
    cutters.append(cyl_y(DRV_DIA / 2, WALL + 2 * eps, 0, yb, 0))
    for a in (0, 90, 180, 270):
        hx = (SCREW_PCD / 2) * np.cos(np.radians(a))
        hz = (SCREW_PCD / 2) * np.sin(np.radians(a))
        cutters.append(cyl_y(1.6, WALL + 2 * eps, hx, yb, hz))

    # Rear grommet for the thin speaker wires (high on the back face).
    cutters.append(cyl_z(WIRE_DIA / 2, DEPTH, 0, HEIGHT / 4, 0))

    # Two mounting holes on the flat top (bracket up to the frame underside).
    yt = HEIGHT / 2 - WALL / 2
    for sx in (-1, 1):
        cutters.append(cyl_y(2.2, WALL + 2 * eps, sx * MOUNT_SPACING / 2, yt, 0))

    body = union(solids, engine="manifold")
    body = difference([body, union(cutters, engine="manifold")], engine="manifold")
    return body


def report(m):
    d = m.extents
    print(f"  watertight={m.is_watertight}  bodies={m.body_count}  faces={len(m.faces)}")
    print(f"  size (mm) : {d[0]:.0f} long x {d[1]:.0f} tall x {d[2]:.0f} deep")
    print(f"  material  : {m.volume/1000:.0f} cm^3 (~{m.volume*1.24/1000:.0f} g PETG)")


if __name__ == "__main__":
    m = build()
    m.export("soundbar.stl")
    print("wrote soundbar.stl")
    report(m)
