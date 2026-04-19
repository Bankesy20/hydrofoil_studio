"""
HydroOptFoil FastAPI backend — wraps ``airfoil_optimiser/hydrooptfoil``.
"""

from __future__ import annotations

import inspect
import numpy as np
import asyncio
import json
import threading
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from hydro_path import ensure_hydrooptfoil_path

ensure_hydrooptfoil_path()

from jobs import JobRegistry, run_optimize_thread  # noqa: E402
from schemas import (  # noqa: E402
    DatParseRequest,
    EdgeLocksRequest,
    ExportRequest,
    FlowRequest,
    OptimizationConfigIn,
    SeedAnalyzeRequest,
)
from serialize import optimization_result_to_json, _to_jsonable  # noqa: E402

from core.cst_geometry import (  # noqa: E402
    N_CST,
    airfoil_to_cst,
    cst_to_coordinates,  # also used by /api/export when only CST is given
    dat_string_from_coords,
    get_camber_from_coords,
    get_region_mean_thickness,
    get_tc_from_coords,
    get_thickness_at_stations,
    repanel_cosine,
)
from core.fluid_properties import water_kinematic_viscosity  # noqa: E402
from core.optimizer import run_optimization  # noqa: E402
from core.section_properties import compute_section_properties  # noqa: E402
from core.aero_engine import evaluate_polar_sweep_detailed  # noqa: E402
from presets import PRESETS  # noqa: E402
from ui.airfoil_library import (  # noqa: E402
    AIRFOIL_LIBRARY,
    get_airfoil_coordinates,
    library_choices_for_config,
)
from ui.airfoil_library import _parse_dat  # noqa: E402

app = FastAPI(title="HydroOptFoil API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ],
    # Vite may pick 5175+ when default ports are busy (must match EventSource/fetch from UI).
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1):\d+$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

JOBS = JobRegistry()


def _matrix_shapes_from_detailed(dk: dict) -> dict[str, list[int]]:
    """2-D numpy field shapes in row-major (JSON) order: (n_stations, n_alpha)."""
    out: dict[str, list[int]] = {}
    for k in ("cp_upper", "cp_lower", "dcp_upper", "dcp_lower"):
        v = dk.get(k)
        if isinstance(v, np.ndarray) and v.ndim == 2:
            out[k] = [int(v.shape[0]), int(v.shape[1])]
    return out


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/meta")
def meta() -> dict[str, Any]:
    presets_out = {k: dict(v) for k, v in PRESETS.items()}
    return {
        "presets": presets_out,
        "airfoil_library_keys": list(AIRFOIL_LIBRARY.keys()),
        "library_by_component": {
            "mast": library_choices_for_config("mast"),
            "front_wing": library_choices_for_config("front_wing"),
        },
    }


@app.post("/api/flow")
def flow_calc(req: FlowRequest) -> dict[str, Any]:
    if req.speed_unit == "m/s":
        v_ms = float(req.speed)
    elif req.speed_unit == "km/h":
        v_ms = float(req.speed) / 3.6
    elif req.speed_unit == "knots":
        v_ms = float(req.speed) * 0.514444
    else:
        v_ms = float(req.speed) * 0.44704

    chord_m = float(req.chord_mm) / 1000.0
    nu = water_kinematic_viscosity(req.water_temp_c)
    if req.salt_water:
        nu *= 1.05

    re = (v_ms * chord_m) / max(nu, 1e-12)
    rho = 998.0
    q = 0.5 * rho * (v_ms**2)

    if req.lift_mode == "mass_kg":
        lift_n = float(req.mass_kg) * 9.80665
    else:
        lift_n = float(req.lift_n)
    lift_n *= float(req.lift_share_pct) / 100.0
    area_m2 = float(req.area_cm2) * 1e-4
    cl_req = float(lift_n) / max(q * area_m2, 1e-12)

    import numpy as np

    speeds_ms = np.array([6.0, 8.0, 10.0, 12.0, 14.0], dtype=float)
    chords_mm = np.array([80, 120, 160, 200], dtype=float)
    rows = []
    for cmm in chords_mm:
        c_m = cmm / 1000.0
        for v in speeds_ms:
            rows.append(
                {
                    "speed_m_s": float(v),
                    "chord_mm": int(cmm),
                    "re_k": int(round((v * c_m) / max(nu, 1e-12) / 1e3)),
                }
            )

    return {
        "v_ms": v_ms,
        "re": re,
        "re_label": (
            f"{re/1e6:.2f} M"
            if re >= 1e6
            else (f"{re/1e3:.0f} k" if re >= 1e3 else f"{re:.0f}")
        ),
        "dynamic_pressure_pa": q,
        "nu": nu,
        "required_cl": cl_req,
        "speed_conversions": {
            "m_s": v_ms,
            "km_h": v_ms * 3.6,
            "knots": v_ms / 0.514444,
            "mph": v_ms / 0.44704,
        },
        "re_table": rows,
    }


@app.post("/api/geometry/edge_locks")
def geometry_edge_locks(req: EdgeLocksRequest) -> dict[str, Any]:
    import numpy as np

    coords = get_airfoil_coordinates(req.seed_airfoil.to_runtime())
    le_lock_x = np.linspace(0.005, 0.05, 9)
    te_lock_x = np.linspace(0.85, 1.0, 13)
    seed_le_profile = get_thickness_at_stations(coords, le_lock_x)
    seed_te_profile = get_thickness_at_stations(coords, te_lock_x)
    seed_le_band_pct = round(get_region_mean_thickness(coords, 0.0, 0.05) * 100, 2)
    seed_te_band_pct = round(get_region_mean_thickness(coords, 0.85, 1.0) * 100, 2)

    le_thickness_lock = None
    if req.le_mode == "Absolute (± % chord)" and req.le_tol_pct > 0:
        le_tol = req.le_tol_pct / 100.0
        le_thickness_lock = {
            "x": le_lock_x.tolist(),
            "lower": np.maximum(seed_le_profile - le_tol, 0.0).tolist(),
            "upper": (seed_le_profile + le_tol).tolist(),
        }
    elif req.le_mode == "Relative (± % of seed)" and req.le_tol_rel_pct > 0:
        frac = req.le_tol_rel_pct / 100.0
        lo = np.maximum(seed_le_profile * (1.0 - frac), 0.0)
        hi = seed_le_profile * (1.0 + frac)
        le_thickness_lock = {
            "x": le_lock_x.tolist(),
            "lower": lo.tolist(),
            "upper": hi.tolist(),
        }

    te_thickness_lock = None
    if req.te_tol_pct > 0:
        te_tol = req.te_tol_pct / 100.0
        te_thickness_lock = {
            "x": te_lock_x.tolist(),
            "lower": np.maximum(seed_te_profile - te_tol, 0.0).tolist(),
            "upper": (seed_te_profile + te_tol).tolist(),
        }

    return {
        "le_thickness_lock": le_thickness_lock,
        "te_thickness_lock": te_thickness_lock,
        "seed_le_band_pct": seed_le_band_pct,
        "seed_te_band_pct": seed_te_band_pct,
    }


@app.post("/api/dat/parse")
def parse_dat(body: DatParseRequest) -> dict[str, Any]:
    try:
        coords = _parse_dat(body.content)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"coordinates": coords.tolist()}


def _seed_cst_from_coords(
    coords: Any, component_type: str, te_thickness: float | None
) -> tuple[list[float], list[float], float, float]:
    seed_upper, seed_lower, seed_le, seed_te = airfoil_to_cst(coords, N_CST)
    if component_type == "mast":
        fixed_te = float(te_thickness or 0.0)
        # Keep the uploaded/edited lower surface for seed analysis polars.
        # Mirroring lower from upper hides real upper/lower differences in Cp.
        seed_te = fixed_te
    return seed_upper, seed_lower, seed_le, seed_te


@app.post("/api/seed/analyze")
def seed_analyze(req: SeedAnalyzeRequest) -> dict[str, Any]:
    import numpy as np

    seed = req.seed_airfoil.to_runtime()
    coords = get_airfoil_coordinates(seed)
    chord_m = req.chord_mm / 1000.0

    tc, tc_pos = get_tc_from_coords(coords)
    camber, camber_pos = get_camber_from_coords(coords)
    sec = compute_section_properties(coords, chord_m)

    out: dict[str, Any] = {
        "primary_label": seed if isinstance(seed, str) else "uploaded",
        "geometry": {
            "tc": float(tc),
            "tc_pos": float(tc_pos),
            "camber": float(camber),
            "camber_pos": float(camber_pos),
            "chord_mm": req.chord_mm,
        },
        "section": _to_jsonable(sec),
        "coordinates": coords.tolist(),
    }

    compare_block = None
    if req.compare is not None:
        b = req.compare.to_runtime()
        coords_b = get_airfoil_coordinates(b)
        tc_b, tc_pos_b = get_tc_from_coords(coords_b)
        camber_b, camber_pos_b = get_camber_from_coords(coords_b)
        sec_b = compute_section_properties(coords_b, chord_m)
        label_b = req.compare.legend or (
            req.compare.library_name or "compare"
        )
        compare_block = {
            "label": label_b,
            "coordinates": coords_b.tolist(),
            "geometry": {
                "tc": float(tc_b),
                "tc_pos": float(tc_pos_b),
                "camber": float(camber_b),
                "camber_pos": float(camber_pos_b),
                "chord_mm": req.chord_mm,
            },
            "section": _to_jsonable(sec_b),
        }
        out["compare"] = compare_block

    if not req.compute_polars or req.polar is None:
        return out

    su, sl, sle, ste = _seed_cst_from_coords(
        coords, req.component_type, req.te_thickness
    )
    bu = bl = ble = bte = None
    if compare_block is not None:
        bu, bl, ble, bte = _seed_cst_from_coords(
            np.asarray(compare_block["coordinates"]),
            req.component_type,
            req.te_thickness,
        )

    p = req.polar
    by_re: dict[str, Any] = {}
    by_re_b: dict[str, Any] | None = None
    ref_alphas = None
    for re_val in p.re_list:
        detailed_k, alphas_k = evaluate_polar_sweep_detailed(
            su,
            sl,
            sle,
            ste,
            Re=float(re_val),
            n_crit=float(p.ncrit),
            alpha_range=(float(p.alpha_start), float(p.alpha_end), float(p.alpha_step)),
            model_size=str(p.model_size),
        )
        rkey = str(float(re_val))
        by_re[rkey] = {
            "detailed": _to_jsonable(detailed_k),
            "alphas": alphas_k.tolist(),
            "matrix_shapes": _matrix_shapes_from_detailed(detailed_k),
        }
        if ref_alphas is None:
            ref_alphas = alphas_k.tolist()
        if compare_block is not None and bu is not None:
            if by_re_b is None:
                by_re_b = {}
            db, ab = evaluate_polar_sweep_detailed(
                bu,
                bl,
                ble,
                bte,
                Re=float(re_val),
                n_crit=float(p.ncrit),
                alpha_range=(float(p.alpha_start), float(p.alpha_end), float(p.alpha_step)),
                model_size=str(p.model_size),
            )
            by_re_b[str(float(re_val))] = {
                "detailed": _to_jsonable(db),
                "alphas": ab.tolist(),
                "matrix_shapes": _matrix_shapes_from_detailed(db),
            }

    out["polars"] = {
        "re_list": [float(x) for x in p.re_list],
        "ncrit": p.ncrit,
        "model_size": p.model_size,
        "alphas": ref_alphas,
        "by_re": by_re,
        "by_re_b": by_re_b,
    }
    return out


class OptimizeJobCreateResponse(BaseModel):
    job_id: str


@app.post("/api/optimize/jobs", response_model=OptimizeJobCreateResponse)
def create_optimize_job(cfg: OptimizationConfigIn) -> OptimizeJobCreateResponse:
    job = JOBS.create()
    runtime = cfg.to_runtime_dict()

    t = threading.Thread(
        target=run_optimize_thread,
        args=(job, runtime, run_optimization, optimization_result_to_json),
        daemon=True,
    )
    t.start()
    return OptimizeJobCreateResponse(job_id=job.job_id)


@app.post("/api/optimize/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict[str, Any]:
    ok = JOBS.cancel(job_id)
    return {"cancelled": ok}


@app.get("/api/optimize/jobs/{job_id}/result")
def job_result(job_id: str) -> dict[str, Any]:
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="unknown job_id")
    if job.status == "running" or job.status == "pending":
        raise HTTPException(status_code=409, detail="job not finished")
    if job.status == "failed":
        raise HTTPException(status_code=500, detail=job.error or "failed")
    if job.status == "cancelled":
        return {"status": "cancelled", "result": None}
    return {"status": "completed", "result": job.result}


@app.get("/api/optimize/jobs/{job_id}/events")
async def job_events(job_id: str) -> StreamingResponse:
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="unknown job_id")

    async def gen() -> AsyncIterator[str]:
        last_idx = 0
        while True:
            chunk, new_len = job.drain_events(last_idx)
            last_idx = new_len
            for ev in chunk:
                yield f"data: {json.dumps(ev)}\n\n"
            with job.lock:
                st = job.status
            if st in ("completed", "failed", "cancelled"):
                return
            await asyncio.sleep(0.15)

    return StreamingResponse(gen(), media_type="text/event-stream")


def _export_coords_array(body: ExportRequest) -> np.ndarray:
    """2-D N×2 array in Selig order, from explicit coordinates and/or Kulfan CST."""
    if body.coordinates and len(body.coordinates) >= 3:
        arr = np.asarray(body.coordinates, dtype=float)
        if arr.ndim == 1 and len(arr) % 2 == 0:
            arr = arr.reshape(-1, 2)
        if arr.ndim != 2 or arr.shape[1] != 2:
            raise HTTPException(
                status_code=422, detail="coordinates must be a list of [x, y] pairs (or flat x,y,…).",
            )
        if not np.isfinite(arr).all():
            raise HTTPException(
                status_code=422, detail="coordinates must be finite; results may be corrupt.",
            )
        return arr
    if body.cst is not None:
        c = body.cst
        return cst_to_coordinates(
            c.upper, c.lower, le_weight=c.le, te_thickness=c.te
        )
    raise HTTPException(status_code=422, detail="no coordinates or cst available")


@app.post("/api/export")
def export_files(body: ExportRequest) -> dict[str, Any]:
    import numpy as np
    import pandas as pd

    coords = _export_coords_array(body)
    export_coords = repanel_cosine(
        coords, n_points=body.export_npts, le_bunch=body.le_bunch
    )
    dat_kw: dict[str, Any] = {}
    if body.dat_header_comments is not None and "comment_lines" in inspect.signature(
        dat_string_from_coords
    ).parameters:
        dat_kw["comment_lines"] = body.dat_header_comments
    dat = dat_string_from_coords(export_coords, body.export_name, **dat_kw)

    polar_csv = None
    if body.polar and body.alphas:
        df = pd.DataFrame(
            {
                "alpha_deg": body.alphas,
                "CL": body.polar.get("CL", []),
                "CD": body.polar.get("CD", []),
                "CM": body.polar.get("CM", []),
            }
        )
        polar_csv = df.to_csv(index=False)

    summary_txt = None
    if body.summary_lines:
        summary_txt = "\n".join(body.summary_lines)

    return {
        "dat": dat,
        "dat_filename": f"{body.export_name}.dat",
        "polar_csv": polar_csv,
        "polar_filename": f"{body.export_name}_polar.csv",
        "summary_txt": summary_txt,
        "summary_filename": f"{body.export_name}_summary.txt",
        "n_points": int(len(export_coords)),
    }
