"""
Plotly figure generation for HydroOptFoil.

Vector-rendered (SVG) — perfectly crisp at any zoom / DPI.
Dark-background engineering style inspired by xoptfoil2.

Conventions
-----------
Seed airfoil : blue  (#4a9eff)
Optimised    : hot pink / magenta (#ff4081)
Background   : dark (#0d1117)
All functions return a Plotly *figure*; the caller uses
``st.plotly_chart(fig, use_container_width=True)``.
"""

import plotly.graph_objects as go
import numpy as np

# ── colour palette ────────────────────────────────────────────────────────────
_BG       = "#0d1117"
_PAPER    = "#0d1117"
_GRID     = "#1e2530"
_TEXT     = "#c9d1d9"
_TEXT_DIM = "#8b949e"
_SEED_CLR = "#4a9eff"
_OPT_CLR  = "#ff4081"
_CONV_CLR = "#00e676"
_ZERO_CLR = "#30363d"

# ── shared layout defaults ────────────────────────────────────────────────────
_FONT = dict(family="JetBrains Mono, Fira Code, SF Mono, Consolas, monospace",
             size=11, color=_TEXT)

_AXIS_COMMON = dict(
    gridcolor=_GRID, gridwidth=0.5,
    zeroline=True, zerolinecolor=_ZERO_CLR, zerolinewidth=0.8,
    linecolor="#30363d", linewidth=0.7,
    tickfont=dict(size=10, color=_TEXT_DIM),
    title_font=dict(size=11, color=_TEXT),
)

_LEGEND = dict(
    font=dict(size=10, color=_TEXT),
    bgcolor="rgba(22,27,34,0.85)",
    bordercolor="#30363d", borderwidth=0.5,
)


def _base_layout(title=None, height=320, x_range=None, y_range=None,
                  **overrides):
    """Return a dark-themed layout dict with optional axis ranges."""
    xaxis = dict(**_AXIS_COMMON)
    yaxis = dict(**_AXIS_COMMON)
    if x_range is not None:
        xaxis["range"] = list(x_range)
    if y_range is not None:
        yaxis["range"] = list(y_range)

    layout = dict(
        template="plotly_dark",
        paper_bgcolor=_PAPER,
        plot_bgcolor=_BG,
        font=_FONT,
        margin=dict(l=50, r=20, t=36 if title else 14, b=42),
        height=height,
        legend=_LEGEND,
        xaxis=xaxis,
        yaxis=yaxis,
    )
    if title:
        layout["title"] = dict(text=title, font=dict(size=12, color=_TEXT),
                                x=0.5, xanchor="center", y=0.98)
    layout.update(overrides)
    return layout


def _seed_trace(**kw):
    defaults = dict(line=dict(color=_SEED_CLR, width=1.6, dash="solid"),
                    opacity=0.80, name="Seed")
    defaults.update(kw)
    return defaults


def _opt_trace(**kw):
    defaults = dict(line=dict(color=_OPT_CLR, width=2.4),
                    name="Optimised")
    defaults.update(kw)
    return defaults


# ──────────────────────────────────────────────────────────────────────────────

def plot_airfoil_comparison(seed_coords, opt_coords, chord_mm=None):
    title = "airfoil overlay"
    if chord_mm:
        title += f"  |  chord {chord_mm} mm"

    fig = go.Figure()

    # subtle fill under optimised shape
    fig.add_trace(go.Scatter(
        x=opt_coords[:, 0], y=opt_coords[:, 1],
        fill="toself", fillcolor="rgba(255,64,129,0.06)",
        line=dict(width=0), showlegend=False, hoverinfo="skip",
    ))
    fig.add_trace(go.Scatter(
        x=seed_coords[:, 0], y=seed_coords[:, 1],
        mode="lines", **_seed_trace(),
    ))
    fig.add_trace(go.Scatter(
        x=opt_coords[:, 0], y=opt_coords[:, 1],
        mode="lines", **_opt_trace(),
    ))

    fig.update_layout(**_base_layout(
        title=title, height=210,
        xaxis_title="x / c", yaxis_title="y / c",
        yaxis_scaleanchor="x", yaxis_scaleratio=1,
    ))
    return fig


def plot_two_airfoils(coords_a, coords_b, label_a, label_b, chord_mm=None):
    """Overlay two airfoils (e.g. seed vs reference) with distinct colours."""
    title = f"{label_a}  vs  {label_b}"
    if chord_mm:
        title += f"  |  chord {chord_mm} mm"

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=coords_a[:, 0], y=coords_a[:, 1],
        mode="lines",
        line=dict(color=_SEED_CLR, width=2.2),
        name=label_a,
        opacity=0.92,
    ))
    fig.add_trace(go.Scatter(
        x=coords_b[:, 0], y=coords_b[:, 1],
        mode="lines",
        line=dict(color=_OPT_CLR, width=2.2, dash="solid"),
        name=label_b,
        opacity=0.92,
    ))
    fig.update_layout(**_base_layout(
        title=title, height=240,
        xaxis_title="x / c", yaxis_title="y / c",
        yaxis_scaleanchor="x", yaxis_scaleratio=1,
    ))
    return fig


def plot_polar_cl_cd(seed_polar, seed_alphas, opt_polar, opt_alphas, Re,
                     x_range=None, y_range=None):
    fig = go.Figure()

    fig.add_trace(go.Scatter(
        x=seed_polar["CD"], y=seed_polar["CL"],
        mode="lines", **_seed_trace(),
    ))
    fig.add_trace(go.Scatter(
        x=opt_polar["CD"], y=opt_polar["CL"],
        mode="lines", **_opt_trace(),
    ))

    # mark min-drag point
    imin = int(np.argmin(opt_polar["CD"]))
    fig.add_trace(go.Scatter(
        x=[opt_polar["CD"][imin]], y=[opt_polar["CL"][imin]],
        mode="markers+text",
        marker=dict(color=_OPT_CLR, size=7, symbol="circle"),
        text=[f"Cd_min {opt_polar['CD'][imin]:.5f}"],
        textposition="middle right", textfont=dict(size=9, color=_OPT_CLR),
        showlegend=False,
    ))

    fig.update_layout(**_base_layout(
        title=f"cl vs cd  |  Re {Re/1e6:.2f}M", height=320,
        xaxis_title="cd", yaxis_title="cl",
        x_range=x_range, y_range=y_range,
    ))
    return fig


def plot_cl_cd_ratio(seed_polar, seed_alphas, opt_polar, opt_alphas, Re,
                     x_range=None, y_range=None):
    seed_r = seed_polar["CL"] / np.maximum(seed_polar["CD"], 1e-6)
    opt_r = opt_polar["CL"] / np.maximum(opt_polar["CD"], 1e-6)

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=seed_alphas, y=seed_r, mode="lines", **_seed_trace(),
    ))
    fig.add_trace(go.Scatter(
        x=opt_alphas, y=opt_r, mode="lines", **_opt_trace(),
    ))

    # mark peak glide ratio
    ipk = int(np.argmax(opt_r))
    fig.add_trace(go.Scatter(
        x=[opt_alphas[ipk]], y=[opt_r[ipk]],
        mode="markers+text",
        marker=dict(color=_OPT_CLR, size=7, symbol="triangle-down"),
        text=[f"max cl/cd {opt_r[ipk]:.1f}"],
        textposition="middle right", textfont=dict(size=9, color=_OPT_CLR),
        showlegend=False,
    ))

    fig.update_layout(**_base_layout(
        title=f"cl/cd vs \u03b1  |  Re {Re/1e6:.2f}M", height=300,
        xaxis_title="\u03b1 (\u00b0)", yaxis_title="cl / cd",
        x_range=x_range, y_range=y_range,
    ))
    return fig


def plot_cm_alpha(seed_polar, seed_alphas, opt_polar, opt_alphas, Re,
                  x_range=None, y_range=None):
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=seed_alphas, y=seed_polar["CM"], mode="lines", **_seed_trace(),
    ))
    fig.add_trace(go.Scatter(
        x=opt_alphas, y=opt_polar["CM"], mode="lines", **_opt_trace(),
    ))

    fig.update_layout(**_base_layout(
        title=f"cm vs \u03b1  |  Re {Re/1e6:.2f}M", height=300,
        xaxis_title="\u03b1 (\u00b0)", yaxis_title="cm",
        x_range=x_range, y_range=y_range,
    ))
    return fig


def plot_cd_alpha(seed_polar, seed_alphas, opt_polar, opt_alphas, Re,
                  x_range=None, y_range=None):
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=seed_alphas, y=seed_polar["CD"], mode="lines", **_seed_trace(),
    ))
    fig.add_trace(go.Scatter(
        x=opt_alphas, y=opt_polar["CD"], mode="lines", **_opt_trace(),
    ))

    # delta annotation at alpha ~ 0
    i0_s = int(np.argmin(np.abs(seed_alphas)))
    i0_o = int(np.argmin(np.abs(opt_alphas)))
    delta = float(opt_polar["CD"][i0_o] - seed_polar["CD"][i0_s])
    fig.add_annotation(
        x=float(opt_alphas[i0_o]), y=float(opt_polar["CD"][i0_o]),
        text=f"\u0394cd@0\u00b0 {delta:+.5f}",
        showarrow=True, arrowhead=0, arrowwidth=0.8, arrowcolor=_OPT_CLR,
        ax=40, ay=-25,
        font=dict(size=9, color=_OPT_CLR, family="monospace"),
    )

    fig.update_layout(**_base_layout(
        title=f"cd vs \u03b1  |  Re {Re/1e6:.2f}M", height=300,
        xaxis_title="\u03b1 (\u00b0)", yaxis_title="cd",
        x_range=x_range, y_range=y_range,
    ))
    return fig


def plot_convergence(history):
    """Plot improvement over seed (%) vs generation.

    The raw objective is seed-normalised (1.0 = same as seed, lower = better).
    We convert to improvement %: ``(1 - objective) * 100``, so the graph
    starts near 0 % and climbs as the optimiser finds better designs.
    """
    gens = list(range(len(history)))
    # Convert: objective 0.75 → 25% improvement
    improvement = [(1.0 - v) * 100 for v in history]

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=gens, y=improvement, fill="tozeroy",
        fillcolor="rgba(0,230,118,0.10)",
        line=dict(color=_CONV_CLR, width=1.8),
        name="improvement", showlegend=False,
    ))

    if len(improvement) > 1:
        fig.add_annotation(
            x=len(improvement) - 1, y=improvement[-1],
            text=f"{improvement[-1]:+.1f}%",
            showarrow=False, yshift=12,
            font=dict(size=10, color=_CONV_CLR, family="monospace"),
        )

    fig.update_layout(**_base_layout(
        title="improvement over seed", height=200,
        xaxis_title="generation", yaxis_title="improvement (%)",
    ))
    return fig


def plot_single_airfoil(coords, title="Airfoil"):
    """Plot a single airfoil (used for the Seed tab)."""
    fig = go.Figure()

    fig.add_trace(go.Scatter(
        x=coords[:, 0], y=coords[:, 1],
        fill="toself", fillcolor="rgba(74,158,255,0.08)",
        line=dict(color=_SEED_CLR, width=2.2),
        showlegend=False,
    ))

    fig.update_layout(**_base_layout(
        title=title, height=210,
        xaxis_title="x / c", yaxis_title="y / c",
        yaxis_scaleanchor="x", yaxis_scaleratio=1,
    ))
    return fig


# ──────────────────────────────────────────────────────────────────────────────
# Seed polar diagnostics (single-airfoil plots)
# ──────────────────────────────────────────────────────────────────────────────

def plot_scalar_vs_alpha(alphas, series, title, y_label, x_range=None, y_range=None):
    """
    Plot a single scalar series against alpha for the Seed tab.
    """
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=np.asarray(alphas, dtype=float),
        y=np.asarray(series, dtype=float),
        mode="lines",
        line=dict(color=_SEED_CLR, width=2.0),
        opacity=0.9,
        showlegend=False,
    ))
    fig.update_layout(**_base_layout(
        title=title,
        height=280,
        xaxis_title="α (°)",
        yaxis_title=y_label,
        x_range=x_range,
        y_range=y_range,
    ))
    return fig


def plot_cp_distribution(x_cp, cp_upper, cp_lower, title, invert_cp=True):
    """
    Plot Cp distributions (upper & lower) at a single alpha index.

    NeuralFoil provides Cp via BL edge velocities at 32 stations per side.
    Station x/c locations are not published; we use a simple 0..1 proxy for
    inspection and shape comparison.
    """
    x_cp = np.asarray(x_cp, dtype=float)
    cp_upper = np.asarray(cp_upper, dtype=float)
    cp_lower = np.asarray(cp_lower, dtype=float)

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=x_cp,
        y=cp_upper,
        mode="lines",
        line=dict(color=_SEED_CLR, width=2.0),
        name="Cp upper",
        opacity=0.9,
    ))
    fig.add_trace(go.Scatter(
        x=x_cp,
        y=cp_lower,
        mode="lines",
        line=dict(color="#7ee787", width=2.0),
        name="Cp lower",
        opacity=0.85,
    ))

    fig.update_layout(**_base_layout(
        title=title,
        height=300,
        xaxis_title="x / c  (proxy stations)",
        yaxis_title="Cp",
    ))
    if invert_cp:
        fig.update_yaxes(autorange="reversed")
    return fig


def plot_xy(
    x,
    series_dict,
    title,
    x_label,
    y_label,
    mode="lines",
    x_range=None,
    y_range=None,
):
    """
    Generic X vs Y plot for Seed tab with multiple Y series.

    Parameters
    ----------
    x : array-like
    series_dict : dict[str, array-like]
        Mapping of legend label -> y values.
    mode : str
        Plotly scatter mode ("lines", "markers", "lines+markers").
    """
    x = np.asarray(x, dtype=float)
    fig = go.Figure()

    # XFLR5-ish palette (high contrast on dark bg)
    palette = [
        _SEED_CLR,
        "#7ee787",
        "#d2a8ff",
        "#ffa657",
        "#f85149",
        "#56d4dd",
        "#c9d1d9",
    ]

    for j, (name, y) in enumerate(series_dict.items()):
        y = np.asarray(y, dtype=float)
        fig.add_trace(go.Scatter(
            x=x,
            y=y,
            mode=mode,
            line=dict(color=palette[j % len(palette)], width=2.0),
            marker=dict(size=5),
            name=str(name),
            opacity=0.9,
        ))

    fig.update_layout(**_base_layout(
        title=title,
        height=320,
        xaxis_title=x_label,
        yaxis_title=y_label,
        x_range=x_range,
        y_range=y_range,
    ))
    return fig


def plot_xy_multi(traces, title, x_label, y_label, mode="lines", x_range=None, y_range=None):
    """
    X vs Y with independent x/y per trace (e.g. multiple Reynolds on one axes).

    traces : list[tuple[str, array-like, array-like]]
        (legend name, x, y) for each series.
    """
    fig = go.Figure()
    palette = [
        _SEED_CLR,
        "#7ee787",
        "#d2a8ff",
        "#ffa657",
        "#f85149",
        "#56d4dd",
        "#c9d1d9",
    ]
    for j, (name, x, y) in enumerate(traces):
        x = np.asarray(x, dtype=float)
        y = np.asarray(y, dtype=float)
        fig.add_trace(go.Scatter(
            x=x,
            y=y,
            mode=mode,
            line=dict(color=palette[j % len(palette)], width=2.0),
            marker=dict(size=5),
            name=str(name),
            opacity=0.9,
        ))
    fig.update_layout(**_base_layout(
        title=title,
        height=340,
        xaxis_title=x_label,
        yaxis_title=y_label,
        x_range=x_range,
        y_range=y_range,
    ))
    return fig


def plot_cp_distribution_multi(x_cp, curves, title, invert_cp=True):
    """
    Overlay Cp upper/lower for several Reynolds numbers.

    curves : list[tuple[str, array-like, array-like]]
        (label e.g. \"Re 0.80M\", cp_upper, cp_lower) per Reynolds.
    """
    x_cp = np.asarray(x_cp, dtype=float)
    palette = [
        _SEED_CLR,
        "#7ee787",
        "#d2a8ff",
        "#ffa657",
        "#f85149",
        "#56d4dd",
        "#c9d1d9",
    ]
    fig = go.Figure()
    for i, (label, cp_upper, cp_lower) in enumerate(curves):
        col = palette[i % len(palette)]
        y_u = np.asarray(cp_upper, dtype=float)
        y_l = np.asarray(cp_lower, dtype=float)
        fig.add_trace(go.Scatter(
            x=x_cp, y=y_u, mode="lines",
            line=dict(color=col, width=2.0, dash="solid"),
            name=f"upper · {label}",
            opacity=0.9,
        ))
        fig.add_trace(go.Scatter(
            x=x_cp, y=y_l, mode="lines",
            line=dict(color=col, width=2.0, dash="dot"),
            name=f"lower · {label}",
            opacity=0.85,
        ))
    fig.update_layout(**_base_layout(
        title=title,
        height=340,
        xaxis_title="x / c  (proxy stations)",
        yaxis_title="Cp",
    ))
    if invert_cp:
        fig.update_yaxes(autorange="reversed")
    return fig
