"""Pydantic request/response models for the HydroOptFoil API."""

from __future__ import annotations

from typing import Any, Literal

import numpy as np
from pydantic import BaseModel, Field, field_validator, model_validator


class SeedAirfoilIn(BaseModel):
    kind: Literal["library", "coordinates"]
    library_name: str | None = None
    coordinates: list[list[float]] | None = None

    @model_validator(mode="after")
    def _check(self) -> SeedAirfoilIn:
        if self.kind == "library":
            if not self.library_name:
                raise ValueError("library_name required when kind=library")
        else:
            if not self.coordinates or len(self.coordinates) < 10:
                raise ValueError("coordinates must have at least 10 points")
        return self

    def to_runtime(self) -> str | np.ndarray:
        if self.kind == "library":
            return self.library_name  # type: ignore[return-value]
        return np.asarray(self.coordinates, dtype=float)


class EdgeThicknessLockIn(BaseModel):
    x: list[float]
    lower: list[float]
    upper: list[float]


class OperatingPointIn(BaseModel):
    Re: float
    target_cl: float
    objective: Literal["min_cd", "max_cl_cd", "max_cl"]
    weight: float


class StiffnessIn(BaseModel):
    section_type: Literal["solid", "hollow"]
    wall_thickness_m: float | None = None
    tolerance_pct: float = 10.0
    one_sided: bool = True
    w_bending: float = 0.5
    w_torsion: float = 0.5


class OptimizationConfigIn(BaseModel):
    """Mirrors the dict assembled in ``ui/sidebar.py``."""

    component_type: Literal["mast", "front_wing"]
    seed_airfoil: SeedAirfoilIn
    chord_mm: float = Field(ge=20, le=500)
    min_tc: float = Field(ge=0.05, le=0.25, description="min t/c as fraction")
    max_tc: float = Field(ge=0.05, le=0.25, description="max t/c as fraction")
    max_tc_pos_bounds: tuple[float, float] | None = None
    max_camber_bounds: tuple[float, float] | None = None
    max_camber_pos_bounds: tuple[float, float] | None = None
    le_thickness_lock: EdgeThicknessLockIn | dict[str, Any] | None = None
    te_thickness_lock: EdgeThicknessLockIn | dict[str, Any] | None = None
    n_crit: float | list[float]
    nu: float = Field(gt=0, description="kinematic viscosity m^2/s")
    w_smoothness: float = 0.0
    w_pressure_recovery: float = 0.0
    cst_bound_range: float = 0.25
    pop_size: int = Field(ge=8, le=400)
    max_iter: int = Field(ge=10, le=2000)
    random_seed: int = 42
    final_high_fidelity: bool = True
    final_high_fidelity_top_n: int = Field(ge=1, le=30, default=10)
    optim_model_size: Literal["tiny", "small", "medium", "large", "xlarge"] = "medium"

    # Mast-only (optional when front_wing)
    speeds: list[float] | None = None
    Re_values: list[float] | None = None
    max_aoa: float | None = None
    n_aoa: int | None = None
    cpmin_limit: float | None = None
    w_cm: float = 0.0
    cd_regression_pct: float = 5.0
    cm_regression_abs: float = 0.001
    te_thickness: float | None = Field(
        default=None, description="mast fixed TE thickness as chord fraction"
    )

    # Wing-only
    operating_points: list[OperatingPointIn] | None = None
    cm_limit: float | None = None
    cm_limit_alpha: float = 0.0
    dcm_dcl_limit: float | None = None
    dcm_dcl_cl_range: tuple[float, float] = (-1.0, 1.0)
    min_te_thickness: float | None = None
    max_te_thickness: float | None = None

    stiffness: StiffnessIn | None = None

    @model_validator(mode="after")
    def _branch(self) -> OptimizationConfigIn:
        if self.min_tc > self.max_tc:
            raise ValueError("min_tc must be <= max_tc")
        if self.component_type == "mast":
            if (self.Re_values is None or len(self.Re_values) < 1) and (
                self.speeds is None or len(self.speeds) < 1
            ):
                raise ValueError("mast requires Re_values and/or speeds")
            if self.max_aoa is None or self.n_aoa is None:
                raise ValueError("mast requires max_aoa and n_aoa")
            if self.te_thickness is None:
                raise ValueError("mast requires te_thickness (chord fraction)")
        else:
            if not self.operating_points:
                raise ValueError("front_wing requires operating_points")
            if self.min_te_thickness is None or self.max_te_thickness is None:
                raise ValueError("front_wing requires min_te_thickness and max_te_thickness")
        return self

    def to_runtime_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "component_type": self.component_type,
            "seed_airfoil": self.seed_airfoil.to_runtime(),
            "chord_m": self.chord_mm / 1000.0,
            "chord_mm": self.chord_mm,
            "min_tc": self.min_tc,
            "max_tc": self.max_tc,
            "max_tc_pos_bounds": self.max_tc_pos_bounds,
            "max_camber_bounds": self.max_camber_bounds,
            "max_camber_pos_bounds": self.max_camber_pos_bounds,
            "le_thickness_lock": self._lock_dict(self.le_thickness_lock),
            "te_thickness_lock": self._lock_dict(self.te_thickness_lock),
            "n_crit": self.n_crit,
            "nu": self.nu,
            "w_smoothness": self.w_smoothness,
            "w_pressure_recovery": self.w_pressure_recovery,
            "cst_bound_range": self.cst_bound_range,
            "pop_size": self.pop_size,
            "max_iter": self.max_iter,
            "random_seed": self.random_seed,
            "final_high_fidelity": self.final_high_fidelity,
            "final_high_fidelity_top_n": self.final_high_fidelity_top_n,
            "optim_model_size": self.optim_model_size,
        }
        if self.component_type == "mast":
            chord_m = self.chord_mm / 1000.0
            re_list = list(self.Re_values or [])
            sp_list = list(self.speeds or [])
            if not sp_list and re_list:
                sp_list = [float(r) * self.nu / max(chord_m, 1e-12) for r in re_list]
            if not re_list and sp_list:
                re_list = [float(s) * chord_m / max(self.nu, 1e-12) for s in sp_list]
            d.update(
                {
                    "speeds": sp_list,
                    "Re_values": re_list,
                    "max_aoa": self.max_aoa,
                    "n_aoa": self.n_aoa,
                    "cpmin_limit": self.cpmin_limit,
                    "w_cm": self.w_cm,
                    "cd_regression_pct": self.cd_regression_pct,
                    "cm_regression_abs": self.cm_regression_abs,
                    "te_thickness": float(self.te_thickness),
                }
            )
        else:
            d["operating_points"] = [op.model_dump() for op in (self.operating_points or [])]
            d["cm_limit"] = self.cm_limit
            d["cm_limit_alpha"] = self.cm_limit_alpha
            d["dcm_dcl_limit"] = self.dcm_dcl_limit
            d["dcm_dcl_cl_range"] = tuple(self.dcm_dcl_cl_range)
            d["min_te_thickness"] = float(self.min_te_thickness)
            d["max_te_thickness"] = float(self.max_te_thickness)
        if self.stiffness is not None:
            s = self.stiffness.model_dump()
            d["stiffness"] = s
        return d

    @staticmethod
    def _lock_dict(
        v: EdgeThicknessLockIn | dict[str, Any] | None,
    ) -> dict[str, list[float]] | None:
        if v is None:
            return None
        if isinstance(v, EdgeThicknessLockIn):
            return {"x": v.x, "lower": v.lower, "upper": v.upper}
        return v  # type: ignore[return-value]


class FlowRequest(BaseModel):
    speed: float
    speed_unit: Literal["m/s", "km/h", "knots", "mph"] = "m/s"
    chord_mm: int = Field(ge=20, le=500, default=120)
    water_temp_c: float = Field(ge=0, le=40, default=20.0)
    salt_water: bool = False
    lift_mode: Literal["mass_kg", "force_n"] = "mass_kg"
    mass_kg: float = 85.0
    lift_n: float = 850.0
    area_cm2: int = 1200
    lift_share_pct: int = Field(ge=10, le=100, default=100)


class SeedPolarParams(BaseModel):
    re_list: list[float]
    ncrit: float
    model_size: Literal["tiny", "small", "medium", "large", "xlarge"] = "xlarge"
    alpha_start: float = -5.0
    alpha_end: float = 15.0
    alpha_step: float = 0.5


class CompareAirfoilIn(BaseModel):
    kind: Literal["library", "coordinates"]
    library_name: str | None = None
    coordinates: list[list[float]] | None = None
    legend: str | None = None

    @model_validator(mode="after")
    def _c(self) -> CompareAirfoilIn:
        if self.kind == "library" and not self.library_name:
            raise ValueError("library_name required")
        if self.kind == "coordinates" and (
            not self.coordinates or len(self.coordinates) < 10
        ):
            raise ValueError("coordinates required")
        return self

    def to_runtime(self) -> str | np.ndarray:
        if self.kind == "library":
            return self.library_name  # type: ignore[return-value]
        return np.asarray(self.coordinates, dtype=float)


class SeedAnalyzeRequest(BaseModel):
    component_type: Literal["mast", "front_wing"]
    chord_mm: float
    te_thickness: float | None = None
    seed_airfoil: SeedAirfoilIn
    compare: CompareAirfoilIn | None = None
    compute_polars: bool = False
    polar: SeedPolarParams | None = None


class EdgeLocksRequest(BaseModel):
    """Mirrors sidebar LE/TE thickness lock construction."""

    seed_airfoil: SeedAirfoilIn
    le_mode: Literal["Off", "Absolute (± % chord)", "Relative (± % of seed)"] = "Off"
    le_tol_pct: float = 0.0
    le_tol_rel_pct: float = 0.0
    te_tol_pct: float = 0.0


class DatParseRequest(BaseModel):
    content: str

    @field_validator("content")
    @classmethod
    def non_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("content must be non-empty")
        return v


class OptimizedCstIn(BaseModel):
    """Kulfan CST for reconstructing airfoil coordinates (same as ``run_optimized`` return)."""

    upper: list[float]
    lower: list[float]
    le: float = 0.0
    te: float = 0.0


class ExportRequest(BaseModel):
    """
    ``coordinates`` is preferred (repanel + .dat). If missing or too few points,
    provide ``cst`` so the server can rebuild the foil from the optimisation result.
    """

    coordinates: list[list[float]] | None = None
    cst: OptimizedCstIn | None = None
    export_name: str = "export"
    export_npts: int = Field(ge=80, le=250, default=161)
    le_bunch: float = Field(ge=1.0, le=2.0, default=1.3)
    polar: dict[str, list[float]] | None = None
    alphas: list[float] | None = None
    summary_lines: list[str] | None = None
    # Inserted as #... lines in the .dat (after the title) — e.g. t/c, Ixx, Iyy, J
    dat_header_comments: list[str] | None = None

    @model_validator(mode="after")
    def _has_geometry(self) -> ExportRequest:
        has_pts = self.coordinates is not None and len(self.coordinates) >= 3
        if not has_pts and self.cst is None:
            raise ValueError(
                "either coordinates (≥3 x/y pairs) or cst (upper, lower) is required",
            )
        return self
