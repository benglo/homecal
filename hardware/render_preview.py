#!/usr/bin/env python3
"""Offscreen preview of wall-housing.stl (matplotlib Agg, no display needed).

Renders two views with ghost boxes for the panel / Pi / driver so the fit reads
clearly. -> wall-housing-preview.png
"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
import numpy as np
import trimesh
import wall_housing as wh

m = trimesh.load("wall-housing.stl")
tris = m.triangles

# Simple face shading by z-facing normal.
n = m.face_normals
shade = 0.55 + 0.45 * np.clip(n[:, 2] * 0.5 + n[:, 0] * 0.3 + 0.6, 0, 1)
colors = np.zeros((len(tris), 4))
colors[:, 0], colors[:, 1], colors[:, 2] = 0.30 * shade, 0.55 * shade, 0.85 * shade
colors[:, 3] = 1.0


def ghost(ax, sx, sy, sz, cx, cy, cz, col):
    x0, x1 = cx - sx / 2, cx + sx / 2
    y0, y1 = cy - sy / 2, cy + sy / 2
    z0, z1 = cz - sz / 2, cz + sz / 2
    for (a, b) in [((x0, y0, z0), (x1, y0, z0)), ((x1, y0, z0), (x1, y1, z0)),
                   ((x1, y1, z0), (x0, y1, z0)), ((x0, y1, z0), (x0, y0, z0)),
                   ((x0, y0, z1), (x1, y0, z1)), ((x1, y0, z1), (x1, y1, z1)),
                   ((x1, y1, z1), (x0, y1, z1)), ((x0, y1, z1), (x0, y0, z1)),
                   ((x0, y0, z0), (x0, y0, z1)), ((x1, y0, z0), (x1, y0, z1)),
                   ((x1, y1, z0), (x1, y1, z1)), ((x0, y1, z0), (x0, y1, z1))]:
        ax.plot(*zip(a, b), color=col, lw=1.4, alpha=0.9)


fig = plt.figure(figsize=(15, 7))
for i, (elev, azim, title) in enumerate([(22, -60, "rear 3/4 — pod, Pi hatch, board posts"),
                                         (18, 120, "front 3/4 — retaining lip + window")]):
    ax = fig.add_subplot(1, 2, i + 1, projection="3d")
    pc = Poly3DCollection(tris, facecolors=colors, edgecolors=(0, 0, 0, 0.06), linewidths=0.2)
    ax.add_collection3d(pc)
    # Ghosts: panel (front), Pi (poking out back), driver disc (on pod rear)
    ghost(ax, wh.SCREEN_W, wh.SCREEN_H, wh.SCREEN_T, 0, 0, wh.LIP + wh.SCREEN_T / 2, "#e6a100")
    ghost(ax, wh.PI_W, wh.PI_H, 20, wh.PI_CX, wh.PI_CY, wh.BODY_D + 4, "#d55e00")
    b = m.bounds
    ctr = (b[0] + b[1]) / 2
    span = (b[1] - b[0]).max() / 2 * 1.05
    ax.set_xlim(ctr[0] - span, ctr[0] + span)
    ax.set_ylim(ctr[1] - span, ctr[1] + span)
    ax.set_zlim(ctr[2] - span, ctr[2] + span)
    ax.set_box_aspect((1, 1, 1))
    ax.view_init(elev=elev, azim=azim)
    ax.set_title(title, fontsize=11)
    ax.set_xlabel("X (W)"); ax.set_ylabel("Y (H)"); ax.set_zlabel("Z (depth)")

fig.suptitle("homecal wall housing — v1 parametric (orange = panel, red = Pi)", fontsize=13)
fig.tight_layout()
fig.savefig("wall-housing-preview.png", dpi=110)
print("wrote wall-housing-preview.png")
