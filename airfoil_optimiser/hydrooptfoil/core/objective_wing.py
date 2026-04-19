"""
Objective function for **cambered front-wing** section optimisation.

Design philosophy (inspired by xoptfoil2)
------------------------------------------
- Each operating point produces a score normalised to the seed's performance
  at that same condition.  A value < 1.0 means improvement.
- For ``min_cd``:  score = Cd_candidate / Cd_seed  (at the alpha that gives
  the target Cl).
- For ``max_cl_cd``:  score = (Cl/Cd)_seed / (Cl/Cd)_candidate  (inverted so
  that lower = better).
- For ``max_cl``:  score = Cl_max_seed / Cl_max_candidate.
- The final objective is the weighted average of per-point scores.

Design variables
----------------
    [upper_w0…upper_w7, lower_w0…lower_w7, le_weight, TE_thickness]  → 18
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


# Wider alpha sweep to handle cambered foils at low Cl targets (zero-lift
# angle of a NACA 4412 is ~−4°, so starting at −5° avoids false misses).
_ALPHA_SWEEP = np.linspace(-5.0, 15.0, 30)
_ALPHA_STALL = np.linspace(0.0, 18.0, 25)

# Cd floor — NeuralFoil can predict negative or near-zero drag for shapes
# outside its training distribution.  The floor prevents the optimiser from
# chasing NN extrapolation artefacts.  A well-designed laminar foil at
# Re ~ 1.2 M can legitimately reach Cd ≈ 0.003, so 0.002 was too close and
# could mask genuine differences.  0.001 leaves more headroom; Re-dependent
# floors are also available via _cd_floor_for_re().
_CD_FLOOR = 0.001


def _cd_floor_for_re(Re):
    """
    Return a Re-dependent Cd floor.

    At lower Re, skin-friction and pressure drag are higher so the floor
    can be more generous.  At high Re, laminar foils achieve lower Cd so
    the floor must be tighter to preserve discrimination.

    Approximate empirical lower-bound: Cd_min ≈ 1.2 / sqrt(Re)
    (flat-plate turbulent friction ≈ 0.074 / Re^0.2, but laminar runs
    push Cd below that — the 1.2/sqrt(Re) curve sits comfortably below
    any realistic airfoil).
    """
    return max(1.2 / np.sqrt(max(Re, 1e4)), _CD_FLOOR)

# Minimum NeuralFoil analysis_confidence to accept a result.  Below this the
# prediction is unreliable — penalise rather than trust.
_MIN_CONFIDENCE = 0.45

# Per-point score can't drop below this (prevents chasing remaining artefacts;
# 0.15 corresponds to an 85 % improvement ceiling, far beyond realistic).
_MIN_SCORE = 0.15


def _compute_dcm_dcl(aero, cl_lo=-1.0, cl_hi=1.0):
    """
    Linear-regression slope of Cm vs Cl over the range [cl_lo, cl_hi].

    Returns float slope (dCm/dCl). Negative = statically stable.
    Returns None if fewer than 3 points fall in the Cl range.
    """
    cl = np.asarray(aero["CL"], dtype=float)
    cm = np.asarray(aero["CM"], dtype=float)

    cl_lo = float(cl_lo)
    cl_hi = float(cl_hi)
    if cl_hi < cl_lo:
        cl_lo, cl_hi = cl_hi, cl_lo

    mask = np.isfinite(cl) & np.isfinite(cm) & (cl >= cl_lo) & (cl <= cl_hi)
    if np.sum(mask) < 3:
        return None

    cl_f = cl[mask]
    cm_f = cm[mask]
    try:
        return float(np.polyfit(cl_f, cm_f, 1)[0])
    except Exception:
        return None


def _interp_at_cl(aero, target_cl):
    """
    Linearly interpolate Cd and Cl/Cd at *target_cl* from an alpha sweep.

    Finds the two alpha points that bracket the target Cl (where the Cl curve
    crosses the target) and interpolates Cd between them.  This eliminates
    discretisation bias from candidates with different dCl/dα.

    Returns ``(cd_at_cl, cl_cd_at_cl, cl_miss)`` where *cl_miss* is the
    residual Cl error (0 if perfectly bracketed, >0 if extrapolated).
    """
    cl = aero["CL"]
    cd = aero["CD"]

    # Find the index of the closest point
    cl_diff = np.abs(cl - target_cl)
    best_idx = int(np.argmin(cl_diff))
    cl_miss = float(cl_diff[best_idx])

    # Try to interpolate between the two bracketing points
    # Look for a sign change in (cl - target_cl) to find the crossing
    residual = cl - target_cl
    sign_changes = np.where(np.diff(np.sign(residual)))[0]

    if len(sign_changes) > 0:
        # Filter to crossings in the pre-stall region where dCL/dα > 0.
        # This avoids picking a post-stall crossing when the CL curve
        # crosses the target twice (once rising, once descending).
        dcl = np.gradient(cl)
        pre_stall = [idx for idx in sign_changes if dcl[idx] > 0]
        if len(pre_stall) == 0:
            # No pre-stall crossing; fall back to the first crossing
            pre_stall = sign_changes
        i = int(pre_stall[0])
        cl_lo, cl_hi = float(cl[i]), float(cl[i + 1])
        denom = cl_hi - cl_lo
        if abs(denom) > 1e-10:
            frac = (target_cl - cl_lo) / denom
            frac = np.clip(frac, 0.0, 1.0)
            cd_interp = float(cd[i]) + frac * (float(cd[i + 1]) - float(cd[i]))
            cl_interp = cl_lo + frac * denom
            cl_miss = abs(cl_interp - target_cl)
            cl_cd = cl_interp / max(cd_interp, _CD_FLOOR)
            return cd_interp, cl_cd, cl_miss

    # Fallback: nearest point (no bracketing found)
    cd_val = float(cd[best_idx])
    cl_cd = float(cl[best_idx]) / max(cd_val, _CD_FLOOR)
    return cd_val, cl_cd, cl_miss


def _interp_penalty_at_cl(aero, target_cl, key):
    """
    Interpolate an aero-derived penalty (e.g. pr_upper) at target Cl.

    Uses the same "first pre-stall crossing" logic as _interp_at_cl so the
    penalty is evaluated at the same operating point the drag is scored at.
    """
    cl = aero["CL"]
    p = aero[key]

    residual = cl - target_cl
    sign_changes = np.where(np.diff(np.sign(residual)))[0]
    if len(sign_changes) > 0:
        dcl = np.gradient(cl)
        pre_stall = [idx for idx in sign_changes if dcl[idx] > 0]
        if len(pre_stall) == 0:
            pre_stall = sign_changes
        i = int(pre_stall[0])
        cl_lo, cl_hi = float(cl[i]), float(cl[i + 1])
        denom = cl_hi - cl_lo
        if abs(denom) > 1e-10:
            frac = (target_cl - cl_lo) / denom
            frac = np.clip(frac, 0.0, 1.0)
            return float(p[i]) + frac * (float(p[i + 1]) - float(p[i]))

    # Fallback: use penalty at nearest Cl point
    best_idx = int(np.argmin(np.abs(cl - target_cl)))
    return float(p[best_idx])


def _sanitize_aero(aero, Re=None):
    """
    Validate and sanitize aero results from NeuralFoil.

    Returns ``(aero_dict, is_valid)`` where *is_valid* is False when the
    result contains NaN/Inf and should be treated as a failed evaluation.
    Cd values are floored to a Re-dependent minimum (or ``_CD_FLOOR`` if
    *Re* is not provided) in-place.
    """
    for key in ("CL", "CD"):
        if np.any(np.isnan(aero[key])) or np.any(np.isinf(aero[key])):
            return aero, False
    floor = _cd_floor_for_re(Re) if Re is not None else _CD_FLOOR
    aero["CD"] = np.maximum(aero["CD"], floor)
    return aero, True


def _normalise_n_crit_list(config):
    """Return config["n_crit"] as a list of floats (length >= 1)."""
    raw = config["n_crit"]
    if isinstance(raw, (list, tuple, np.ndarray)):
        return [float(v) for v in raw]
    return [float(raw)]


def precompute_wing_seed_baseline(config):
    """
    Evaluate the seed airfoil at each operating point to produce a
    normalisation baseline.  Stored in config["_wing_seed_baselines"].

    When multi-Ncrit is active (config["n_crit"] is a list), the seed is
    evaluated at each Ncrit independently so the objective can normalise
    per-Ncrit and average.

    Returns list (per op-point) of lists (per Ncrit) of dicts.
    """
    seed = config["_seed_cst"]
    n_crit_list = _normalise_n_crit_list(config)
    model_size = config.get("optim_model_size", "large")
    ops = config["operating_points"]

    # Build per-op segments and concatenate into one batch per Ncrit
    op_segments = []
    for op in ops:
        Re = float(op["Re"])
        obj_type = op["objective"]
        if obj_type in ("min_cd", "max_cl_cd"):
            alphas_seg = _ALPHA_SWEEP
        elif obj_type == "max_cl":
            alphas_seg = _ALPHA_STALL
        else:
            alphas_seg = _ALPHA_SWEEP
        op_segments.append({
            "alphas": alphas_seg,
            "Res": np.full_like(alphas_seg, Re),
            "n": len(alphas_seg),
            "Re": Re,
        })

    all_alphas = np.concatenate([s["alphas"] for s in op_segments])
    all_Res = np.concatenate([s["Res"] for s in op_segments])

    # baselines[op_idx][nc_idx] = dict
    baselines = [[] for _ in ops]

    for nc in n_crit_list:
        aero_batch = evaluate_multipoint(
            seed["upper"], seed["lower"], seed["le"], seed["te"],
            all_alphas, all_Res, n_crit=nc, model_size=model_size)

        offset = 0
        for idx, op in enumerate(ops):
            n_pts = op_segments[idx]["n"]
            Re = op_segments[idx]["Re"]
            target_cl = float(op["target_cl"])
            obj_type = op["objective"]

            aero = {k: aero_batch[k][offset:offset + n_pts] for k in aero_batch}
            offset += n_pts

            if obj_type in ("min_cd", "max_cl_cd"):
                aero, _ = _sanitize_aero(aero, Re)
                cd_at_cl, cl_cd_at_cl, _ = _interp_at_cl(aero, target_cl)
                baselines[idx].append({
                    "cd_at_cl": max(cd_at_cl, _CD_FLOOR),
                    "cl_cd_at_cl": max(cl_cd_at_cl, 1e-3),
                })
            elif obj_type == "max_cl":
                baselines[idx].append({
                    "max_cl": max(float(np.max(aero["CL"])), 0.1),
                })
            else:
                baselines[idx].append({})

    # ── seed dCm/dCl slope at representative condition (global property) ─────
    # Use first operating point's Re and middle Ncrit value.
    try:
        Re_ref = float(ops[0]["Re"])
        mid_nc = n_crit_list[len(n_crit_list) // 2]
        aero_ref = evaluate_multipoint(
            seed["upper"], seed["lower"], seed["le"], seed["te"],
            _ALPHA_SWEEP, np.full_like(_ALPHA_SWEEP, Re_ref),
            n_crit=mid_nc, model_size=model_size)
        cl_lo, cl_hi = config.get("dcm_dcl_cl_range", (-1.0, 1.0))
        config["_seed_dcm_dcl"] = _compute_dcm_dcl(aero_ref, cl_lo=cl_lo, cl_hi=cl_hi)
    except Exception:
        config["_seed_dcm_dcl"] = None

    return baselines


def wing_objective(design_vars, config):
    """
    Objective for cambered front-wing section.

    Returns scalar (LOWER IS BETTER).  1.0 = same as seed.
    """
    # ── decode ───────────────────────────────────────────────────────────────
    upper_weights = design_vars[:N_CST].tolist()
    lower_weights = design_vars[N_CST:2 * N_CST].tolist()
    le_weight = float(design_vars[2 * N_CST])
    te_thickness = float(design_vars[2 * N_CST + 1])

    # ── geometry ─────────────────────────────────────────────────────────────
    try:
        coords = cst_to_coordinates(upper_weights, lower_weights,
                                    le_weight, te_thickness)
    except Exception:
        return _PENALTY

    tc, _ = get_tc_from_coords(coords)
    if tc < config["min_tc"] or tc > config["max_tc"]:
        mid = (config["min_tc"] + config["max_tc"]) / 2
        return _PENALTY + abs(tc - mid) * 1000

    # ── geometry constraints (self-intersection, LE radius) ──────────────────
    geo_penalty = check_geometry_constraints(coords, config)
    if geo_penalty > 0:
        return _PENALTY + geo_penalty

    # ── evaluate each operating point (averaged across Ncrit values) ────────
    baselines = config["_wing_seed_baselines"]
    n_crit_list = _normalise_n_crit_list(config)
    model_size = config.get("optim_model_size", "large")
    w_pr = float(config.get("w_pressure_recovery", 0.0) or 0.0)
    objectives_per_ncrit = []

    ops = config["operating_points"]
    mid_nc_index = None
    if isinstance(n_crit_list, list) and len(n_crit_list) > 0:
        mid_nc_index = len(n_crit_list) // 2
    first_op_aero_for_slope = None

    # Pre-build per-op-point alpha/Re segments and record slice boundaries
    # so we can concatenate into a single NeuralFoil call per Ncrit.
    op_segments = []
    for op in ops:
        Re = float(op["Re"])
        obj_type = op["objective"]
        if obj_type in ("min_cd", "max_cl_cd"):
            alphas_seg = _ALPHA_SWEEP
        elif obj_type == "max_cl":
            alphas_seg = _ALPHA_STALL
        else:
            alphas_seg = _ALPHA_SWEEP
        op_segments.append({
            "alphas": alphas_seg,
            "Res": np.full_like(alphas_seg, Re),
            "n": len(alphas_seg),
            "Re": Re,
        })

    all_alphas = np.concatenate([s["alphas"] for s in op_segments])
    all_Res = np.concatenate([s["Res"] for s in op_segments])

    for nc_idx, nc in enumerate(n_crit_list):
        # Single batched NeuralFoil call for all operating points at this Ncrit
        try:
            aero_batch = evaluate_multipoint(
                upper_weights, lower_weights, le_weight, te_thickness,
                all_alphas, all_Res, n_crit=nc, model_size=model_size)
        except Exception:
            return _PENALTY

        total_score = 0.0
        total_weight = 0.0
        offset = 0

        for idx, op in enumerate(ops):
            n_pts = op_segments[idx]["n"]
            Re = op_segments[idx]["Re"]
            target_cl = float(op["target_cl"])
            obj_type = op["objective"]
            weight = float(op["weight"])
            bl = baselines[idx][nc_idx]

            aero = {k: aero_batch[k][offset:offset + n_pts] for k in aero_batch}
            offset += n_pts

            aero, valid = _sanitize_aero(aero, Re)
            if not valid:
                return _PENALTY

            # Cache the first operating point aero (for mid Ncrit) so we can
            # compute dCm/dCl without extra NeuralFoil calls.
            if idx == 0 and (mid_nc_index is None or nc_idx == mid_nc_index):
                first_op_aero_for_slope = aero

            min_conf = float(np.min(aero["analysis_confidence"]))
            if min_conf < _MIN_CONFIDENCE:
                return _PENALTY

            if obj_type in ("min_cd", "max_cl_cd"):
                cd_at_cl, cl_cd_at_cl, cl_miss = _interp_at_cl(aero, target_cl)
                pr_at_cl = (_interp_penalty_at_cl(aero, target_cl, "pr_upper")
                            if w_pr > 0 else 0.0)

                if cl_miss > 0.15:
                    score = 5.0 + cl_miss
                elif obj_type == "min_cd":
                    score = cd_at_cl / bl["cd_at_cl"]
                else:
                    score = bl["cl_cd_at_cl"] / max(cl_cd_at_cl, 1e-3)

                score = max(score, _MIN_SCORE)
                total_score += weight * (score + w_pr * pr_at_cl)

            elif obj_type == "max_cl":
                cand_max_cl = max(float(np.max(aero["CL"])), 0.01)
                score = bl["max_cl"] / cand_max_cl
                score = max(score, _MIN_SCORE)
                if w_pr > 0:
                    # For max_cl, evaluate recovery at the highest-lift point.
                    # This biases away from shapes that "cheat" via unrealistically
                    # aggressive suction peaks near stall.
                    i_peak = int(np.argmax(aero["CL"]))
                    pr = float(aero["pr_upper"][i_peak])
                    total_score += weight * (score + w_pr * pr)
                else:
                    total_score += weight * score

            total_weight += weight

        if total_weight > 0:
            total_score /= total_weight

        objectives_per_ncrit.append(total_score)

    total_score = float(np.mean(objectives_per_ncrit))

    # ── CST smoothness regularisation (optional) ─────────────────────────────
    w_smooth = config.get("w_smoothness", 0.0)
    if w_smooth > 0:
        total_score += w_smooth * _cst_smoothness_penalty(
            upper_weights, lower_weights)

    # ── Cm hard constraint (absolute limit at reference alpha) ───────────────
    cm_limit_raw = config.get("cm_limit", None)
    cm_limit_alpha = config.get("cm_limit_alpha", 0.0)
    if cm_limit_raw is not None:
        cm_limit = abs(float(cm_limit_raw))
        Re_cm = float(config["operating_points"][0]["Re"])
        mid_nc = n_crit_list[len(n_crit_list) // 2]
        try:
            alphas_cm = np.array([cm_limit_alpha])
            Res_cm = np.array([Re_cm])
            aero_cm = evaluate_multipoint(
                upper_weights, lower_weights, le_weight, te_thickness,
                alphas_cm, Res_cm, n_crit=mid_nc, model_size=model_size)
            cm_val = abs(float(aero_cm["CM"][0]))
            if cm_val > cm_limit:
                violation = (cm_val - cm_limit) / max(cm_limit, 1e-6)
                total_score += 5.0 * violation ** 2
        except Exception:
            pass

    # ── dCm/dCl stability constraint (relative to seed slope) ────────────────
    dcm_dcl_limit = config.get("dcm_dcl_limit", None)
    if dcm_dcl_limit is not None:
        seed_slope = config.get("_seed_dcm_dcl", None)
        if seed_slope is not None and first_op_aero_for_slope is not None:
            cl_lo, cl_hi = config.get("dcm_dcl_cl_range", (-1.0, 1.0))
            cand_slope = _compute_dcm_dcl(first_op_aero_for_slope, cl_lo=cl_lo, cl_hi=cl_hi)
            if cand_slope is not None:
                tol = float(dcm_dcl_limit)
                seed_mag = abs(float(seed_slope))
                cand_mag = abs(float(cand_slope))
                threshold = seed_mag * (1.0 + max(tol, 0.0))
                if threshold > 0 and cand_mag > threshold:
                    excess = (cand_mag - threshold) / threshold
                    total_score += 5.0 * excess ** 2

    # ── stiffness (optional) ─────────────────────────────────────────────────
    stiffness_cfg = config.get("stiffness")
    if stiffness_cfg:
        if (stiffness_cfg.get("section_type") == "hollow"
                and stiffness_cfg.get("wall_thickness_m")):
            sec = compute_hollow_section_properties(
                coords, config["chord_m"], stiffness_cfg["wall_thickness_m"])
        else:
            sec = compute_section_properties(coords, config["chord_m"])
        return apply_stiffness(total_score, sec, config)

    return total_score
