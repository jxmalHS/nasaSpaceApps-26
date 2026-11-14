"""
charts.py - two simple pictures for non-experts (saved as PNG next to the report).

1. ranking.png       - "Which Earth sites look most like the Moon target?"
                       one bar per site, coloured by type (NASA site / new candidate / farmland)
2. closeness_<site>.png - "How close is this site to the Moon?"
                       one small panel per measurement (each in its own unit), Moon vs site

Colours: the reference palette from the data-viz guidelines, first three slots in a
fixed order (validated colourblind-safe for three categories). Text is never coloured.
"""
from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")                      # draw to files, no window
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

from features import FEATURE_INFO  # noqa: E402
from report import UNIT_TEXT  # noqa: E402

SURFACE, INK, INK_2, MUTED, GRID, AXIS = "#fcfcfb", "#0b0b0b", "#52514e", "#898781", "#e1e0d9", "#c3c2b7"
ROLE_STYLE = {                               # fixed order: colour follows the type, never the rank
    "baseline": ("NASA analog site", "#2a78d6"),
    "candidate": ("New candidate", "#eb6834"),
    "negative_control": ("Farmland (should score low)", "#1baf7a"),
}
MOON_COLOUR = MUTED                          # the target is a neutral reference, not a series


def pretty(name: str) -> str:
    return name.replace("_", " ").title().replace("Sp Crater", "SP Crater").replace("Jett3", "(JETT3)")


def _style(ax):
    ax.set_facecolor(SURFACE)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color(AXIS)
    ax.tick_params(colors=MUTED, length=0, labelsize=9)
    ax.grid(axis="x", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def ranking_chart(ranking: pd.DataFrame, mission: str, out: Path, max_sites: int = 20) -> Path:
    """Horizontal bars, best at the top. Farmland controls are always shown (they prove the point)."""
    shown = ranking.head(max_sites)
    extra = ranking[(ranking.role == "negative_control") & ~ranking.site.isin(shown.site)]
    shown = pd.concat([shown, extra]).iloc[::-1]          # reverse so rank 1 is drawn at the top
    fig, ax = plt.subplots(figsize=(9, 0.42 * len(shown) + 2.2), facecolor=SURFACE)
    _style(ax)
    y = range(len(shown))
    ax.barh(list(y), shown["score"], height=0.62,
            color=[ROLE_STYLE[r][1] for r in shown.role], edgecolor=SURFACE, linewidth=2)
    ax.set_yticks(list(y), [f"#{r['rank']}  {pretty(r.site)}" for _, r in shown.iterrows()],
                  color=INK, fontsize=9)
    ax.set_xlim(0, 1.18)
    ax.set_xticks([0, 0.25, 0.5, 0.75, 1.0])
    for yi, (_, r) in zip(y, shown.iterrows()):           # value + requirements beside each bar
        rules = r.req_met + r.req_not_met + r.req_unknown
        low = "   · low evidence" if r.get("low_evidence", False) else ""
        ax.text(r.score + 0.015, yi, f"{r.score:.2f}   {r.req_met}/{rules} rules met{low}",
                va="center", fontsize=8.5, color=INK_2)
    ax.set_xlabel("Similarity to the Moon target  (0 = nothing alike, 1 = identical terrain)",
                  color=INK_2, fontsize=9)
    handles = [plt.Rectangle((0, 0), 1, 1, color=c) for role, (_, c) in ROLE_STYLE.items()
               if role in set(shown.role)]
    labels = [lab for role, (lab, _) in ROLE_STYLE.items() if role in set(shown.role)]
    ax.legend(handles, labels, loc="lower right", frameon=False, fontsize=8.5, labelcolor=INK_2)
    fig.suptitle("Which Earth sites look most like the lunar south pole?", x=0.02, ha="left",
                 fontsize=13, color=INK, fontweight="bold")
    ax.set_title(f"Mission: {mission.replace('_', ' ')}  ·  terrain shape only  ·  "
                 f"a terrain match does not validate hardware", loc="left", fontsize=8.5, color=INK_2)
    fig.tight_layout()
    path = out / "ranking.png"
    fig.savefig(path, dpi=150, facecolor=SURFACE)
    plt.close(fig)
    return path


def closeness_chart(site: str, details: dict, mission_weights: dict, out: Path) -> Path:
    """Small panels: for each measurement the mission cares about, the Moon vs the site."""
    rows = [d for d in details["differences"] if d["feature"] in mission_weights
            and d["target"] is not None and d["test_tile"] is not None]
    n = len(rows)
    cols = 3
    nrows = -(-n // cols)
    fig, axes = plt.subplots(nrows, cols, figsize=(10, 2.1 * nrows + 1.2), facecolor=SURFACE, squeeze=False)
    for ax in axes.flat[n:]:
        ax.set_visible(False)
    for ax, d in zip(axes.flat, rows):
        _style(ax)
        unit, label, *_ = FEATURE_INFO[d["feature"]]
        vals = [d["target"], d["test_tile"]]
        ax.barh([1, 0], vals, height=0.6, color=[MOON_COLOUR, ROLE_STYLE["baseline"][1]],
                edgecolor=SURFACE, linewidth=2)
        ax.set_yticks([1, 0], ["Moon", "Site"], color=INK, fontsize=9)
        top = max(vals) * 1.35 or 1
        ax.set_xlim(0, top)
        for yi, v in zip([1, 0], vals):
            ax.text(v + top * 0.02, yi, f"{v:.3g}{UNIT_TEXT.get(unit, ' ' + unit)}",
                    va="center", fontsize=8.5, color=INK_2)
        ax.set_title(label, loc="left", fontsize=9.5, color=INK, fontweight="bold")
        gap = d["statement"].replace(label + " ", "", 1).removeprefix("is ")   # "8.5° gentler than ..."
        ax.set_xlabel(gap, fontsize=8, color=INK_2)
    fig.suptitle(f"How close is {pretty(site)} to the Moon target?", x=0.02, ha="left",
                 fontsize=13, color=INK, fontweight="bold")
    fig.text(0.02, 0.005, "Site values are for its recommended 5 km test tile; Moon values are the "
             "target's typical (median) tile. Each panel has its own unit.", fontsize=8, color=INK_2)
    fig.tight_layout(rect=(0, 0.03, 1, 0.97))
    path = out / f"closeness_{site}.png"
    fig.savefig(path, dpi=150, facecolor=SURFACE)
    plt.close(fig)
    return path
