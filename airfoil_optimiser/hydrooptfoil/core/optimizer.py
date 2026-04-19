"""
Main optimisation loop wrapping scipy.optimize.differential_evolution.

Before running the optimiser, the seed airfoil is evaluated at every
operating-point in the grid so that the objective function can produce
a *normalised* score (seed = 1.0, lower = better).
"""

import logging
import os
import time

import numpy as np
from scipy.optimize import differential_evolution

_N_WORKERS = max(1, (os.cpu_count() or 4) - 2)

# Suppress noisy Streamlit warnings from multiprocessing worker threads
logging.getLogger(
    "streamlit.runtime.scriptrunner_utils.script_run_context"
).setLevel(logging.ERROR)

log = logging.getLogger("hydrooptfoil.optimizer")
if not log.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter(
        "%(asctime)s  %(message)s", datefmt="%H:%M:%S"))
    log.addHandler(_h)
    log.setLevel(logging.INFO)

from core.objective_mast import mast_objective, build_mast_eval_grid
from core.objective_wing import wing_objective, precompute_wing_seed_baseline
from core.cst_geometry import (airfoil_to_cst, cst_to_coordinates,
                               get_tc_from_coords, get_camber_from_coords,
                               N_CST)
from core.section_properties import (compute_section_properties,
                                     compute_hollow_section_properties)
from core.aero_engine import evaluate_polar_sweep


def run_optimization(config, callback=None):
    """
    Run the full optimisation and return a result dict.

    Parameters
    ----------
    config : dict — sidebar configuration
    callback : callable(iteration, best_value, total_iterations) or None
    """
    # Defensive copy: `config` originates from Streamlit session state.
    # We add internal keys during optimisation; copying avoids leaking them
    # across reruns or between runs with different settings.
    config = dict(config)
    if isinstance(config.get("stiffness"), dict):
        config["stiffness"] = dict(config["stiffness"])

    t0_total = time.perf_counter()
    component_type = config["component_type"]

    # ── seed airfoil → CST ───────────────────────────────────────────────────
    from ui.airfoil_library import get_airfoil_coordinates
    seed_coords = get_airfoil_coordinates(config["seed_airfoil"])
    seed_upper, seed_lower, seed_le, seed_te = airfoil_to_cst(seed_coords, N_CST)

    # Store seed CST for objective-function normalisation.
    # For mast mode, symmetrise the seed so that the baseline and x0 are
    # consistent (raw CST fit of a nominally-symmetric airfoil may have tiny
    # upper/lower asymmetries from the fitting process).
    if component_type == "mast":
        fixed_te = config["te_thickness"]
        seed_lower = [-w for w in seed_upper]
        seed_le = 0.0
        seed_te = fixed_te
        config["_seed_cst"] = {
            "upper": seed_upper,
            "lower": seed_lower,
            "le": seed_le,
            "te": seed_te,
        }
        seed_coords = cst_to_coordinates(seed_upper, seed_lower,
                                         seed_le, seed_te)
    else:
        config["_seed_cst"] = {
            "upper": seed_upper, "lower": seed_lower,
            "le": seed_le, "te": seed_te,
        }

    # ── pre-compute seed section properties for stiffness ────────────────────
    # Reference values (Ixx_ref, Iyy_ref, J_ref) are always computed from
    # the seed when stiffness is enabled, for the ±% band constraint.
    stiff = config.get("stiffness")
    if stiff:
        if (stiff.get("section_type") == "hollow"
                and stiff.get("wall_thickness_m")):
            _seed_sec = compute_hollow_section_properties(
                seed_coords, config["chord_m"], stiff["wall_thickness_m"])
        else:
            _seed_sec = compute_section_properties(seed_coords, config["chord_m"])
        config["stiffness"]["Ixx_ref"] = _seed_sec["Ixx"]
        config["stiffness"]["Iyy_ref"] = _seed_sec.get("Iyy", _seed_sec["Ixx"])
        config["stiffness"]["J_ref"] = _seed_sec.get(
            "J_bredt", _seed_sec["J_polar"])

    # ── NeuralFoil model size for optimisation (faster surrogate) ────────────
    config["optim_model_size"] = config.get("optim_model_size", "medium")
    log.info("model_size=%s  workers=%d/%d cores",
             config["optim_model_size"], _N_WORKERS, os.cpu_count() or 0)

    # ── pre-compute seed baseline for normalisation ──────────────────────────
    t0_baseline = time.perf_counter()
    if component_type == "mast":
        config["_mast_grid"] = build_mast_eval_grid(config)
        objective_func = mast_objective
    else:
        config["_wing_seed_baselines"] = precompute_wing_seed_baseline(config)
        objective_func = wing_objective
    log.info("baseline computed in %.2f s", time.perf_counter() - t0_baseline)

    # ── design-variable bounds ───────────────────────────────────────────────
    cst_range = config.get("cst_bound_range", 0.25)

    def _windowed_bound(value, hard_lo, hard_hi):
        """
        Build a local search window around a seed value, but anchor it to a
        clamped seed so we never generate inverted bounds when the CST fit
        slightly exceeds the global hard limits.
        """
        centre = float(np.clip(value, hard_lo, hard_hi))
        lo = max(centre - cst_range, hard_lo)
        hi = min(centre + cst_range, hard_hi)
        return (lo, hi), centre

    if component_type == "mast":
        bounds = []
        x0_values = []
        for i in range(N_CST):
            bound, centre = _windowed_bound(seed_upper[i], -0.5, 0.8)
            bounds.append(bound)
            x0_values.append(centre)
        # NO TE thickness bound — it's fixed now
        x0 = np.array(x0_values, dtype=float)

    else:  # front_wing
        bounds = []
        x0_values = []
        for i in range(N_CST):
            bound, centre = _windowed_bound(seed_upper[i], -0.5, 0.8)
            bounds.append(bound)
            x0_values.append(centre)
        for i in range(N_CST):
            bound, centre = _windowed_bound(seed_lower[i], -0.8, 0.5)
            bounds.append(bound)
            x0_values.append(centre)
        bounds.append((-0.03, 0.10))           # LE weight
        te_lo = min(config.get("min_te_thickness", 0.003),
                    config.get("max_te_thickness", 0.01))
        te_hi = max(config.get("min_te_thickness", 0.003),
                    config.get("max_te_thickness", 0.01))
        bounds.append((te_lo, te_hi))           # TE thickness
        x0_values.extend([
            float(np.clip(seed_le, -0.03, 0.10)),
            float(np.clip(seed_te, te_lo, te_hi)),
        ])
        x0 = np.array(x0_values, dtype=float)

    # Clamp x0 to bounds — the seed CST fit can produce values outside the
    # hard limits (e.g. a weight > 0.8 or LE/TE values outside their range).
    # scipy.optimize.differential_evolution raises ValueError if any x0
    # entry lies outside bounds.
    for i, (lo, hi) in enumerate(bounds):
        x0[i] = np.clip(x0[i], lo, hi)

    if not np.all(np.isfinite(x0)):
        raise ValueError("Seed CST fit produced non-finite design variables.")

    # SciPy validates x0 after converting it to its internal unit-space
    # representation. Due to floating-point roundoff, a value that is exactly
    # on a bound in user-space can still end up infinitesimally outside [0, 1].
    # Nudge x0 just inside open intervals and only pass it through when it
    # survives the same normalization check SciPy applies.
    limits = np.asarray(bounds, dtype=float).T
    x0_for_solver = x0.copy()
    equal_bounds = np.isclose(limits[0], limits[1])
    varying = ~equal_bounds
    if np.any(varying):
        interior_lo = np.nextafter(limits[0, varying], limits[1, varying])
        interior_hi = np.nextafter(limits[1, varying], limits[0, varying])
        x0_for_solver[varying] = np.clip(x0_for_solver[varying],
                                         interior_lo, interior_hi)

    centre = 0.5 * (limits[0] + limits[1])
    span = np.abs(limits[1] - limits[0])
    recip_span = np.zeros_like(span)
    recip_span[span > 0.0] = 1.0 / span[span > 0.0]
    x0_scaled = (x0_for_solver - centre) * recip_span + 0.5
    x0_ok = np.all((x0_scaled >= 0.0) & (x0_scaled <= 1.0))

    # ── verify seed scores ~1.0 ──────────────────────────────────────────────
    t0_seed = time.perf_counter()
    seed_obj = objective_func(x0, config)
    t_single_eval = time.perf_counter() - t0_seed
    log.info("seed eval = %.4f  (%.3f s per objective call)", seed_obj, t_single_eval)

    # ── callback wrapper ─────────────────────────────────────────────────────
    # With workers=-1 (multiprocessing), closures that capture mutable state
    # won't synchronise across processes.  Instead, re-evaluate the current
    # best vector once per generation inside the callback (runs in the main
    # process).  One extra eval per generation is negligible vs popsize×N.
    iteration_count = [0]
    best_values = []
    gen_wall_times = []
    _t_gen_start = [time.perf_counter()]

    # NOTE: SciPy's `popsize` is a multiplier on ndim.
    # In the UI we expose a user-friendly "approximate individuals" count.
    pop_user = int(config.get("pop_size", 30))
    ndim = len(bounds)
    popsize_mult = max(1, int(np.ceil(pop_user / max(ndim, 1))))
    pop_n_individuals = popsize_mult * max(ndim, 1)

    def de_callback(xk, convergence):
        now = time.perf_counter()
        gen_dt = now - _t_gen_start[0]
        _t_gen_start[0] = now
        gen_wall_times.append(gen_dt)

        iteration_count[0] += 1
        val = float(objective_func(xk, config))
        best_values.append(val)

        log.info("gen %3d / %d  obj=%.5f  gen_time=%.2f s  (%.3f s/eval)",
                 iteration_count[0], config["max_iter"], val,
                 gen_dt, gen_dt / max(pop_n_individuals, 1))

        if callback is not None:
            callback(iteration_count[0], val, config["max_iter"])
        return False

    # ── differential evolution ───────────────────────────────────────────────
    log.info("starting DE: pop≈%d  pop_mult=%d  pop_actual=%d  maxiter=%d  ndim=%d",
             pop_user, popsize_mult, pop_n_individuals,
             config["max_iter"], len(bounds))
    t0_de = time.perf_counter()

    result_de = differential_evolution(
        objective_func,
        bounds=bounds,
        args=(config,),
        maxiter=config["max_iter"],
        popsize=popsize_mult,
        seed=config.get("random_seed", 42),
        callback=de_callback,
        tol=1e-7,
        mutation=(0.5, 1.5),
        recombination=0.8,
        polish=True,
        updating="deferred",
        workers=_N_WORKERS,
        x0=x0_for_solver if x0_ok else None,
    )

    t_de = time.perf_counter() - t0_de
    if gen_wall_times:
        avg_gen = sum(gen_wall_times) / len(gen_wall_times)
    else:
        avg_gen = 0.0
    log.info("DE finished in %.1f s  (%d gens, avg %.2f s/gen, best=%.5f)",
             t_de, result_de.nit, avg_gen, result_de.fun)

    # ── extract optimised parameters ─────────────────────────────────────────
    best = result_de.x

    # ── optional: re-select best among top candidates at higher fidelity ─────
    # Optimisation uses `config["optim_model_size"]` (default "medium") but
    # display polars use "xlarge". This re-evaluates a small pool of top
    # candidates using "xlarge" *and a baseline computed at that fidelity*,
    # then selects the best of those. This is cheap compared to a full run.
    hf_enabled = bool(config.get("final_high_fidelity", True))
    hf_top_n = int(config.get("final_high_fidelity_top_n", 10))
    best_hf_obj = None
    if hf_enabled:
        try:
            candidates = [np.asarray(best, dtype=float)]
            pop = getattr(result_de, "population", None)
            energies = getattr(result_de, "population_energies", None)
            if pop is not None and energies is not None:
                pop = np.asarray(pop)
                energies = np.asarray(energies).ravel()
                k = int(np.clip(hf_top_n, 1, len(energies)))
                top_idx = np.argsort(energies)[:k]
                for i in top_idx:
                    candidates.append(np.asarray(pop[i], dtype=float))

            # De-duplicate exact vectors
            uniq = []
            seen = set()
            for x in candidates:
                key = tuple(np.round(x, 14))
                if key not in seen:
                    uniq.append(x)
                    seen.add(key)

            config_hf = dict(config)
            config_hf["optim_model_size"] = "xlarge"
            # Recompute baselines at the higher fidelity.
            if component_type == "mast":
                config_hf["_mast_grid"] = build_mast_eval_grid(config_hf)
                obj_hf = mast_objective
            else:
                config_hf["_wing_seed_baselines"] = precompute_wing_seed_baseline(config_hf)
                obj_hf = wing_objective

            vals = [float(obj_hf(x, config_hf)) for x in uniq]
            best_i = int(np.argmin(vals))
            best = uniq[best_i]
            best_hf_obj = float(vals[best_i])
            log.info("high-fidelity reselect: top_n=%d best_obj=%.5f",
                     min(hf_top_n, len(uniq)), best_hf_obj)
        except Exception as e:
            log.warning("high-fidelity reselect skipped (%s)", e)
    if component_type == "mast":
        opt_upper = best[:N_CST].tolist()
        opt_lower = [-w for w in opt_upper]
        opt_le = 0.0
        opt_te = config["te_thickness"]   # was: float(best[N_CST])
    else:
        opt_upper = best[:N_CST].tolist()
        opt_lower = best[N_CST:2 * N_CST].tolist()
        opt_le = float(best[2 * N_CST])
        opt_te = float(best[2 * N_CST + 1])

    opt_coords = cst_to_coordinates(opt_upper, opt_lower, opt_le, opt_te)

    # ── section properties ───────────────────────────────────────────────────
    stiff = config.get("stiffness")
    hollow = (stiff and stiff.get("section_type") == "hollow"
              and stiff.get("wall_thickness_m"))

    if hollow:
        opt_sec = compute_hollow_section_properties(
            opt_coords, config["chord_m"], stiff["wall_thickness_m"])
        seed_sec = compute_hollow_section_properties(
            seed_coords, config["chord_m"], stiff["wall_thickness_m"])
    else:
        opt_sec = compute_section_properties(opt_coords, config["chord_m"])
        seed_sec = compute_section_properties(seed_coords, config["chord_m"])

    # ── polars for display ───────────────────────────────────────────────────
    if "Re_values" in config:
        display_Re = config["Re_values"][len(config["Re_values"]) // 2]
    else:
        display_Re = float(config["operating_points"][0]["Re"])

    # Masts operate at low AoA (leeway angles 0–3°), so a narrow sweep with
    # finer resolution makes the drag differences visible in the plots.
    if component_type == "mast":
        polar_alpha_range = (-5, 5, 0.25)
    else:
        polar_alpha_range = (-5, 15, 0.5)

    # For display, use the middle Ncrit value
    display_ncrit = (config["n_crit"][len(config["n_crit"]) // 2]
                     if isinstance(config["n_crit"], list)
                     else config["n_crit"])

    t0_polars = time.perf_counter()
    opt_polar, opt_alphas = evaluate_polar_sweep(
        opt_upper, opt_lower, opt_le, opt_te,
        Re=display_Re, n_crit=display_ncrit,
        alpha_range=polar_alpha_range,
    )
    seed_polar, seed_alphas = evaluate_polar_sweep(
        seed_upper, seed_lower, seed_le, seed_te,
        Re=display_Re, n_crit=display_ncrit,
        alpha_range=polar_alpha_range,
    )
    log.info("display polars computed in %.2f s (model=xlarge)",
             time.perf_counter() - t0_polars)

    opt_tc, opt_tc_pos = get_tc_from_coords(opt_coords)
    seed_tc, seed_tc_pos = get_tc_from_coords(seed_coords)
    opt_camber, opt_camber_pos = get_camber_from_coords(opt_coords)
    seed_camber, seed_camber_pos = get_camber_from_coords(seed_coords)

    # ── drag improvement summary ─────────────────────────────────────────────
    # Compare zero-alpha Cd between seed and optimised
    seed_cd0 = float(seed_polar["CD"][np.argmin(np.abs(seed_alphas))])
    opt_cd0 = float(opt_polar["CD"][np.argmin(np.abs(opt_alphas))])
    drag_reduction_pct = (1.0 - opt_cd0 / max(seed_cd0, 1e-8)) * 100

    log.info("TOTAL wall-clock: %.1f s", time.perf_counter() - t0_total)

    return {
        "name": f"optimized_{component_type}",
        "optimized_coords": opt_coords,
        "seed_coords": seed_coords,
        "optimized_cst": {"upper": opt_upper, "lower": opt_lower,
                          "le": opt_le, "te": opt_te},
        "opt_section_props": opt_sec,
        "seed_section_props": seed_sec,
        "opt_polar": opt_polar,
        "seed_polar": seed_polar,
        "opt_alphas": opt_alphas,
        "seed_alphas": seed_alphas,
        "opt_tc": opt_tc,
        "opt_tc_pos": opt_tc_pos,
        "seed_tc": seed_tc,
        "seed_tc_pos": seed_tc_pos,
        "opt_camber": opt_camber,
        "opt_camber_pos": opt_camber_pos,
        "seed_camber": seed_camber,
        "seed_camber_pos": seed_camber_pos,
        "best_objective": float(result_de.fun),
        "best_objective_high_fidelity": best_hf_obj,
        "seed_objective": float(seed_obj),
        "drag_reduction_pct": drag_reduction_pct,
        "convergence_history": best_values,
        "n_iterations": int(result_de.nit),
        "display_Re": display_Re,
        "config": config,
    }
