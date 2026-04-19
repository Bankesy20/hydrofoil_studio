"""
Objective function for **symmetric mast** section optimisation.

Design philosophy
-----------------
- The objective is the **weighted-average drag ratio** relative to the seed:
      objective = Σ wᵢ · Cd_candidate_i / Cd_seed_i
  A value < 1.0 means the candidate is better than the seed.
- Cpmin is treated as a **constraint** (penalty only when it exceeds a
  user-specified threshold), NOT as a continuous objective.
- Cm stability is an optional soft penalty, not a primary driver.
- Geometry constraints (t/c, self-intersection) are hard penalties.

Why fixed-alpha, not fixed-Cl?
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
A mast/strut operates at a **leeway angle** imposed by the boat's course —
the geometric AoA is the natural independent variable, not a target Cl.
For symmetric sections within a constrained t/c band, dCl/dα varies only
at second order (thin-airfoil: Cl ≈ 2πα for all symmetric profiles), so
scoring at fixed α gives an apples-to-apples comparison.  This differs
from xoptfoil2's Cl-matched approach, which is more appropriate for
cambered wing sections where camber shifts the whole Cl(α) curve.

Design variables
----------------
    [upper_w0 … upper_w7]   →  8 variables
    lower_weights = −upper_weights  (symmetry)
    leading_edge_weight = 0
    TE_thickness = fixed from config["te_thickness"]
"""

import numpy as np
from core.aero_engine import evaluate_multipoint
from core.section_properties import (compute_section_properties,
                                     compute_hollow_section_properties)
from core.cst_geometry import cst_to_coordinates, get_tc_from_coords, N_CST
from core.constraints import check_geometry_constraints
from core.stiffness import apply_stiffness

_PENALTY = 1e6


def _cst_smoothness_penalty(*weight_arrays):
    """
    Sum-of-squared second finite differences across CST weight sequences.

    Penalises oscillatory patterns (adjacent weights fighting: up-down-up)
    while allowing smooth gradual changes.  Applied to one or more weight
    arrays; the penalties are summed.
    """
    penalty = 0.0
    for w in weight_arrays:
        w = np.asarray(w, dtype=float)
        if len(w) >= 3:
            d2 = np.diff(w, n=2)
            penalty += float(np.sum(d2 ** 2))
    return penalty


def build_mast_eval_grid(config):
    """
    Build the evaluation grid (alphas, Res, weights) once, and evaluate
    the seed airfoil to produce a baseline.

    Supports multi-Ncrit averaging: if config["n_crit"] is a list,
    the seed is evaluated at each Ncrit and stored as a list.

    Returns (alphas, Res, weights, seed_aero_list, n_crit_list).
    seed_aero_list and n_crit_list are always lists (length 1 for single Ncrit).
    """
    speeds = np.array(config["speeds"])
    aoas = np.linspace(0.0, config["max_aoa"], config["n_aoa"])

    # Speed weights — higher speeds matter more (drag force ∝ V²)
    speed_w = speeds ** 2
    speed_w /= speed_w.sum()

    # AoA weights — more weight near zero (most common condition)
    aoa_w = np.exp(-aoas / max(config["max_aoa"], 0.1))
    aoa_w /= aoa_w.sum()

    all_alphas, all_Res, all_weights = [], [], []
    for i, speed in enumerate(speeds):
        Re = speed * config["chord_m"] / config["nu"]
        for j, alpha in enumerate(aoas):
            all_alphas.append(alpha)
            all_Res.append(Re)
            all_weights.append(speed_w[i] * aoa_w[j])

    all_alphas = np.array(all_alphas)
    all_Res = np.array(all_Res)
    all_weights = np.array(all_weights)
    all_weights /= all_weights.sum()

    # Normalise n_crit to a list
    n_crit_raw = config["n_crit"]
    if isinstance(n_crit_raw, (list, tuple, np.ndarray)):
        n_crit_list = [float(nc) for nc in n_crit_raw]
    else:
        n_crit_list = [float(n_crit_raw)]

    # Evaluate seed at every grid point for each Ncrit
    seed_cst = config["_seed_cst"]
    model_size = config.get("optim_model_size", "large")
    seed_aero_list = []
    for nc in n_crit_list:
        seed_aero = evaluate_multipoint(
            seed_cst["upper"], seed_cst["lower"],
            seed_cst["le"], seed_cst["te"],
            all_alphas, all_Res,
            n_crit=nc, model_size=model_size,
        )
        seed_aero_list.append(seed_aero)

    return all_alphas, all_Res, all_weights, seed_aero_list, n_crit_list


def mast_objective(design_vars, config):
    """
    Objective for symmetric mast section.

    Returns scalar (LOWER IS BETTER — optimiser minimises).
    A value of 1.0 means "same as seed"; < 1.0 means improvement.

    When multi-Ncrit is active, the objective is the equal-weighted
    average across all Ncrit values.
    """
    # ── decode design variables ──────────────────────────────────────────────
    upper_weights = design_vars[:N_CST].tolist()
    lower_weights = [-w for w in upper_weights]   # symmetric
    le_weight = 0.0
    te_thickness = config["te_thickness"]

    # ── generate coordinates & thickness check ───────────────────────────────
    try:
        coords = cst_to_coordinates(upper_weights, lower_weights,
                                    le_weight, te_thickness)
    except Exception:
        return _PENALTY

    tc, _ = get_tc_from_coords(coords)
    if tc < config["min_tc"] or tc > config["max_tc"]:
        mid = (config["min_tc"] + config["max_tc"]) / 2
        return _PENALTY + abs(tc - mid) * 1000

    # ── geometry constraints (position locks, self-intersection, etc.) ────────
    geo_penalty = check_geometry_constraints(coords, config)
    if geo_penalty > 0:
        return _PENALTY + geo_penalty

    # ── retrieve cached grid & seed baseline ─────────────────────────────────
    grid = config["_mast_grid"]
    all_alphas, all_Res, all_weights, seed_aero_list, n_crit_list = grid

    # ── evaluate candidate at each Ncrit and average ─────────────────────────
    model_size = config.get("optim_model_size", "large")
    w_pr = float(config.get("w_pressure_recovery", 0.0) or 0.0)
    objectives_per_ncrit = []

    for nc_idx, nc in enumerate(n_crit_list):
        seed_aero = seed_aero_list[nc_idx]

        try:
            cand_aero = evaluate_multipoint(
                upper_weights, lower_weights, le_weight, te_thickness,
                all_alphas, all_Res,
                n_crit=nc, model_size=model_size,
            )
        except Exception:
            return _PENALTY

        cand_cd = cand_aero["CD"]
        seed_cd = seed_aero["CD"]

        if np.any(np.isnan(cand_cd)) or np.any(np.isinf(cand_cd)):
            return _PENALTY

        # ── core objective: normalised drag ratio ────────────────────────
        cd_ratio = cand_cd / np.maximum(seed_cd, 1e-8)
        obj = float(np.sum(all_weights * cd_ratio))

        # ── regression guards (low AoA only) ─────────────────────────────
        low_aoa_mask = all_alphas <= 1.0
        if np.any(low_aoa_mask):
            cd_reg_limit = config.get("cd_regression_pct", 5.0) / 100.0
            cd_ratio_low = cand_cd[low_aoa_mask] / np.maximum(seed_cd[low_aoa_mask], 1e-8)
            worst_cd_regression = float(np.max(cd_ratio_low)) - 1.0
            if worst_cd_regression > cd_reg_limit:
                excess = worst_cd_regression - cd_reg_limit
                obj += 10.0 * excess ** 2

            cm_reg_limit = config.get("cm_regression_abs", 0.001)
            seed_cm_low = np.abs(seed_aero["CM"][low_aoa_mask])
            cand_cm_low = np.abs(cand_aero["CM"][low_aoa_mask])
            cm_excess = cand_cm_low - seed_cm_low - cm_reg_limit
            worst_cm_excess = float(np.max(cm_excess))
            if worst_cm_excess > 0:
                obj += 10.0 * worst_cm_excess ** 2

        # ── pressure recovery penalty (optional) ─────────────────────────
        # For symmetric mast/strut sections at low AoA, upper-surface recovery
        # is rarely the primary limiter; the key risks are Cpmin (ventilation)
        # and off-design drag regression. Still, we support this penalty as an
        # optional stabiliser for aggressive shapes. Default weight is 0.0.
        if w_pr > 0 and "pr_upper" in cand_aero and np.any(low_aoa_mask):
            pr = np.asarray(cand_aero["pr_upper"])
            pr_low = pr[low_aoa_mask]
            w_low = all_weights[low_aoa_mask]
            if pr_low.size > 0 and np.sum(w_low) > 0:
                obj += w_pr * float(np.sum(w_low * pr_low) / np.sum(w_low))

        # ── Cpmin constraint (ventilation — low AoA, speed-weighted) ─────
        cpmin_limit = config.get("cpmin_limit", None)
        if cpmin_limit is not None:
            if np.any(low_aoa_mask):
                cpmin_low = cand_aero["Cpmin"][low_aoa_mask]
                re_low = all_Res[low_aoa_mask]
                sw = re_low ** 2
                sw /= sw.sum()
                weighted_cpmin = float(np.sum(sw * cpmin_low))
                if weighted_cpmin < cpmin_limit:
                    violation = (cpmin_limit - weighted_cpmin) / abs(cpmin_limit)
                    obj += 2.0 * violation ** 2

        # ── Cm stability penalty (soft) ──────────────────────────────────
        cm_penalty_weight = config.get("w_cm", 0.0)
        if cm_penalty_weight > 0:
            seed_cm_mag = float(np.sum(all_weights * np.abs(seed_aero["CM"])))
            cand_cm_mag = float(np.sum(all_weights * np.abs(cand_aero["CM"])))
            seed_cm_mag = max(seed_cm_mag, 1e-6)
            cm_ratio = cand_cm_mag / seed_cm_mag
            obj += cm_penalty_weight * max(0.0, cm_ratio - 1.0)

        objectives_per_ncrit.append(obj)

    # ── average across Ncrit values ──────────────────────────────────────────
    objective = float(np.mean(objectives_per_ncrit))

    # ── CST smoothness regularisation (optional) ─────────────────────────────
    w_smooth = config.get("w_smoothness", 0.0)
    if w_smooth > 0:
        objective += w_smooth * _cst_smoothness_penalty(upper_weights)

    # ── stiffness integration (optional) ─────────────────────────────────────
    stiffness_cfg = config.get("stiffness")
    if stiffness_cfg:
        if (stiffness_cfg.get("section_type") == "hollow"
                and stiffness_cfg.get("wall_thickness_m")):
            sec = compute_hollow_section_properties(
                coords, config["chord_m"], stiffness_cfg["wall_thickness_m"])
        else:
            sec = compute_section_properties(coords, config["chord_m"])
        return apply_stiffness(objective, sec, config)

    return objective
