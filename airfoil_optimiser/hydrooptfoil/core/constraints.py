"""
Geometric constraint checking for candidate airfoil shapes.

Constraints checked
-------------------
1. Thickness-to-chord ratio (min/max band).
2. Self-intersection — upper surface must stay above lower surface.
3. Leading/trailing-edge fullness relative to the seed airfoil.
4. Curvature reversal count — penalises surfaces with wiggles that would be
   unmanufacturable or cause premature transition.
5. Trailing-edge wedge angle — ensures a minimum TE included angle to avoid
   knife-edge trailing edges that are fragile and hard to laminate.
"""

import numpy as np
from core.cst_geometry import (get_tc_from_coords, get_camber_from_coords,
                               get_thickness_at_stations)

# Maximum number of curvature sign reversals allowed per surface before a
# penalty is applied.  A clean airfoil typically has 0–1 reversal (convex
# everywhere, or one inflection between the suction peak and the TE).
# CST parameterisation is inherently smoother than Hicks-Henne, so 2 is a
# reasonable threshold — anything above signals micro-wiggles.
_MAX_CURV_REVERSALS = 2

# Minimum TE included angle (degrees).  Angles below this produce knife-edge
# trailing edges that are fragile, difficult to manufacture, and can cause
# flow separation issues.
_MIN_TE_WEDGE_DEG = 4.0


def check_geometry_constraints(coords, config):
    """
    Return a penalty value (≥ 0).  Zero means all constraints are satisfied.
    """
    penalty = 0.0

    # ── thickness / chord ──
    tc, tc_pos = get_tc_from_coords(coords)
    if tc < config["min_tc"]:
        penalty += 100.0 * (config["min_tc"] - tc) ** 2
    if tc > config["max_tc"]:
        penalty += 100.0 * (tc - config["max_tc"]) ** 2

    # ── max-thickness position ──
    tc_pos_bounds = config.get("max_tc_pos_bounds")
    if tc_pos_bounds is not None:
        lo, hi = tc_pos_bounds
        if tc_pos < lo:
            penalty += 80.0 * (lo - tc_pos) ** 2
        if tc_pos > hi:
            penalty += 80.0 * (tc_pos - hi) ** 2

    # ── camber constraints (front wing) ──
    camber_bounds = config.get("max_camber_bounds")
    camber_pos_bounds = config.get("max_camber_pos_bounds")
    if camber_bounds is not None or camber_pos_bounds is not None:
        camber, camber_pos = get_camber_from_coords(coords)
        if camber_bounds is not None:
            c_lo, c_hi = camber_bounds
            if camber < c_lo:
                penalty += 80.0 * (c_lo - camber) ** 2
            if camber > c_hi:
                penalty += 80.0 * (camber - c_hi) ** 2
        if camber_pos_bounds is not None and camber > 0.002:
            cp_lo, cp_hi = camber_pos_bounds
            if camber_pos < cp_lo:
                penalty += 80.0 * (cp_lo - camber_pos) ** 2
            if camber_pos > cp_hi:
                penalty += 80.0 * (camber_pos - cp_hi) ** 2

    # ── self-intersection ──
    if _check_self_intersection(coords):
        penalty += 1000.0

    # ── seed-relative edge-shape locks ──
    le_lock = config.get("le_thickness_lock")
    if le_lock is not None:
        x = np.asarray(le_lock["x"], dtype=float)
        lo = np.asarray(le_lock["lower"], dtype=float)
        hi = np.asarray(le_lock["upper"], dtype=float)
        thickness = get_thickness_at_stations(coords, x)
        below = np.maximum(lo - thickness, 0.0)
        above = np.maximum(thickness - hi, 0.0)
        penalty += 200.0 * float(np.sum(below ** 2 + above ** 2))

    te_lock = config.get("te_thickness_lock")
    if te_lock is not None:
        x = np.asarray(te_lock["x"], dtype=float)
        lo = np.asarray(te_lock["lower"], dtype=float)
        hi = np.asarray(te_lock["upper"], dtype=float)
        thickness = get_thickness_at_stations(coords, x)
        below = np.maximum(lo - thickness, 0.0)
        above = np.maximum(thickness - hi, 0.0)
        penalty += 200.0 * float(np.sum(below ** 2 + above ** 2))

    # ── curvature reversals ──
    reversal_penalty = _curvature_reversal_penalty(coords)
    penalty += reversal_penalty

    # ── trailing-edge wedge angle ──
    te_penalty = _te_wedge_angle_penalty(coords)
    penalty += te_penalty

    return penalty


def _check_self_intersection(coords):
    """
    Quick sanity check: upper surface must stay above lower surface.

    Checks from x = 0.001 to x = 0.999 (200 points) to catch intersections
    near the LE and TE where CST airfoils with extreme weights are most
    likely to self-intersect.
    """
    x = coords[:, 0]
    y = coords[:, 1]
    le_idx = int(np.argmin(x))

    x_upper = x[:le_idx + 1]
    y_upper = y[:le_idx + 1]
    x_lower = x[le_idx:]
    y_lower = y[le_idx:]

    # Extended range (0.001–0.999) with more points to catch LE/TE issues
    x_check = np.linspace(0.001, 0.999, 200)
    try:
        sort_u = np.argsort(x_upper)
        sort_l = np.argsort(x_lower)
        y_up = np.interp(x_check, x_upper[sort_u], y_upper[sort_u])
        y_lo = np.interp(x_check, x_lower[sort_l], y_lower[sort_l])
        return bool(np.any(y_up < y_lo))
    except Exception:
        return False


def _estimate_le_radius(coords):
    """Estimate leading-edge radius via discrete curvature."""
    le_idx = int(np.argmin(coords[:, 0]))
    lo = max(0, le_idx - 5)
    hi = min(len(coords), le_idx + 6)
    region = coords[lo:hi]
    if len(region) < 3:
        return 0.01

    dx = np.gradient(region[:, 0])
    dy = np.gradient(region[:, 1])
    d2x = np.gradient(dx)
    d2y = np.gradient(dy)

    denom = (dx ** 2 + dy ** 2) ** 1.5
    denom = np.where(denom < 1e-30, 1e-30, denom)
    curvature = np.abs(dx * d2y - dy * d2x) / denom
    valid = curvature[curvature < 1e6]

    if len(valid) == 0 or np.max(valid) <= 0:
        return 0.01
    return 1.0 / np.max(valid)


def _compute_surface_curvature(x, y):
    """
    Compute signed curvature along a surface defined by (x, y) arrays.

    Returns curvature array of same length as input (uses np.gradient for
    differentiation, so boundary values are one-sided estimates).
    """
    dx = np.gradient(x)
    dy = np.gradient(y)
    d2x = np.gradient(dx)
    d2y = np.gradient(dy)

    denom = (dx ** 2 + dy ** 2) ** 1.5
    denom = np.where(np.abs(denom) < 1e-30, 1e-30, denom)
    return (dx * d2y - dy * d2x) / denom


def _count_curvature_reversals(kappa):
    """
    Count the number of sign changes in curvature (excluding near-zero
    regions that are just numerical noise).
    """
    # Ignore points with near-zero curvature (flat regions)
    threshold = 0.1 * np.max(np.abs(kappa)) if np.max(np.abs(kappa)) > 0 else 1.0
    signs = np.sign(kappa)
    # Mask out near-zero curvature
    signs[np.abs(kappa) < threshold * 0.05] = 0
    # Remove zeros for reversal counting
    nonzero = signs[signs != 0]
    if len(nonzero) < 2:
        return 0
    return int(np.sum(np.abs(np.diff(nonzero)) > 0))


def _curvature_reversal_penalty(coords):
    """
    Penalise surfaces with too many curvature reversals (wiggles).

    A clean airfoil surface typically has 0–1 curvature reversal.  CST
    parameterisation is inherently smoother than Hicks-Henne, but with
    8 weights it is still possible to produce micro-wiggles near the LE/TE.
    """
    x = coords[:, 0]
    y = coords[:, 1]
    le_idx = int(np.argmin(x))

    # Split into upper and lower surfaces
    x_upper = x[:le_idx + 1]
    y_upper = y[:le_idx + 1]
    x_lower = x[le_idx:]
    y_lower = y[le_idx:]

    penalty = 0.0

    for sx, sy in [(x_upper, y_upper), (x_lower, y_lower)]:
        if len(sx) < 5:
            continue
        kappa = _compute_surface_curvature(sx, sy)
        reversals = _count_curvature_reversals(kappa)
        excess = max(0, reversals - _MAX_CURV_REVERSALS)
        if excess > 0:
            # Graduated penalty: each extra reversal adds cost
            penalty += 20.0 * excess ** 2

    return penalty


def _te_wedge_angle_penalty(coords):
    """
    Penalise trailing edges with an included angle below ``_MIN_TE_WEDGE_DEG``.

    The TE wedge angle is estimated from the slope of the upper and lower
    surfaces near the trailing edge (last ~5% of chord).  Very thin trailing
    edges are fragile, hard to manufacture, and can cause separation.
    """
    x = coords[:, 0]
    y = coords[:, 1]
    le_idx = int(np.argmin(x))

    x_upper = x[:le_idx + 1]
    y_upper = y[:le_idx + 1]
    x_lower = x[le_idx:]
    y_lower = y[le_idx:]

    # Sort so x is ascending
    sort_u = np.argsort(x_upper)
    sort_l = np.argsort(x_lower)
    x_upper, y_upper = x_upper[sort_u], y_upper[sort_u]
    x_lower, y_lower = x_lower[sort_l], y_lower[sort_l]

    # Estimate slope at TE from the last few points (x > 0.90)
    mask_u = x_upper > 0.90
    mask_l = x_lower > 0.90

    if np.sum(mask_u) < 2 or np.sum(mask_l) < 2:
        return 0.0

    # Linear fit to get dy/dx at the TE
    try:
        slope_u = np.polyfit(x_upper[mask_u], y_upper[mask_u], 1)[0]
        slope_l = np.polyfit(x_lower[mask_l], y_lower[mask_l], 1)[0]
    except (np.linalg.LinAlgError, ValueError):
        return 0.0

    # TE included angle = angle between the two surface tangent vectors
    # Upper surface slopes downward toward TE (negative dy/dx for typical foil)
    # Lower surface slopes upward toward TE (positive dy/dx)
    # Wedge half-angle ≈ atan(|slope_upper|) + atan(|slope_lower|)
    angle_upper = np.degrees(np.arctan(slope_u))   # typically negative
    angle_lower = np.degrees(np.arctan(slope_l))   # typically positive
    te_wedge = abs(angle_upper - angle_lower)

    if te_wedge < _MIN_TE_WEDGE_DEG:
        deficit = _MIN_TE_WEDGE_DEG - te_wedge
        return 30.0 * deficit ** 2

    return 0.0
