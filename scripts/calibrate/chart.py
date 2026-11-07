"""Chart for docs/calibration.md: simulated vs Google hourly shape on Friday, three held-out places.

Run: uv run --with matplotlib python scripts/calibrate/chart.py
Picks the best, the median and the worst held-out place, so the chart does not only show wins.
"""

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[2]
details = json.loads((ROOT / "data/city/calibration-details.json").read_text())

# Validated pair (dataviz validator, light surface): slot 1 blue, slot 2 orange.
SURFACE, INK, INK_2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e6e5e0"
SIM, GOOGLE = "#2a78d6", "#eb6834"

held = sorted(details["heldOut"], key=lambda p: p["fitted"], reverse=True)
picks = [held[0], held[len(held) // 2], held[-1]]


def hour_label(h: int) -> str:
    h %= 24
    return "12a" if h == 0 else "12p" if h == 12 else f"{h}a" if h < 12 else f"{h - 12}p"


fig, axes = plt.subplots(1, 3, figsize=(12, 3.6), dpi=200, sharey=True, facecolor=SURFACE)
for ax, place in zip(axes, picks):
    rows = sorted(place["friday"], key=lambda r: (r["hour"] - 5) % 24)  # business day: 5 AM to 4 AM
    x = [(r["hour"] - 5) % 24 for r in rows]
    google = [r["google"] for r in rows]
    sim = [r["sim"] for r in rows]
    # Both curves scaled to their own Friday peak, because only the shape is compared.
    gmax, smax = max(google), max(sim)
    ax.plot(x, [g / gmax * 100 for g in google], color=GOOGLE, lw=2, ls=(0, (4, 2)), label="Google busy")
    ax.plot(x, [s / smax * 100 for s in sim], color=SIM, lw=2, label="Simulated orders")
    ax.set_facecolor(SURFACE)
    ax.set_title(place["name"], loc="left", fontsize=11, color=INK, fontweight="bold", pad=24)
    ax.text(
        0, 1.04, f"week r = {place['fitted']:.2f}   city-average curve {place['naive']:.2f}",
        transform=ax.transAxes, fontsize=8.5, color=INK_2, va="bottom",
    )
    ticks = [1, 7, 13, 19]  # 6a, 12p, 6p, 12a
    ax.set_xticks(ticks, [hour_label(t + 5) for t in ticks])
    ax.set_xlim(0, 23)
    ax.set_ylim(0, 108)
    ax.set_yticks([0, 50, 100])
    ax.grid(axis="y", color=GRID, lw=0.8)
    ax.tick_params(colors=INK_2, labelsize=8.5, length=0)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color(GRID)

axes[0].set_ylabel("% of Friday peak", color=INK_2, fontsize=9)
handles, labels = axes[0].get_legend_handles_labels()
fig.legend(handles, labels, loc="lower center", ncol=2, frameon=False, fontsize=9, labelcolor=INK_2, bbox_to_anchor=(0.5, -0.02))
fig.tight_layout(rect=(0, 0.06, 1, 1))
out = ROOT / "docs/calibration-friday.png"
fig.savefig(out, facecolor=SURFACE)
print(f"wrote {out}")
