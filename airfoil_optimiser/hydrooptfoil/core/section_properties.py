"""
Geometric section property computation from airfoil coordinates.

Uses the shoelace-formula approach (Green's theorem) to compute area,
centroid, second moments of area, and product of inertia for arbitrary
closed polygons. Preprocessing removes consecutive duplicates and ensures
CCW winding for robustness to messy .dat files.
"""

import numpy as np


def _remove_consecutive_duplicates(coords, tol=1e-10):
    """Remove consecutive duplicate points. Returns (cleaned_coords, n_removed)."""
    if coords.shape[0] < 2:
        return coords, 0
    d = np.linalg.norm(np.diff(coords, axis=0), axis=1)
    keep = np.ones(coords.shape[0], dtype=bool)
    keep[1:] = d > tol
    cleaned = coords[keep]
    return cleaned, int(coords.shape[0] - cleaned.shape[0])


def _signed_area(coords):
    """Shoelace signed area (positive = CCW)."""
    x, y = coords[:, 0], coords[:, 1]
    return 0.5 * np.sum(x[:-1] * y[1:] - x[1:] * y[:-1])


def _ensure_ccw(coords):
    """Ensure polygon is CCW (positive signed area). Returns (coords, flipped)."""
    A = _signed_area(coords)
    if A < 0:
        return coords[::-1].copy(), True
    return coords, False


def _compute_perimeter(coords):
    """Perimeter of closed polygon (segment lengths)."""
    if coords.shape[0] < 2:
        return 0.0
    closed = coords
    if not np.allclose(closed[0], closed[-1], atol=0.0, rtol=0.0):
        closed = np.vstack([coords, coords[0]])
    d = np.diff(closed, axis=0)
    return float(np.sum(np.sqrt(np.sum(d ** 2, axis=1))))


def _preprocess_and_close(coords_norm, chord_m):
    """
    Scale to physical units, remove consecutive duplicates, close polygon,
    ensure CCW. Returns (x, y) as 1D arrays for the closed CCW polygon.
    """
    coords = coords_norm.copy()
    coords[:, 0] *= chord_m
    coords[:, 1] *= chord_m
    coords, _ = _remove_consecutive_duplicates(coords, tol=1e-10)
    if coords.shape[0] < 3:
        return coords[:, 0], coords[:, 1]
    if not np.allclose(coords[0], coords[-1], atol=0.0, rtol=0.0):
        coords = np.vstack([coords, coords[0]])
    coords, _ = _ensure_ccw(coords)
    return coords[:, 0], coords[:, 1]


def compute_section_properties(coords, chord_m):
    """
    Compute geometric section properties from normalised airfoil coordinates.

    Preprocessing: remove consecutive duplicate points (tol=1e-10), ensure
    polygon is closed and CCW (positive signed area).

    Parameters
    ----------
    coords : ndarray, shape (N, 2) — normalised (chord = 1.0)
    chord_m : float — physical chord in metres

    Returns
    -------
    dict with keys: Ixx, Iyy, Ixy, J_polar, A, centroid_x, centroid_y
    """
    x, y = _preprocess_and_close(coords, chord_m)
    if len(x) < 3:
        return {"Ixx": 0.0, "Iyy": 0.0, "Ixy": 0.0, "J_polar": 0.0, "A": 0.0,
                "centroid_x": 0.0, "centroid_y": 0.0}

    xi, xip1 = x[:-1], x[1:]
    yi, yip1 = y[:-1], y[1:]
    cross = xi * yip1 - xip1 * yi

    A_signed = 0.5 * np.sum(cross)
    A = abs(A_signed)

    if A < 1e-20:
        return {"Ixx": 0.0, "Iyy": 0.0, "Ixy": 0.0, "J_polar": 0.0, "A": 0.0,
                "centroid_x": 0.0, "centroid_y": 0.0}

    # Centroid
    cx = np.sum((xi + xip1) * cross) / (6.0 * A_signed)
    cy = np.sum((yi + yip1) * cross) / (6.0 * A_signed)

    # Second moments about origin (Green's theorem)
    Ixx_o = np.sum((yi ** 2 + yi * yip1 + yip1 ** 2) * cross) / 12.0
    Iyy_o = np.sum((xi ** 2 + xi * xip1 + xip1 ** 2) * cross) / 12.0
    Ixy_o = np.sum((xi * yip1 + 2 * xi * yi + 2 * xip1 * yip1 + xip1 * yi) * cross) / 24.0

    # Parallel-axis theorem → centroidal axes (use A_signed per reference)
    Ixx = Ixx_o - A_signed * (cy ** 2)
    Iyy = Iyy_o - A_signed * (cx ** 2)
    Ixy = Ixy_o - A_signed * (cx * cy)

    Ixx = max(abs(Ixx), 0.0)
    Iyy = max(abs(Iyy), 0.0)

    # NOTE: J_polar = Ixx + Iyy is the polar second moment, NOT Saint-Venant
    # torsion constant. For hollow sections use J_bredt from
    # compute_hollow_section_properties() instead.
    J_polar = Ixx + Iyy

    return {
        "Ixx": Ixx,
        "Iyy": Iyy,
        "Ixy": Ixy,
        "J_polar": J_polar,
        "A": A,
        "centroid_x": cx,
        "centroid_y": cy,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Hollow (shell) section
# ──────────────────────────────────────────────────────────────────────────────

def compute_hollow_section_properties(coords, chord_m, wall_thickness_m):
    """
    Section properties for a hollow (shell) cross-section.

    Inner boundary: offset each vertex inward by wall_thickness_m. Bending/area
    use outer minus inner. Torsion uses Bredt–Batho with **midline** area and
    perimeter (Megson/Bruhn): offset inward by half wall thickness to get
    midline, then J_bredt = 4 * A_m² * t / s.
    """
    outer = compute_section_properties(coords, chord_m)

    inner_coords = _offset_airfoil_inward(coords, wall_thickness_m / chord_m)
    inner = compute_section_properties(inner_coords, chord_m)

    # Guard against fragile inward offsets producing invalid inner polygons
    # (e.g., self-intersection / negative area), which can silently flip the
    # inertias. In that case, make stiffness effectively "fail" by collapsing
    # the usable section properties toward zero.
    if (inner.get("A", 0.0) <= 0.0
            or inner["A"] >= 0.995 * max(outer.get("A", 0.0), 1e-30)
            or inner["Ixx"] >= outer["Ixx"]
            or inner.get("Iyy", inner["Ixx"]) >= outer.get("Iyy", outer["Ixx"])):
        inner = {
            "Ixx": outer["Ixx"],
            "Iyy": outer.get("Iyy", outer["Ixx"]),
            "Ixy": outer.get("Ixy", 0.0),
            "A": outer.get("A", 0.0),
        }

    Ixx = max(outer["Ixx"] - inner["Ixx"], 0.0)
    Iyy = max(outer["Iyy"] - inner.get("Iyy", inner["Ixx"]), 0.0)
    Ixy = outer["Ixy"] - inner["Ixy"]
    A = max(outer["A"] - inner["A"], 0.0)

    # Bredt–Batho: use midline (offset inward by t/2), then J = 4*A_m²*t/s
    half_t_norm = 0.5 * (wall_thickness_m / chord_m)
    midline_coords = _offset_airfoil_inward(coords, half_t_norm)
    mx, my = _preprocess_and_close(midline_coords, chord_m)
    if len(mx) >= 3:
        closed_m = np.column_stack([mx, my])
        A_m = abs(_signed_area(closed_m))
        s = _compute_perimeter(closed_m)
        J_bredt = (4.0 * A_m ** 2 * wall_thickness_m / s if s > 0 else 0.0)
    else:
        J_bredt = 0.0
        A_m = 0.0

    return {
        "Ixx": Ixx,
        "Iyy": Iyy,
        "Ixy": Ixy,
        "J_polar": Ixx + Iyy,
        "J_bredt": J_bredt,
        "A": A,
        "A_enclosed": inner["A"],
        "centroid_x": outer["centroid_x"],
        "centroid_y": outer["centroid_y"],
    }


def _offset_airfoil_inward(coords, offset_normalised):
    """Offset every vertex inward by *offset_normalised* along its averaged normal."""
    n = len(coords)
    centroid = np.mean(coords, axis=0)
    inner = np.empty_like(coords)

    for i in range(n):
        ip1 = (i + 1) % n
        im1 = (i - 1) % n

        dx = coords[ip1, 0] - coords[im1, 0]
        dy = coords[ip1, 1] - coords[im1, 1]
        length = np.sqrt(dx ** 2 + dy ** 2)

        if length < 1e-12:
            inner[i] = coords[i]
            continue

        # Outward-pointing normal candidate
        nx = dy / length
        ny = -dx / length

        # Flip so it points inward (toward centroid)
        to_centroid = centroid - coords[i]
        if np.dot([nx, ny], to_centroid) < 0:
            nx, ny = -nx, -ny

        inner[i, 0] = coords[i, 0] + offset_normalised * nx
        inner[i, 1] = coords[i, 1] + offset_normalised * ny

    return inner
