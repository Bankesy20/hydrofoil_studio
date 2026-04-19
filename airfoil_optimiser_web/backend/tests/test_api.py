"""Smoke tests for HydroOptFoil API (requires hydrooptfoil deps)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

# Ensure repo layout: tests live in backend/tests, hydrooptfoil at ../../airfoil_optimiser/hydrooptfoil
_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))

from hydro_path import ensure_hydrooptfoil_path  # noqa: E402

ensure_hydrooptfoil_path()

from server import app  # noqa: E402


@pytest.mark.asyncio
async def test_health():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_meta_presets():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/meta")
    assert r.status_code == 200
    data = r.json()
    assert "presets" in data
    assert "mast_wing_allround" in data["presets"]


@pytest.mark.asyncio
async def test_seed_analyze_geometry_only():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post(
            "/api/seed/analyze",
            json={
                "component_type": "mast",
                "chord_mm": 120,
                "te_thickness": 0.005,
                "seed_airfoil": {"kind": "library", "library_name": "NACA 0012"},
                "compute_polars": False,
            },
        )
    assert r.status_code == 200
    body = r.json()
    assert "coordinates" in body
    assert len(body["coordinates"]) > 20


@pytest.mark.asyncio
async def test_seed_analyze_compare_coordinates():
    """Compare airfoil as JSON coordinates must not hit file-read path (regression)."""
    cmp = [
        [1.0, 0.0],
        [0.85, 0.012],
        [0.7, 0.018],
        [0.5, 0.02],
        [0.3, 0.016],
        [0.1, 0.008],
        [0.0, 0.0],
        [0.1, -0.008],
        [0.3, -0.016],
        [0.5, -0.02],
        [0.7, -0.018],
        [0.85, -0.012],
    ]
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post(
            "/api/seed/analyze",
            json={
                "component_type": "mast",
                "chord_mm": 120,
                "te_thickness": 0.005,
                "seed_airfoil": {"kind": "library", "library_name": "NACA 0012"},
                "compare": {"kind": "coordinates", "coordinates": cmp, "legend": "upload"},
                "compute_polars": False,
            },
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "compare" in body
    assert len(body["compare"]["coordinates"]) >= 10


@pytest.mark.asyncio
async def test_seed_analyze_polars_cp_shape():
    """API polars: Cp = 1−(u/v∞)², shape (32, n_α); dCp (31, n_α); client gets matrix_shapes for indexing."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post(
            "/api/seed/analyze",
            json={
                "component_type": "mast",
                "chord_mm": 120,
                "te_thickness": 0.005,
                "seed_airfoil": {"kind": "library", "library_name": "NACA 0012"},
                "compute_polars": True,
                "polar": {
                    "re_list": [1e6],
                    "ncrit": 7,
                    "model_size": "small",
                    "alpha_start": -1,
                    "alpha_end": 1,
                    "alpha_step": 1.0,
                },
            },
        )
    assert r.status_code == 200, r.text
    p = r.json()["polars"]
    re_keys = list(p["by_re"].keys())
    assert re_keys, "at least one Re"
    b = p["by_re"][re_keys[0]]
    d = b["detailed"]
    ms = b.get("matrix_shapes", {})
    cp = d["cp_upper"]
    n_alpha = len(p.get("alphas", []))
    assert n_alpha == len(d["CL"])
    assert len(cp) == 32, "32 BL stations (NeuralFoil) per aero_engine"
    assert len(cp[0]) == n_alpha
    if ms:
        assert ms.get("cp_upper") == [32, n_alpha]
        assert ms.get("dcp_upper") == [31, n_alpha]
    dcp = d["dcp_upper"]
    assert len(dcp) == 31 and len(dcp[0]) == n_alpha
    # first column: typical incompressible Cp from NeuralFoil edge velocity
    col0 = [row[0] for row in cp]
    assert all(-3.0 < c < 1.5 for c in col0), f"sanity Cp range, got {col0[:3]}…"

    # x_cp must equal NeuralFoil's published BL station x/c (`nf.bl_x_points`),
    # i.e. midpoints of 32 equal chord cells: x/c = (2i+1)/64.
    import numpy as np
    import neuralfoil as nf

    x_cp = np.asarray(d["x_cp"], dtype=float)
    expected = np.asarray(nf.bl_x_points, dtype=float)
    assert x_cp.shape == (32,), f"x_cp shape: {x_cp.shape}"
    assert np.allclose(x_cp, expected), (
        "x_cp must match nf.bl_x_points (midpoints (2i+1)/64), not linspace(0,1,32). "
        f"got first/last {x_cp[0]:.6f}/{x_cp[-1]:.6f}, expected {expected[0]:.6f}/{expected[-1]:.6f}"
    )
    assert abs(x_cp[0] - 1 / 64) < 1e-12 and abs(x_cp[-1] - 63 / 64) < 1e-12


@pytest.mark.asyncio
async def test_optimize_job_short_mast():
    """Very small DE run — may take ~10–60s depending on CPU."""
    transport = ASGITransport(app=app)
    payload = {
        "component_type": "mast",
        "seed_airfoil": {"kind": "library", "library_name": "NACA 0012"},
        "chord_mm": 120,
        "min_tc": 0.1,
        "max_tc": 0.14,
        "max_tc_pos_bounds": None,
        "max_camber_bounds": None,
        "max_camber_pos_bounds": None,
        "le_thickness_lock": None,
        "te_thickness_lock": None,
        "n_crit": 7.0,
        "nu": 1.004e-6,
        "w_smoothness": 0.0,
        "w_pressure_recovery": 0.0,
        "cst_bound_range": 0.25,
        "pop_size": 16,
        "max_iter": 10,
        "random_seed": 1,
        "final_high_fidelity": False,
        "final_high_fidelity_top_n": 3,
        "optim_model_size": "medium",
        "speeds": [8.0, 9.0],
        "Re_values": [800000.0, 900000.0],
        "max_aoa": 2.0,
        "n_aoa": 2,
        "cpmin_limit": None,
        "w_cm": 0.0,
        "cd_regression_pct": 20.0,
        "cm_regression_abs": 0.01,
        "te_thickness": 0.005,
    }
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post("/api/optimize/jobs", json=payload)
    assert r.status_code == 200
    job_id = r.json()["job_id"]
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        for _ in range(600):
            res = await client.get(f"/api/optimize/jobs/{job_id}/result")
            if res.status_code == 200:
                out = res.json()
                assert out["status"] == "completed"
                assert out["result"]["best_objective"] is not None
                return
            if res.status_code == 500:
                pytest.fail(res.text)
            import asyncio

            await asyncio.sleep(0.5)
    pytest.fail("job did not complete in time")
