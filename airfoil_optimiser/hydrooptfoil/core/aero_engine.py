"""
NeuralFoil wrapper — multipoint aerodynamic evaluation.

NeuralFoil v0.3 returns a *dict* of numpy arrays.  Key fields:
    CL, CD, CM, Top_Xtr, Bot_Xtr, analysis_confidence
    upper_bl_ue/vinf_0 … upper_bl_ue/vinf_31  (boundary-layer edge velocity)
    lower_bl_ue/vinf_0 … lower_bl_ue/vinf_31

No explicit Cpmin field — we derive it from the ue/vinf data:
    Cp = 1 − (ue/V∞)²   →   Cpmin = min over all stations & both surfaces.
"""

import numpy as np
import neuralfoil as nf

_N_BL_STATIONS = 32  # number of boundary-layer output stations per surface
_GOOD_RECOVERY_DCP_STEP = 0.045  # see _pressure_recovery_penalty docstring

# Safety factor applied to Cpmin estimates.  NeuralFoil reports boundary-layer
# edge velocities at 32 discrete chordwise stations; the true suction peak
# (especially near the LE where gradients are steep) may lie between stations,
# so the discrete Cpmin is an upper bound (less negative than reality).  For
# ventilation-risk screening we want to be conservative (flag *more* designs),
# so we multiply by this factor to shift the estimate toward more-negative
# values.  1.1 ≈ 10 % safety margin.
_CPMIN_SAFETY_FACTOR = 1.1


# ──────────────────────────────────────────────────────────────────────────────
# Cpmin extraction
# ──────────────────────────────────────────────────────────────────────────────

def _extract_ue_vinf(result, surface, n_points):
    """
    Extract NeuralFoil BL edge-velocity ratios ue/Vinf for a surface.

    Notes
    -----
    NeuralFoil exposes 32 stations per surface as separate dict entries.
    The precise chordwise x/c locations are not published; for recovery
    *shape* metrics we treat station index as an ordinal proxy for x/c.
    """
    prefix = "upper" if surface == "upper" else "lower"
    ue = np.array(
        [np.asarray(result[f"{prefix}_bl_ue/vinf_{i}"]).ravel()
         for i in range(_N_BL_STATIONS)]
    )
    if ue.shape != (_N_BL_STATIONS, n_points):
        ue = np.reshape(ue, (_N_BL_STATIONS, n_points))
    return ue


def _pressure_recovery_penalty(result, n_points, surface="upper"):
    """
    Continuous steering penalty for upper-surface pressure recovery quality.

    Aerodynamic reasoning
    ---------------------
    Steep adverse pressure gradients in the recovery region cause:
      - early transition (shortens laminar run → higher drag in reality)
      - separation bubbles or outright separation at off-design conditions
      - high sensitivity to surface roughness / contamination

    NeuralFoil's smooth NN prediction under-prices these risks, so foils
    with aggressive recoveries score unrealistically well.  This penalty
    provides a continuous incentive toward gentler, more manufacturable
    recovery — not just a guard rail for pathological shapes.

    Metric (absolute, not relative)
    -------------------------------
    We penalise the **maximum dCp per station** in the recovery region
    against a physics-based baseline of what "good recovery" looks like.

    Baseline derivation: with 32 roughly-uniform stations, the recovery
    region (suction peak to TE) spans ~20 stations.  A total ΔCp of ~1.0
    (Cp_peak ≈ −0.3 → Cp_TE ≈ 0.7) distributed uniformly gives
    dCp/station ≈ 0.05.  Stratford-optimal recovery is *concave* (gentle
    start, steeper near TE), so max step ≈ 1.0–1.2× mean for a good
    design.  We set the baseline at 0.045 dCp/station — roughly the
    boundary between "Stratford-like" and "starting to concentrate the
    gradient".  A NACA 4412 at Cl≈0.6 has max step ≈ 0.097 → meaningful
    penalty; a well-optimised foil with max step ≈ 0.05 → near-zero.

    The penalty is ``((max_step - baseline) / baseline)²``, giving a
    dimensionless value that scales quadratically with excess steepness.
    No dead zone, no threshold — every bit of excess gradient costs
    something, so the optimiser has a smooth signal to follow.

    Reversals (local re-acceleration in the recovery region) are penalised
    separately: ``4 × (reversal_fraction)²`` where reversal_fraction is
    the sum of negative ΔCp steps divided by total ΔCp.
    """
    try:
        ue = _extract_ue_vinf(result, surface=surface, n_points=n_points)
    except (KeyError, ValueError):
        return np.zeros(n_points)

    cp = 1.0 - ue ** 2  # shape (32, n_points)

    peak_idx = np.argmin(cp, axis=0)  # (n_points,)

    # Recovery region: aft of suction peak, but not before ~35% chord
    min_start = int(0.35 * _N_BL_STATIONS)
    start_idx = np.maximum(peak_idx + 1, min_start)
    start_idx = np.minimum(start_idx, _N_BL_STATIONS - 2)

    # Total recovery ΔCp (for reversal normalisation)
    cp_te = cp[-1, :]
    cp_peak = cp[peak_idx, np.arange(n_points)]
    delta_cp = np.maximum(cp_te - cp_peak, 1e-6)

    dcp = np.diff(cp, axis=0)  # (31, n_points)

    step_idx = np.arange(_N_BL_STATIONS - 1)[:, None]
    rec_mask = step_idx >= start_idx[None, :]

    # 1) Absolute steepness: max adverse dCp step vs good-recovery baseline
    pos_steps = np.where(rec_mask, np.maximum(dcp, 0.0), 0.0)
    max_step = np.max(pos_steps, axis=0)

    _GOOD_STEP = 0.045
    excess = np.maximum(max_step - _GOOD_STEP, 0.0)
    steep_penalty = (excess / _GOOD_STEP) ** 2

    # 2) Reversals: fraction of total recovery that goes backwards
    neg_steps = np.where(rec_mask, np.maximum(-dcp, 0.0), 0.0)
    reversal_frac = np.sum(neg_steps, axis=0) / (delta_cp + 1e-9)
    reversal_penalty = 4.0 * reversal_frac ** 2

    return steep_penalty + reversal_penalty


def _extract_cpmin(result, n_points):
    """
    Compute Cpmin from boundary-layer velocity data.

    Parameters
    ----------
    result : dict  — raw NeuralFoil output
    n_points : int — number of evaluation points (batch size)

    Returns
    -------
    cpmin : np.ndarray of shape (n_points,)

    Notes
    -----
    A safety factor (``_CPMIN_SAFETY_FACTOR``) is applied to the raw minimum
    to compensate for the fact that the true suction peak may lie between
    the 32 discrete BL stations.  This makes the estimate more negative
    (i.e. more conservative for ventilation screening).
    """
    try:
        ue_upper = np.array(
            [np.asarray(result[f"upper_bl_ue/vinf_{i}"]).ravel()
             for i in range(_N_BL_STATIONS)]
        )  # shape (32, n_points)
        ue_lower = np.array(
            [np.asarray(result[f"lower_bl_ue/vinf_{i}"]).ravel()
             for i in range(_N_BL_STATIONS)]
        )

        # Cp = 1 − (ue/V∞)²  (squaring handles any sign convention;
        # this is a screening proxy — confirm critical designs with XFoil/CFD)
        cp_upper = 1.0 - ue_upper ** 2
        cp_lower = 1.0 - ue_lower ** 2

        cpmin_upper = np.min(cp_upper, axis=0)
        cpmin_lower = np.min(cp_lower, axis=0)

        cpmin = np.minimum(cpmin_upper, cpmin_lower)

        # Apply safety factor: Cpmin is negative, so multiplying by >1
        # makes it more negative (more conservative for ventilation screening).
        return cpmin * _CPMIN_SAFETY_FACTOR
    except (KeyError, ValueError):
        return np.zeros(n_points)


# ──────────────────────────────────────────────────────────────────────────────
# Single-point evaluation
# ──────────────────────────────────────────────────────────────────────────────

def evaluate_airfoil_aero(upper_weights, lower_weights, le_weight, te_thickness,
                          alpha, Re, n_crit=7.0, model_size="large"):
    """
    Evaluate a single operating point.

    Returns dict: CL, CD, CM, Cpmin  (all scalars).
    """
    result = nf.get_aero_from_kulfan_parameters(
        kulfan_parameters={
            "upper_weights": np.asarray(upper_weights, dtype=float),
            "lower_weights": np.asarray(lower_weights, dtype=float),
            "leading_edge_weight": float(le_weight),
            "TE_thickness": float(te_thickness),
        },
        alpha=float(alpha),
        Re=float(Re),
        model_size=model_size,
        n_crit=float(n_crit),
    )

    s = lambda v: float(np.squeeze(v))  # noqa: E731

    cpmin = _extract_cpmin(result, 1)

    return {
        "CL": s(result["CL"]),
        "CD": s(result["CD"]),
        "CM": s(result["CM"]),
        "Cpmin": float(cpmin[0]),
    }


# ──────────────────────────────────────────────────────────────────────────────
# Multi-point (vectorised) evaluation — SAME airfoil, many alpha/Re
# ──────────────────────────────────────────────────────────────────────────────

def evaluate_multipoint(upper_weights, lower_weights, le_weight, te_thickness,
                        alphas, Res, n_crit=7.0, model_size="large"):
    """
    Vectorised evaluation of the **same** airfoil at many (alpha, Re) pairs.

    Parameters
    ----------
    upper_weights, lower_weights : array-like of length 8
    le_weight, te_thickness : float
    alphas, Res : 1-D arrays of equal length

    Returns
    -------
    dict with keys CL, CD, CM, Cpmin — each a 1-D numpy array.
    """
    alphas = np.asarray(alphas, dtype=float)
    Res = np.asarray(Res, dtype=float)
    n = len(alphas)

    result = nf.get_aero_from_kulfan_parameters(
        kulfan_parameters={
            "upper_weights": np.asarray(upper_weights, dtype=float),   # (8,) broadcasts
            "lower_weights": np.asarray(lower_weights, dtype=float),
            "leading_edge_weight": float(le_weight),
            "TE_thickness": float(te_thickness),
        },
        alpha=alphas,
        Re=Res,
        model_size=model_size,
        n_crit=float(n_crit),
    )

    cpmin = _extract_cpmin(result, n)
    pr_upper = _pressure_recovery_penalty(result, n, surface="upper")

    # analysis_confidence: 0–1 indicator of prediction reliability
    conf = result.get("analysis_confidence", None)
    if conf is not None:
        conf = np.asarray(conf).ravel()
    else:
        conf = np.ones(n)

    return {
        "CL": np.asarray(result["CL"]).ravel(),
        "CD": np.asarray(result["CD"]).ravel(),
        "CM": np.asarray(result["CM"]).ravel(),
        "Cpmin": cpmin,
        "pr_upper": np.asarray(pr_upper).ravel(),
        "analysis_confidence": conf,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Polar sweep for display
# ──────────────────────────────────────────────────────────────────────────────

def evaluate_polar_sweep(upper_weights, lower_weights, le_weight, te_thickness,
                         Re, alpha_range=(-5, 15, 0.5), n_crit=7.0,
                         model_size="xlarge"):
    """
    Full alpha sweep at a single Re for plotting.

    Returns
    -------
    polar : dict with CL, CD, CM, Cpmin arrays
    alphas : 1-D array of alpha values
    """
    alphas = np.arange(alpha_range[0],
                       alpha_range[1] + alpha_range[2] / 2,
                       alpha_range[2])
    Res = np.full_like(alphas, float(Re))

    polar = evaluate_multipoint(upper_weights, lower_weights, le_weight,
                                te_thickness, alphas, Res, n_crit, model_size)
    return polar, alphas


# ──────────────────────────────────────────────────────────────────────────────
# Detailed polar sweep for UI inspection (includes Xtr + Cp distributions)
# ──────────────────────────────────────────────────────────────────────────────

def evaluate_polar_sweep_detailed(
    upper_weights,
    lower_weights,
    le_weight,
    te_thickness,
    Re,
    alpha_range=(-5, 15, 0.5),
    n_crit=7.0,
    model_size="xlarge",
):
    """
    Full alpha sweep at a single Re, returning *extra* diagnostic fields.

    Intended for UI inspection (seed analysis / debugging), not for the main
    optimisation loop.

    Returns
    -------
    detailed : dict
        Scalar arrays keyed by e.g. CL, CD, CM, Cpmin, Top_Xtr, Bot_Xtr,
        analysis_confidence, pr_upper, etc.
        Also includes Cp distributions:
          - x_cp : shape (32,)
          - cp_upper : shape (32, n_alpha)
          - cp_lower : shape (32, n_alpha)
          - dcp_upper : shape (31, n_alpha)
          - dcp_lower : shape (31, n_alpha)
    alphas : ndarray shape (n_alpha,)
    """
    alphas = np.arange(
        alpha_range[0],
        alpha_range[1] + alpha_range[2] / 2,
        alpha_range[2],
        dtype=float,
    )
    Res = np.full_like(alphas, float(Re), dtype=float)
    n = len(alphas)

    result = nf.get_aero_from_kulfan_parameters(
        kulfan_parameters={
            "upper_weights": np.asarray(upper_weights, dtype=float),
            "lower_weights": np.asarray(lower_weights, dtype=float),
            "leading_edge_weight": float(le_weight),
            "TE_thickness": float(te_thickness),
        },
        alpha=alphas,
        Re=Res,
        model_size=model_size,
        n_crit=float(n_crit),
    )

    # Scalars (always present in NeuralFoil v0.3)
    detailed = {
        "CL": np.asarray(result["CL"]).ravel(),
        "CD": np.asarray(result["CD"]).ravel(),
        "CM": np.asarray(result["CM"]).ravel(),
    }

    # Optional scalars
    if "analysis_confidence" in result:
        detailed["analysis_confidence"] = np.asarray(result["analysis_confidence"]).ravel()
    else:
        detailed["analysis_confidence"] = np.ones(n)

    if "Top_Xtr" in result:
        detailed["Top_Xtr"] = np.asarray(result["Top_Xtr"]).ravel()
    if "Bot_Xtr" in result:
        detailed["Bot_Xtr"] = np.asarray(result["Bot_Xtr"]).ravel()

    # Derived scalars
    detailed["Cpmin"] = _extract_cpmin(result, n)
    detailed["pr_upper"] = np.asarray(_pressure_recovery_penalty(result, n, surface="upper")).ravel()

    # Cp distributions (station index treated as x/c proxy for inspection plots)
    x_cp = np.linspace(0.0, 1.0, _N_BL_STATIONS)
    ue_u = _extract_ue_vinf(result, surface="upper", n_points=n)
    ue_l = _extract_ue_vinf(result, surface="lower", n_points=n)
    cp_u = 1.0 - ue_u ** 2
    cp_l = 1.0 - ue_l ** 2

    detailed.update({
        "x_cp": x_cp,
        "cp_upper": cp_u,
        "cp_lower": cp_l,
        "dcp_upper": np.diff(cp_u, axis=0),
        "dcp_lower": np.diff(cp_l, axis=0),
    })

    # Simple recovery diagnostics (helpful for "Stratford-ish" inspection)
    # These are *station-based* approximations.
    dcp_u = detailed["dcp_upper"]
    dcp_l = detailed["dcp_lower"]
    detailed["max_dcp_upper"] = np.max(np.maximum(dcp_u, 0.0), axis=0)
    detailed["max_dcp_lower"] = np.max(np.maximum(dcp_l, 0.0), axis=0)
    detailed["stratford_ratio_upper"] = detailed["max_dcp_upper"] / max(_GOOD_RECOVERY_DCP_STEP, 1e-9)
    detailed["stratford_ratio_lower"] = detailed["max_dcp_lower"] / max(_GOOD_RECOVERY_DCP_STEP, 1e-9)

    return detailed, alphas
