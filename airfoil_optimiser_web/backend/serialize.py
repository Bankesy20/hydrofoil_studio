"""Convert optimisation results and numpy structures to JSON-safe data."""

from __future__ import annotations

from typing import Any

import numpy as np


def _as_selig_coords_2d(val: Any) -> list[list[float]] | None:
    """
    Ensure airfoil coordinates are JSON [[x,y], ...] of shape (N, 2).

    Some Aerosandbox / older paths can yield 1D arrays, object arrays, or
    (N*2,)-shaped ravel; JSON round-trips or clients may then get wrong shapes.
    """
    if val is None:
        return None
    arr: np.ndarray = np.asarray(val, dtype=float)
    if arr.size < 4 or not np.isfinite(arr).all():
        return None
    if arr.ndim == 0:
        return None
    if arr.ndim == 1:
        if len(arr) % 2 != 0:
            return None
        arr = arr.reshape(-1, 2)
    elif arr.ndim == 2:
        if arr.shape[0] == 2 and arr.shape[1] != 2 and arr.shape[1] > 2:
            arr = arr.T
        if arr.shape[1] != 2:
            if arr.size % 2 == 0 and arr.size >= 4:
                arr = arr.ravel().reshape(-1, 2)
            else:
                return None
    else:
        return None
    if arr.ndim != 2 or arr.shape[1] != 2 or arr.shape[0] < 2:
        return None
    return arr.tolist()


def _to_jsonable(obj: Any) -> Any:
    if obj is None or isinstance(obj, (bool, str)):
        return obj
    if isinstance(obj, (np.floating, np.integer)):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, dict):
        return {k: _to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_to_jsonable(x) for x in obj]
    return obj


_INTERNAL_CONFIG_KEYS = frozenset(
    {
        "_cancel_cb",
        "_mast_grid",
        "_wing_seed_baselines",
        "_seed_cst",
        "_seed_dcm_dcl",
    }
)


def sanitize_config(cfg: dict[str, Any] | None) -> dict[str, Any] | None:
    if cfg is None:
        return None
    out: dict[str, Any] = {}
    for k, v in cfg.items():
        if k in _INTERNAL_CONFIG_KEYS:
            continue
        if k == "seed_airfoil" and isinstance(v, np.ndarray):
            out[k] = {"kind": "coordinates", "coordinates": v.tolist()}
        else:
            out[k] = _to_jsonable(v)
    return out


def optimization_result_to_json(result: dict[str, Any]) -> dict[str, Any]:
    """Match keys from ``run_optimization`` return value."""
    out: dict[str, Any] = {}
    for key, val in result.items():
        if key == "config":
            out[key] = sanitize_config(val)
            continue
        if key in ("optimized_coords", "seed_coords"):
            fixed = _as_selig_coords_2d(val)
            if fixed is not None:
                out[key] = fixed
            else:
                out[key] = _to_jsonable(val)
            continue
        out[key] = _to_jsonable(val)
    return out
