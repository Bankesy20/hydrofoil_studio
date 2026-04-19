"""Resolve path to ``airfoil_optimiser/hydrooptfoil`` and prepend to ``sys.path``."""

from __future__ import annotations

import sys
from pathlib import Path


def ensure_hydrooptfoil_path() -> Path:
    """
    ``backend/server.py`` lives at ``<repo>/airfoil_optimiser_web/backend/server.py``.

    HydroOptFoil package root is ``<repo>/airfoil_optimiser/hydrooptfoil``.
    """
    here = Path(__file__).resolve()
    repo_root = here.parents[2]
    hydro = repo_root / "airfoil_optimiser" / "hydrooptfoil"
    if not hydro.is_dir():
        raise RuntimeError(f"HydroOptFoil package not found at {hydro}")
    p = str(hydro)
    if p not in sys.path:
        sys.path.insert(0, p)
    return hydro
