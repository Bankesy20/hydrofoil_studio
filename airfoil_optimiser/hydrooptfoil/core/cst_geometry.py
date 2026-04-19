"""
CST (Kulfan) parameterization helpers.

Uses AeroSandbox's KulfanAirfoil for all CST math — it handles Bernstein
polynomial ordering, class-function exponents, LE weight, and TE thickness
correctly.  NeuralFoil requires exactly 8 CST weights per side, so we fix
N_CST = 8 throughout the project.
"""

import numpy as np

# NeuralFoil hard-codes 8 weights per side — do not change.
N_CST = 8


def cst_to_coordinates(upper_weights, lower_weights, le_weight=0.0,
                       te_thickness=0.0, n_points=200):
    """
    Generate airfoil coordinates from CST (Kulfan) parameters via AeroSandbox.

    Returns Nx2 numpy array (x, y), normalised chord = 1.0.
    """
    from aerosandbox.geometry.airfoil.kulfan_airfoil import KulfanAirfoil

    kaf = KulfanAirfoil(
        name="candidate",
        upper_weights=np.asarray(upper_weights, dtype=float),
        lower_weights=np.asarray(lower_weights, dtype=float),
        leading_edge_weight=float(le_weight),
        TE_thickness=float(te_thickness),
    )
    return kaf.coordinates  # Nx2


def airfoil_to_cst(coords, n_weights=N_CST):
    """
    Fit CST parameters to an existing airfoil coordinate set.

    Returns: (upper_weights, lower_weights, le_weight, te_thickness)
             where weights are plain Python lists.
    """
    from aerosandbox.geometry.airfoil import Airfoil

    af = Airfoil(coordinates=np.asarray(coords, dtype=float))
    kaf = af.to_kulfan_airfoil(n_weights_per_side=n_weights)

    return (
        kaf.upper_weights.tolist(),
        kaf.lower_weights.tolist(),
        float(kaf.leading_edge_weight),
        float(kaf.TE_thickness),
    )


def downsample_airfoil_selig(coords, n_points=150):
    """
    Resample a Selig-ordered airfoil to *n_points* by arc-length
    interpolation.

    Parameters
    ----------
    coords : ndarray, shape (N, 2)
        Selig ordering: TE upper → LE → TE lower.
    n_points : int
        Target point count.  Must be odd (so the LE lands on a point);
        if even, ``n_points + 1`` is used.

    Returns
    -------
    ndarray, shape (n_points, 2)
        Resampled coordinates in the same Selig ordering.

    Notes
    -----
    - If the input already has <= *n_points*, it is returned as-is.
    - The first/last points (TE) and the LE point (min-x) are preserved
      exactly.
    - Resampling is done separately for the upper and lower surfaces so
      the LE is guaranteed to be retained.
    """
    coords = np.asarray(coords, dtype=float)

    # Safety: nothing to do
    if len(coords) <= n_points:
        return coords

    # Ensure odd so LE sits exactly on a point
    if n_points % 2 == 0:
        n_points += 1

    le_idx = int(np.argmin(coords[:, 0]))

    # Split into upper (TE→LE) and lower (LE→TE)
    upper = coords[:le_idx + 1]           # includes LE
    lower = coords[le_idx:]               # includes LE

    n_upper = n_points // 2 + 1           # includes LE endpoint
    n_lower = n_points - n_upper + 1      # includes LE endpoint (shared)

    upper_rs = _resample_surface(upper, n_upper)
    lower_rs = _resample_surface(lower, n_lower)

    # Stitch: upper already ends at LE, lower starts at LE → skip duplicate
    result = np.vstack([upper_rs, lower_rs[1:]])

    # ── safety checks ─────────────────────────────────────────────────────
    assert not np.any(np.isnan(result)), "NaN in resampled coords"
    assert abs(result[0, 0] - 1.0) < 0.05, (
        f"First point x={result[0,0]:.4f}, expected ~1.0 (TE)")
    assert abs(result[-1, 0] - 1.0) < 0.05, (
        f"Last point x={result[-1,0]:.4f}, expected ~1.0 (TE)")
    le_new = int(np.argmin(result[:, 0]))
    assert result[le_new, 0] < 0.01, (
        f"LE not retained: min x = {result[le_new,0]:.4f}")

    return result


def _resample_surface(pts, n):
    """Arc-length resample a single surface (upper or lower)."""
    dx = np.diff(pts[:, 0])
    dy = np.diff(pts[:, 1])
    ds = np.sqrt(dx ** 2 + dy ** 2)
    s = np.concatenate([[0.0], np.cumsum(ds)])

    s_new = np.linspace(s[0], s[-1], n)
    x_new = np.interp(s_new, s, pts[:, 0])
    y_new = np.interp(s_new, s, pts[:, 1])

    # Force exact endpoints
    x_new[0], y_new[0] = pts[0]
    x_new[-1], y_new[-1] = pts[-1]

    return np.column_stack([x_new, y_new])


def repanel_cosine(coords, n_points=160, le_bunch=1.3):
    """
    Repanel airfoil using cosine spacing for panel-code compatibility.

    The cosine distribution x = 0.5*(1 - cos(theta)) clusters points
    at both the leading and trailing edges where curvature is highest.
    With le_bunch > 1, theta = pi*t^le_bunch gives denser clustering at
    the leading edge (comparable to XFoil PANE). This produces .dat files
    that XFLR5 / XFOIL can use directly without further refinement.

    Parameters
    ----------
    coords : ndarray, shape (N, 2)
        Selig-ordered coordinates (TE upper -> LE -> TE lower).
    n_points : int
        Total point count.  Forced to odd so the LE lands on a point.
    le_bunch : float
        Leading-edge bunching exponent. 1.0 = standard cosine;
        1.3 gives ~10x denser LE clustering (recommended for XFoil/XFLR5).

    Returns
    -------
    ndarray, shape (n_points, 2)
        Cosine-spaced coordinates in Selig order.
    """
    coords = np.asarray(coords, dtype=float)

    if n_points % 2 == 0:
        n_points += 1

    n_per_side = n_points // 2 + 1

    # Bunched cosine spacing: θ = π·t^b concentrates points at the LE.
    # b=1.0 is standard cosine; b=1.3 gives ~10× denser LE clustering,
    # comparable to XFoil PANE distributions used by experienced designers.
    t = np.linspace(0.0, 1.0, n_per_side)
    theta = np.pi * t ** le_bunch
    x_cos = 0.5 * (1.0 - np.cos(theta))
    x_cos[0] = 0.0
    x_cos[-1] = 1.0

    le_idx = int(np.argmin(coords[:, 0]))
    upper = coords[:le_idx + 1]
    lower = coords[le_idx:]

    sort_u = np.argsort(upper[:, 0])
    sort_l = np.argsort(lower[:, 0])

    y_upper = np.interp(x_cos, upper[sort_u, 0], upper[sort_u, 1])
    y_lower = np.interp(x_cos, lower[sort_l, 0], lower[sort_l, 1])

    # Selig order: TE upper (x=1) -> LE (x=0) -> TE lower (x=1)
    upper_panel = np.column_stack([x_cos[::-1], y_upper[::-1]])
    lower_panel = np.column_stack([x_cos[1:], y_lower[1:]])

    return np.vstack([upper_panel, lower_panel])


# XFOIL / XFLR5 historically keep airfoil names in a short fixed buffer (~32 chars).
# A long export stem on line 1 can make XFLR5 refuse or mis-read the file.
_MAX_DAT_TITLE_LEN = 32


def _dat_title_line(name: str) -> str:
    raw = str(name).strip().replace("\r", " ").replace("\n", " ")
    # ASCII only — UTF-8 titles can confuse older parsers.
    safe = raw.encode("ascii", errors="replace").decode("ascii")
    if len(safe) <= _MAX_DAT_TITLE_LEN:
        return safe if safe else "optimized"
    return safe[: _MAX_DAT_TITLE_LEN]


def dat_string_from_coords(coords, name="optimized", comment_lines=None):
    """Convert Nx2 coordinates to a Selig-format .dat file string.

    Selig order: upper surface **trailing edge → leading edge**, then lower
    **leading edge → trailing edge** (duplicate LE once; upper and lower TE
    may differ by the finite TE gap).

    ``comment_lines`` (optional): metadata lines inserted after the title line,
    before coordinate rows. Non-empty lines that do not start with ``#`` get
    a ``# `` prefix so common CAD tools can treat them as comments.

    The title line is truncated to ASCII and a short length (see
    ``_MAX_DAT_TITLE_LEN``) so XFLR5 / XFOIL importers accept it; use the download
    filename for a long label.
    """
    coords = np.asarray(coords, dtype=float).copy()
    # Re-centre vertically so TE midpoint is at y=0
    # (prevents XFLR5 reporting false camber when it closes the TE gap)
    te_mid_y = (coords[0, 1] + coords[-1, 1]) / 2.0
    coords[:, 1] -= te_mid_y

    lines = [_dat_title_line(name)]
    if comment_lines:
        for raw in comment_lines:
            c = str(raw).strip()
            if not c:
                continue
            lines.append(c if c.startswith("#") else f"# {c}")
    # Two spaces + 7 decimals matches common UIUC Selig .dat style; no leading tab.
    for x, y in coords:
        lines.append(f"  {x:.7f}  {y:.7f}")
    return "\n".join(lines) + "\n"


def _split_and_interpolate(coords, n_stations=201):
    """
    Split airfoil coordinates into upper/lower surfaces and interpolate
    onto a common set of x stations.

    Returns (x_stations, y_upper, y_lower).
    """
    x = coords[:, 0]
    le_idx = int(np.argmin(x))
    upper = coords[:le_idx + 1]
    lower = coords[le_idx:]

    x_stations = np.linspace(0, 1, n_stations)

    sort_u = np.argsort(upper[:, 0])
    y_upper = np.interp(x_stations, upper[sort_u, 0], upper[sort_u, 1])

    sort_l = np.argsort(lower[:, 0])
    y_lower = np.interp(x_stations, lower[sort_l, 0], lower[sort_l, 1])

    return x_stations, y_upper, y_lower


def get_tc_from_coords(coords):
    """
    Compute max thickness-to-chord ratio from coordinates.

    Returns: (max_tc, max_tc_x_position)
    """
    x_stations, y_upper, y_lower = _split_and_interpolate(coords)

    thickness = y_upper - y_lower
    max_tc = float(np.max(thickness))
    max_tc_pos = float(x_stations[np.argmax(thickness)])

    return max_tc, max_tc_pos


def get_camber_from_coords(coords):
    """
    Compute max camber and its chordwise position from coordinates.

    The camber line is the locus of points midway between the upper and
    lower surfaces.  Max camber is the largest absolute deviation of
    the camber line from the chord line (y = 0).

    Returns: (max_camber, max_camber_x_position)
        Both expressed as fractions of chord.
    """
    x_stations, y_upper, y_lower = _split_and_interpolate(coords)

    camber_line = (y_upper + y_lower) / 2.0
    abs_camber = np.abs(camber_line)
    max_camber = float(np.max(abs_camber))
    max_camber_pos = float(x_stations[np.argmax(abs_camber)])

    return max_camber, max_camber_pos


def get_region_mean_thickness(coords, x_start, x_end, n_stations=201):
    """
    Return the mean thickness between ``x_start`` and ``x_end``.

    The bounds are given as fractions of chord (0 = LE, 1 = TE). This is more
    robust than using a single-point thickness or a discrete curvature radius
    when we want to preserve the overall leading/trailing-edge fullness.
    """
    x_start = float(np.clip(x_start, 0.0, 1.0))
    x_end = float(np.clip(x_end, 0.0, 1.0))
    if x_end < x_start:
        x_start, x_end = x_end, x_start

    x_stations, y_upper, y_lower = _split_and_interpolate(
        coords, n_stations=n_stations)
    mask = (x_stations >= x_start) & (x_stations <= x_end)

    if not np.any(mask):
        idx = int(np.argmin(np.abs(x_stations - 0.5 * (x_start + x_end))))
        return float(y_upper[idx] - y_lower[idx])

    thickness = y_upper[mask] - y_lower[mask]
    return float(np.mean(thickness))


def get_thickness_at_stations(coords, x_stations):
    """
    Return thickness values at the requested x/c stations.

    This is used for seed-relative edge locks where we want to constrain the
    local upper-lower distance over a region, not just the regional average.
    """
    x_stations = np.asarray(x_stations, dtype=float)
    x_stations = np.clip(x_stations, 0.0, 1.0)
    _, y_upper, y_lower = _split_and_interpolate(
        coords, n_stations=max(401, len(x_stations) * 4))
    base_x = np.linspace(0.0, 1.0, max(401, len(x_stations) * 4))
    y_u = np.interp(x_stations, base_x, y_upper)
    y_l = np.interp(x_stations, base_x, y_lower)
    return y_u - y_l
