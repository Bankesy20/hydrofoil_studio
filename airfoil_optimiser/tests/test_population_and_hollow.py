import numpy as np
import sys
from pathlib import Path


def test_popsize_multiplier_math():
    # Mirrors the logic in core/optimizer.py: pop_mult = ceil(pop / ndim)
    def mult(pop, ndim):
        return int(np.ceil(int(pop) / max(int(ndim), 1)))

    assert mult(30, 8) == 4
    assert mult(32, 8) == 4
    assert mult(33, 8) == 5
    assert mult(180, 18) == 10


def test_hollow_offset_guard_does_not_invert_inertias():
    # A very thin "airfoil-like" loop can make naive inward offsets misbehave.
    # We mainly assert the guard prevents negative/NaN results.
    # This repo isn't packaged; add `hydrooptfoil/` to the import path.
    repo_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(repo_root / "hydrooptfoil"))

    from core.section_properties import (  # noqa: E402
        compute_hollow_section_properties,
        compute_section_properties,
    )

    # Simple thin diamond, closed loop (approx airfoil with sharp ends)
    coords = np.array([
        [1.0, 0.0],
        [0.5, 0.003],
        [0.0, 0.0],
        [0.5, -0.003],
    ])

    outer = compute_section_properties(coords, chord_m=1.0)
    hollow = compute_hollow_section_properties(coords, chord_m=1.0, wall_thickness_m=0.004)

    assert np.isfinite(hollow["Ixx"])
    assert np.isfinite(hollow["Iyy"])
    assert np.isfinite(hollow["A"])
    # Hollow section should not exceed solid outer inertias/area
    assert hollow["Ixx"] <= outer["Ixx"] + 1e-18
    assert hollow["Iyy"] <= outer["Iyy"] + 1e-18
    assert hollow["A"] <= outer["A"] + 1e-18


def test_compute_dcm_dcl_polyfit():
    from pathlib import Path
    import sys

    repo_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(repo_root / "hydrooptfoil"))

    from core.objective_wing import _compute_dcm_dcl  # noqa: E402

    cl = np.linspace(-1.5, 1.5, 31)
    true_slope = -0.08
    cm = 0.02 + true_slope * cl
    aero = {"CL": cl, "CM": cm}

    est = _compute_dcm_dcl(aero, cl_lo=-1.0, cl_hi=1.0)
    assert est is not None
    assert abs(est - true_slope) < 1e-12

