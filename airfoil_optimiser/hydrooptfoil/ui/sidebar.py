"""
Sidebar configuration panels for HydroOptFoil.

``render_sidebar()`` builds every control and returns a configuration dict
that the rest of the app consumes.
"""

import streamlit as st
import numpy as np

from ui.airfoil_library import AIRFOIL_LIBRARY, get_airfoil_coordinates
from presets import PRESETS
from core.fluid_properties import water_kinematic_viscosity

def render_sidebar():
    """Render all sidebar controls.  Always returns a config dict."""

    with st.sidebar:
        st.header("Configuration")

        # ── Component type ───────────────────────────────────────────────────
        component_type = st.selectbox(
            "Component Type",
            ["Mast", "Front Wing"],
            help=("Mast: symmetric section, minimises drag.  "
                  "Front Wing: cambered, optimises lift/drag."),
        )

        # ── Preset ───────────────────────────────────────────────────────────
        ct_key = component_type.lower().replace(" ", "_")
        preset_names = ["Custom"] + [
            k for k, v in PRESETS.items() if v["component_type"] == ct_key
        ]
        selected_preset = st.selectbox("Preset", preset_names)
        preset = PRESETS[selected_preset] if selected_preset != "Custom" else {}

        # ── Seed airfoil ─────────────────────────────────────────────────────
        with st.expander("Seed Airfoil", expanded=True):
            airfoil_source = st.radio("Source", ["Library", "Upload .dat"],
                                      horizontal=True)

            if airfoil_source == "Library":
                if component_type == "Mast":
                    choices = ["NACA 0012", "NACA 0010", "NACA 0015",
                               "NACA 63-012", "NACA 63-010", "NACA 66-012"]
                else:
                    choices = ["NACA 4412", "NACA 2412", "NACA 6412",
                               "NACA 63-412", "SD7003", "E387"]
                selected_airfoil = st.selectbox("Airfoil", choices)
            else:
                uploaded = st.file_uploader("Upload .dat file",
                                            type=["dat", "txt"])
                selected_airfoil = uploaded  # may be None

        # ── Geometry ─────────────────────────────────────────────────────────
        with st.expander("Geometry", expanded=True):
            chord_mm = st.number_input(
                "Chord (mm)", min_value=50, max_value=300,
                value=int(preset.get("chord_mm", 124)), step=1,
                help="Physical chord length in mm")
            chord_m = chord_mm / 1000.0

            from core.cst_geometry import (get_tc_from_coords,
                                           get_camber_from_coords,
                                           get_region_mean_thickness,
                                           get_thickness_at_stations)
            seed_tc_pct = None
            seed_tc_pos_pct = None
            seed_camber_pct = None
            seed_camber_pos_pct = None
            seed_le_band_pct = None
            seed_te_band_pct = None
            seed_le_profile = None
            seed_te_profile = None
            # Avoid x/c = 0.0 exactly: thickness is ~0 there and numerical noise
            # can make tight bands reject almost everything (causing DE to
            # "converge" immediately on a constant-penalty objective).
            le_lock_x = np.linspace(0.005, 0.05, 9)
            te_lock_x = np.linspace(0.85, 1.0, 13)
            if selected_airfoil is not None:
                try:
                    _seed_coords = get_airfoil_coordinates(selected_airfoil)
                    _seed_tc, _seed_tc_pos = get_tc_from_coords(_seed_coords)
                    seed_tc_pct = round(_seed_tc * 100, 2)
                    seed_tc_pos_pct = round(_seed_tc_pos * 100, 1)
                    _seed_cam, _seed_cam_pos = get_camber_from_coords(
                        _seed_coords)
                    seed_camber_pct = round(_seed_cam * 100, 2)
                    seed_camber_pos_pct = round(_seed_cam_pos * 100, 1)
                    seed_le_band_pct = round(
                        get_region_mean_thickness(_seed_coords, 0.0, 0.05) * 100, 2)
                    seed_te_band_pct = round(
                        get_region_mean_thickness(_seed_coords, 0.85, 1.0) * 100, 2)
                    seed_le_profile = get_thickness_at_stations(
                        _seed_coords, le_lock_x)
                    seed_te_profile = get_thickness_at_stations(
                        _seed_coords, te_lock_x)
                except Exception:
                    pass

            lock_tc = st.checkbox(
                f"Lock thickness to seed"
                + (f" ({seed_tc_pct:.1f}%)" if seed_tc_pct else ""),
                value=False,
                help="Constrain min/max t/c to the seed airfoil's thickness "
                     "so the optimiser only changes the shape, not the thickness.")

            if lock_tc and seed_tc_pct is not None:
                # Allow a tiny ±0.15% tolerance for the optimiser to work
                _tol = 0.15
                min_tc = max(seed_tc_pct - _tol, 5.0)
                max_tc = min(seed_tc_pct + _tol, 25.0)
                st.caption(f"t/c locked: {min_tc:.2f}% – {max_tc:.2f}%")
            else:
                c1, c2 = st.columns(2)
                with c1:
                    min_tc = st.number_input(
                        "Min t/c %", min_value=5.0, max_value=25.0,
                        value=float(preset.get("min_tc_pct",
                                               10.0 if component_type == "Mast" else 8.0)),
                        step=0.5, format="%.1f")
                with c2:
                    max_tc = st.number_input(
                        "Max t/c %", min_value=5.0, max_value=25.0,
                        value=float(preset.get("max_tc_pct",
                                               16.0 if component_type == "Mast" else 14.0)),
                        step=0.5, format="%.1f")

            # ── shape locks ──
            st.markdown("**Shape Locks**")
            _seed_pos_label = (f"  *(seed: {seed_tc_pos_pct:.0f}% chord)*"
                               if seed_tc_pos_pct is not None else "")
            st.caption(f"Max-thickness position{_seed_pos_label}")

            max_tc_pos_bounds = None
            _tc_pos_lo = None
            _tc_pos_hi = None

            tc_col1, tc_col2 = st.columns(2)
            with tc_col1:
                _default_fwd = 0.0
                if seed_tc_pos_pct is not None:
                    _default_fwd = max(5.0, seed_tc_pos_pct - 12.0)
                _tc_pos_lo_input = st.number_input(
                    "No further forward than (% c)",
                    min_value=0.0, max_value=60.0,
                    value=_default_fwd, step=1.0, format="%.0f",
                    help="Minimum chordwise position for max thickness. "
                         "0 = no constraint.")
                if _tc_pos_lo_input > 0:
                    _tc_pos_lo = _tc_pos_lo_input / 100.0
            with tc_col2:
                _default_aft = 0.0
                if seed_tc_pos_pct is not None:
                    _default_aft = min(65.0, seed_tc_pos_pct + 12.0)
                _tc_pos_hi_input = st.number_input(
                    "No further back than (% c)",
                    min_value=0.0, max_value=70.0,
                    value=_default_aft, step=1.0, format="%.0f",
                    help="Maximum chordwise position for max thickness. "
                         "0 = no constraint.")
                if _tc_pos_hi_input > 0:
                    _tc_pos_hi = _tc_pos_hi_input / 100.0

            if _tc_pos_lo is not None or _tc_pos_hi is not None:
                max_tc_pos_bounds = (
                    _tc_pos_lo if _tc_pos_lo is not None else 0.0,
                    _tc_pos_hi if _tc_pos_hi is not None else 1.0,
                )

            st.caption("Edge shape locks  *(mean thickness over first 5% / last 15% chord)*")
            le_thickness_lock = None
            te_thickness_lock = None
            edge_col1, edge_col2 = st.columns(2)
            with edge_col1:
                le_mode = st.selectbox(
                    "LE lock mode",
                    ["Off", "Absolute (± % chord)", "Relative (± % of seed)"],
                    index=0,
                    help="Absolute: adds/subtracts a fixed thickness band in chord fraction "
                         "at each station. Relative: allows ±X% change relative to the seed "
                         "thickness at each station (more uniform protection near the nose).",
                )
                le_tol_pct = 0.0
                le_tol_rel_pct = 0.0
                if le_mode == "Absolute (± % chord)":
                    le_tol_pct = st.number_input(
                        "LE tolerance (± % chord)",
                        min_value=0.0, max_value=3.0,
                        value=0.0, step=0.05, format="%.2f",
                        help="Constrains the thickness over the first 5% chord "
                             "to stay within a band around the seed. 0 = disabled.",
                    )
                elif le_mode == "Relative (± % of seed)":
                    le_tol_rel_pct = st.number_input(
                        "LE tolerance (± % of seed)",
                        min_value=0.0, max_value=80.0,
                        value=25.0, step=5.0, format="%.0f",
                        help="Constrains thickness at each LE station to remain within "
                             "±X% of the seed thickness there. 0 = disabled.",
                    )

                if seed_le_band_pct is not None and seed_le_profile is not None:
                    if le_mode == "Absolute (± % chord)" and le_tol_pct > 0:
                        le_lo = max(seed_le_band_pct - le_tol_pct, 0.0)
                        le_hi = seed_le_band_pct + le_tol_pct
                        le_tol = le_tol_pct / 100.0
                        le_thickness_lock = {
                            "x": le_lock_x.tolist(),
                            "lower": np.maximum(seed_le_profile - le_tol, 0.0).tolist(),
                            "upper": (seed_le_profile + le_tol).tolist(),
                        }
                        st.caption(
                            f"Seed LE band: {seed_le_band_pct:.2f}%  ->  "
                            f"{le_lo:.2f}% to {le_hi:.2f}%"
                        )
                    elif le_mode == "Relative (± % of seed)" and le_tol_rel_pct > 0:
                        frac = le_tol_rel_pct / 100.0
                        lo = np.maximum(seed_le_profile * (1.0 - frac), 0.0)
                        hi = seed_le_profile * (1.0 + frac)
                        le_thickness_lock = {
                            "x": le_lock_x.tolist(),
                            "lower": lo.tolist(),
                            "upper": hi.tolist(),
                        }
                        st.caption(
                            f"Seed LE band: {seed_le_band_pct:.2f}%  ->  "
                            f"±{le_tol_rel_pct:.0f}% of seed at each station"
                        )
                elif seed_le_band_pct is not None:
                    st.caption(f"Seed LE band: {seed_le_band_pct:.2f}%")
            with edge_col2:
                te_tol_pct = st.number_input(
                    "TE tolerance (± % chord)",
                    min_value=0.0, max_value=3.0,
                    value=0.0, step=0.05, format="%.2f",
                    help="Constrains the mean thickness over the last 15% chord "
                         "to stay within a band around the seed. 0 = disabled.")
                if seed_te_band_pct is not None and te_tol_pct > 0:
                    te_lo = max(seed_te_band_pct - te_tol_pct, 0.0)
                    te_hi = seed_te_band_pct + te_tol_pct
                    te_tol = te_tol_pct / 100.0
                    te_thickness_lock = {
                        "x": te_lock_x.tolist(),
                        "lower": np.maximum(seed_te_profile - te_tol, 0.0).tolist(),
                        "upper": (seed_te_profile + te_tol).tolist(),
                    }
                    st.caption(f"Seed TE band: {seed_te_band_pct:.2f}%  ->  {te_lo:.2f}% to {te_hi:.2f}%")
                elif seed_te_band_pct is not None:
                    st.caption(f"Seed TE band: {seed_te_band_pct:.2f}%")

            # Camber constraints (front wing only)
            max_camber_bounds = None
            max_camber_pos_bounds = None

            if component_type == "Front Wing":
                st.divider()
                _seed_cam_label = (
                    f"  *(seed: {seed_camber_pct:.1f}% @ "
                    f"{seed_camber_pos_pct:.0f}% chord)*"
                    if seed_camber_pct is not None else "")
                st.caption(f"Camber{_seed_cam_label}")

                _cam_hi_default = 0.0
                if seed_camber_pct is not None:
                    _cam_hi_default = min(12.0,
                                          max(2.0, seed_camber_pct + 2.0))
                max_camber_input = st.number_input(
                    "Max camber (% chord)",
                    min_value=0.0, max_value=12.0,
                    value=_cam_hi_default, step=0.5, format="%.1f",
                    help="Upper limit on camber magnitude. 0 = no limit.")
                if max_camber_input > 0:
                    max_camber_bounds = (0.0, max_camber_input / 100.0)

                _cam_pos_lo = None
                _cam_pos_hi = None
                cam_col1, cam_col2 = st.columns(2)
                with cam_col1:
                    _cp_fwd_default = 0.0
                    if seed_camber_pos_pct is not None:
                        _cp_fwd_default = max(5.0,
                                              seed_camber_pos_pct - 15.0)
                    _cp_lo_input = st.number_input(
                        "Camber no further fwd (% c)",
                        min_value=0.0, max_value=70.0,
                        value=_cp_fwd_default, step=1.0, format="%.0f",
                        help="Min chordwise position for max camber. "
                             "0 = no constraint.")
                    if _cp_lo_input > 0:
                        _cam_pos_lo = _cp_lo_input / 100.0
                with cam_col2:
                    _cp_aft_default = 0.0
                    if seed_camber_pos_pct is not None:
                        _cp_aft_default = min(75.0,
                                              seed_camber_pos_pct + 15.0)
                    _cp_hi_input = st.number_input(
                        "Camber no further back (% c)",
                        min_value=0.0, max_value=80.0,
                        value=_cp_aft_default, step=1.0, format="%.0f",
                        help="Max chordwise position for max camber. "
                             "0 = no constraint.")
                    if _cp_hi_input > 0:
                        _cam_pos_hi = _cp_hi_input / 100.0

                if _cam_pos_lo is not None or _cam_pos_hi is not None:
                    max_camber_pos_bounds = (
                        _cam_pos_lo if _cam_pos_lo is not None else 0.0,
                        _cam_pos_hi if _cam_pos_hi is not None else 1.0,
                    )

            # ── trailing-edge thickness ──
            st.divider()
            if component_type == "Mast":
                te_thickness_pct = st.number_input(
                    "TE thickness (% chord)",
                    min_value=0.1, max_value=1.5,
                    value=float(preset.get("te_thickness_pct", 0.5)),
                    step=0.1, format="%.1f",
                    help="Fixed trailing-edge gap as % of chord. "
                         "0.5% is typical for hydrofoil masts "
                         "(≈0.5–0.6 mm on a 120 mm chord).")
                st.caption(
                    f"= {chord_mm * te_thickness_pct / 100:.1f} mm")
            else:
                te_col1, te_col2 = st.columns(2)
                with te_col1:
                    min_te_pct = st.number_input(
                        "Min TE thickness (% chord)",
                        min_value=0.1, max_value=1.5,
                        value=0.3, step=0.1, format="%.1f",
                        help="Minimum trailing-edge gap. 0.3% = "
                             f"{chord_mm * 0.3 / 100:.1f} mm. Prevents "
                             "knife-edge TEs that are fragile and "
                             "unmanufacturable.")
                with te_col2:
                    max_te_pct = st.number_input(
                        "Max TE thickness (% chord)",
                        min_value=0.2, max_value=2.0,
                        value=1.0, step=0.1, format="%.1f",
                        help="Maximum trailing-edge gap.")
                st.caption(
                    f"= {chord_mm * min_te_pct / 100:.1f} – "
                    f"{chord_mm * max_te_pct / 100:.1f} mm")

            st.caption("CST coefficients per side: **8** (fixed by NeuralFoil)")

        # ── Operating conditions ─────────────────────────────────────────────
        with st.expander("Operating Conditions", expanded=True):
            water_temp = st.number_input("Water temp (deg C)", value=20,
                                         min_value=0, max_value=40)
            nu = water_kinematic_viscosity(water_temp)
            st.caption(f"\u03BD = {nu:.3e} m\u00b2/s")

            if component_type == "Mast":
                speed_min = st.number_input(
                    "Min speed (m/s)",
                    value=float(preset.get("speed_min", 4.0)), step=0.5)
                speed_max = st.number_input(
                    "Max speed (m/s)",
                    value=float(preset.get("speed_max", 12.0)), step=0.5)
                n_speeds = st.slider("Speed points", 2, 6,
                                     value=int(preset.get("n_speeds", 4)))

                speeds = np.linspace(speed_min, speed_max, n_speeds)
                Re_values = speeds * chord_m / nu
                st.caption(
                    f"Re range: {Re_values[0]/1e6:.2f} M - {Re_values[-1]/1e6:.2f} M")

                max_aoa = st.slider(
                    "Max AoA (deg)", 0.5, 5.0,
                    value=float(preset.get("max_aoa", 2.0)), step=0.5,
                    help="Mast AoA range: 0 deg to this value.")
                n_aoa = st.slider("AoA points", 2, 6,
                                  value=int(preset.get("n_aoa", 4)))
                multi_ncrit = st.checkbox(
                    "Multi-Ncrit averaging",
                    value=True,
                    help="Average across multiple Ncrit values for robustness "
                         "to transition uncertainty.  Maarten uses 0.5–2.0.")

                if multi_ncrit:
                    ncrit_col1, ncrit_col2 = st.columns(2)
                    with ncrit_col1:
                        ncrit_min = st.number_input(
                            "Ncrit min", value=0.5,
                            min_value=0.0, max_value=11.0,
                            step=0.5, format="%.1f")
                    with ncrit_col2:
                        ncrit_max = st.number_input(
                            "Ncrit max", value=2.0,
                            min_value=0.5, max_value=12.0,
                            step=0.5, format="%.1f")
                    n_ncrit = st.slider("Ncrit points", 2, 6, value=4)
                    n_crit_values = np.linspace(ncrit_min, ncrit_max, n_ncrit).tolist()
                    st.caption(f"Ncrit: {', '.join(f'{v:.1f}' for v in n_crit_values)}")
                    n_crit = n_crit_values  # list
                else:
                    n_crit = st.slider(
                        "n_crit (turbulence)", 1, 12,
                        value=int(preset.get("n_crit", 7)),
                        help="Lower = more turbulent.  Underwater: 5-7.  Air: 9-12.")
                    n_crit = float(n_crit)  # single value
            else:
                n_op_points = st.number_input(
                    "Number of operating points", 1, 6,
                    value=int(preset.get("n_op_points", 3)))
                default_ops = preset.get("operating_points", [
                    {"name": "Cruise", "Re": 800000,
                     "target_cl": 0.6, "objective": "max_cl_cd", "weight": 0.5},
                    {"name": "High speed", "Re": 1200000,
                     "target_cl": 0.3, "objective": "min_cd", "weight": 0.3},
                    {"name": "Low speed", "Re": 400000,
                     "target_cl": 0.9, "objective": "min_cd", "weight": 0.2},
                ])
                op_points = []
                for i in range(n_op_points):
                    d = default_ops[i] if i < len(default_ops) else default_ops[-1]
                    st.markdown(f"**Point {i + 1}**")
                    # Row 1: Re + Target Cl
                    r1a, r1b = st.columns(2)
                    with r1a:
                        re = st.number_input(
                            f"Re  #{i+1}", value=int(d["Re"]),
                            step=100000, key=f"re_{i}",
                            label_visibility="collapsed")
                        st.caption("Reynolds")
                    with r1b:
                        tcl = st.number_input(
                            f"Cl  #{i+1}", value=float(d["target_cl"]),
                            step=0.1, key=f"cl_{i}", format="%.2f",
                            label_visibility="collapsed")
                        st.caption("Target Cl")
                    # Row 2: Objective + Weight
                    r2a, r2b = st.columns(2)
                    with r2a:
                        obj_choices = ["min_cd", "max_cl_cd", "max_cl"]
                        obj = st.selectbox(
                            f"Obj  #{i+1}", obj_choices,
                            index=obj_choices.index(d["objective"]),
                            key=f"obj_{i}", label_visibility="collapsed")
                        st.caption("Objective")
                    with r2b:
                        w = st.number_input(
                            f"W  #{i+1}", value=float(d["weight"]),
                            step=0.1, key=f"w_{i}", format="%.1f",
                            label_visibility="collapsed",
                            min_value=0.0, max_value=2.0)
                        st.caption("Weight")
                    op_points.append({"Re": re, "target_cl": tcl,
                                      "objective": obj, "weight": w})

                multi_ncrit = st.checkbox(
                    "Multi-Ncrit averaging",
                    value=True,
                    help="Average across multiple Ncrit values for robustness "
                         "to transition uncertainty.")

                if multi_ncrit:
                    ncrit_col1, ncrit_col2 = st.columns(2)
                    with ncrit_col1:
                        ncrit_min = st.number_input(
                            "Ncrit min", value=0.5,
                            min_value=0.0, max_value=11.0,
                            step=0.5, format="%.1f",
                            key="wing_ncrit_min")
                    with ncrit_col2:
                        ncrit_max = st.number_input(
                            "Ncrit max", value=3.0,
                            min_value=0.5, max_value=12.0,
                            step=0.5, format="%.1f",
                            key="wing_ncrit_max")
                    n_ncrit = st.slider("Ncrit points", 2, 6, value=4,
                                        key="wing_n_ncrit")
                    n_crit_values = np.linspace(ncrit_min, ncrit_max,
                                                n_ncrit).tolist()
                    st.caption(
                        f"Ncrit: {', '.join(f'{v:.1f}' for v in n_crit_values)}")
                    n_crit = n_crit_values
                else:
                    n_crit = st.slider(
                        "n_crit (turbulence)", 0, 12,
                        value=int(preset.get("n_crit", 7)),
                        key="wing_ncrit_single")
                    n_crit = float(n_crit)

        # ── Constraints & secondary objectives ─────────────────────────────
        cm_limit = None
        cm_limit_alpha = 0.0
        if component_type == "Mast":
            with st.expander("Constraints & Penalties"):
                st.caption("Primary objective: **minimise drag** (normalised to seed).")
                enable_cpmin = st.checkbox(
                    "Ventilation constraint (Cpmin limit)",
                    value=bool(preset.get("cpmin_limit")),
                    help="Penalise designs whose suction peak exceeds a threshold.")
                cpmin_limit = None
                if enable_cpmin:
                    cpmin_limit = st.number_input(
                        "Cpmin limit", value=float(preset.get("cpmin_limit", -0.5)),
                        min_value=-5.0, max_value=-0.1, step=0.1, format="%.1f",
                        help="Speed-weighted average Cpmin at α ≤ 1° must stay "
                             "above this. Maarten targets −0.3 (very strict). "
                             "−0.5 = moderate, −1.0 = relaxed.")

                w_cm = st.slider(
                    "Cm stability penalty", 0.0, 1.0,
                    value=float(preset.get("w_cm", 0.0)), step=0.1,
                    help="0 = ignore pitching moment.  "
                         "0.3 = soft penalty if Cm gets worse than seed.")

                cd_regression_pct = st.number_input(
                    "Max CD regression at low AoA (%)",
                    value=5.0, min_value=0.0, max_value=50.0, step=1.0,
                    help="Reject designs with CD more than this % worse than "
                         "the seed at α ≤ 1°. 0 = must match or beat seed.")

                cm_regression_abs = st.number_input(
                    "Max CM regression at low AoA (abs)",
                    value=0.001, min_value=0.0, max_value=0.01,
                    step=0.0005, format="%.4f",
                    help="Max allowable increase in |CM| vs seed at α ≤ 1°. "
                         "Maarten's sections have |CM| < 0.001 across 0-2°.")

        if component_type == "Front Wing":
            with st.expander("Constraints & Penalties"):
                st.caption("Primary objective: **weighted multi-point aero score** "
                           "(normalised to seed).")

                enable_cm_limit = st.checkbox(
                    "Cm constraint (absolute limit)",
                    value=preset.get("cm_limit") is not None,
                    help="Reject designs whose |Cm| at a reference AoA "
                         "exceeds a threshold.")
                if enable_cm_limit:
                    cm_col1, cm_col2 = st.columns(2)
                    with cm_col1:
                        cm_limit = st.number_input(
                            "Max |Cm|", value=float(preset.get("cm_limit", 0.10)),
                            min_value=-1.0, max_value=1.0,
                            step=0.01, format="%.2f",
                            help="Absolute Cm magnitude limit (sign ignored). "
                                 "Typical cambered foils: 0.05–0.12; negative OK.")
                    with cm_col2:
                        cm_limit_alpha = st.number_input(
                            "At AoA (deg)", value=float(preset.get("cm_limit_alpha", 0.0)),
                            min_value=-5.0, max_value=10.0,
                            step=0.5, format="%.1f",
                            help="Reference angle of attack for the Cm check. "
                                 "0° is typical for cruise trim assessment.")

                enable_dcm_dcl = st.checkbox(
                    "dCm/dCl stability constraint",
                    value=preset.get("dcm_dcl_limit") is not None,
                    help="Penalise designs whose |dCm/dCl| is worse than the seed's "
                         "by more than a tolerance. dCm/dCl is estimated via a "
                         "linear regression of Cm vs Cl over a specified Cl window.",
                )
                dcm_dcl_limit = None
                dcm_dcl_cl_range = (-1.0, 1.0)
                if enable_dcm_dcl:
                    tol_pct = st.number_input(
                        "Max dCm/dCl tolerance vs seed (%)",
                        min_value=0, max_value=50,
                        value=int(preset.get("dcm_dcl_tolerance_pct", 10)),
                        step=5,
                        help="How much worse than the seed's |dCm/dCl| is allowed. "
                             "0% = must match or beat seed.",
                    )
                    dcm_dcl_limit = float(tol_pct) / 100.0
                    r1, r2 = st.columns(2)
                    with r1:
                        cl_min = st.number_input(
                            "Cl range min", value=float(preset.get("dcm_dcl_cl_min", -1.0)),
                            step=0.1, format="%.1f")
                    with r2:
                        cl_max = st.number_input(
                            "Cl range max", value=float(preset.get("dcm_dcl_cl_max", 1.0)),
                            step=0.1, format="%.1f")
                    dcm_dcl_cl_range = (float(cl_min), float(cl_max))

                    seed_slope = None
                    try:
                        seed_slope = (st.session_state.get("result", {})
                                      .get("config", {})
                                      .get("_seed_dcm_dcl", None))
                    except Exception:
                        seed_slope = None
                    if seed_slope is not None:
                        st.caption(f"Seed dCm/dCl (estimated): {seed_slope:.4f}")
                    else:
                        st.caption("Seed dCm/dCl will be computed when you run optimisation.")

        # ── Stiffness (optional) ─────────────────────────────────────────────
        with st.expander("Stiffness (Optional)", expanded=False):
            enable_stiffness = st.checkbox("Enable stiffness optimisation",
                                           value=False)
            section_type = "Solid"
            wall_thickness_mm = None
            tolerance_pct = 10.0
            one_sided = True
            w_bending = 0.5
            w_torsion = 0.5

            if enable_stiffness:
                section_type = st.radio("Section type",
                                       ["Solid", "Hollow"], horizontal=True)
                if section_type == "Hollow":
                    wall_thickness_mm = st.number_input(
                        "Wall thickness (mm)", value=3.0,
                        min_value=0.5, max_value=10.0, step=0.5)
                tolerance_pct = st.slider(
                    "Tolerance (%)", 0.0, 30.0, 10.0, step=1.0,
                    help="Candidates losing more than this % vs seed get penalty.")
                one_sided = st.checkbox(
                    "One-sided (penalise loss only)", value=True,
                    help="Gains above seed are free; only penalise drops.")
                sc1, sc2 = st.columns(2)
                with sc1:
                    w_bending = st.slider("Bending weight", 0.0, 1.0, 0.5, 0.1)
                with sc2:
                    w_torsion = st.slider("Torsion weight", 0.0, 1.0, 0.5, 0.1)

        # ── Shape quality ─────────────────────────────────────────────────────
        with st.expander("Shape Quality", expanded=False):
            w_smoothness = st.slider(
                "Smoothness penalty", 0.0, 1.0,
                value=float(preset.get("w_smoothness", 0.2)), step=0.05,
                help="Penalises oscillatory CST weight patterns that create "
                     "surface wiggles. 0 = no penalty. 0.1\u20130.3 = "
                     "recommended. 0.5+ = very conservative.")
            w_pressure_recovery = st.slider(
                "Pressure recovery penalty", 0.0, 1.0,
                value=float(preset.get("w_pressure_recovery", 0.0)),
                step=0.05,
                help="Penalises aggressive upper-surface pressure recovery "
                     "(steep adverse gradients and Cp reversals aft of the "
                     "suction peak). Discourages designs that look good in "
                     "NeuralFoil but would separate in real flow. "
                     "0 = disabled. 0.15\u20130.25 = gentle. 0.4+ = strong.")
            cst_bound_range = st.slider(
                "CST weight range (\u00b1)", 0.10, 0.50,
                value=float(preset.get("cst_bound_range", 0.25)), step=0.05,
                help="How far each CST weight can deviate from the seed "
                     "value. Smaller = safer shapes, larger = more design "
                     "freedom.")

        # ── Optimiser settings ───────────────────────────────────────────────
        with st.expander("Optimiser Settings"):
            # SciPy DE uses `popsize` as a multiplier on ndim, not a literal count.
            # We let the user choose an approximate *individuals* count, then the
            # solver converts it to `pop_mult = ceil(pop / ndim)`.
            pop_size = st.slider(
                "Population (approx. individuals)",
                16, 400,
                value=int(preset.get("pop_size", 120)),
                step=8,
                help="Approximate number of individuals per generation. "
                     "Internally SciPy uses a multiplier on ndim: "
                     "pop_mult = ceil(pop / ndim), so actual = pop_mult * ndim.",
            )
            max_iter = st.slider("Max iterations", 50, 2000,
                                 value=int(preset.get("max_iter", 300)), step=50)
            random_seed = st.number_input("Random seed", value=42, step=1)

            ct = "mast" if component_type == "Mast" else "front_wing"
            ndim_est = 8 if ct == "mast" else 18
            pop_mult_est = int(np.ceil(pop_size / max(ndim_est, 1)))
            pop_actual_est = pop_mult_est * ndim_est
            st.caption(
                f"DE dims ≈ {ndim_est} → pop_mult={pop_mult_est}, "
                f"actual individuals ≈ {pop_actual_est}."
            )

        with st.expander("Surrogate Fidelity", expanded=False):
            final_high_fidelity = st.checkbox(
                "Re-select final design using xlarge surrogate",
                value=bool(preset.get("final_high_fidelity", True)),
                help="After the main run (usually using a faster model), "
                     "re-evaluate the best few candidates using the xlarge model "
                     "and pick the best of them. Helps avoid medium↔xlarge "
                     "surface mismatches.",
            )
            final_high_fidelity_top_n = st.slider(
                "High-fidelity candidate count",
                3, 30,
                value=int(preset.get("final_high_fidelity_top_n", 10)),
                step=1,
                help="How many top candidates from the final DE population to "
                     "re-evaluate with xlarge.",
            )

        st.divider()

        if st.button("Run Optimization", type="primary",
                     width="stretch"):
            st.session_state["run_requested"] = True

        if st.button("Reset", width="stretch"):
            for k in ["result", "run_requested"]:
                st.session_state.pop(k, None)
            st.rerun()

    # ── assemble config dict ─────────────────────────────────────────────────
    config = {
        "component_type": ct_key,
        "seed_airfoil": selected_airfoil,
        "chord_m": chord_m,
        "chord_mm": chord_mm,
        "min_tc": min_tc / 100.0,
        "max_tc": max_tc / 100.0,
        "max_tc_pos_bounds": max_tc_pos_bounds,
        "max_camber_bounds": max_camber_bounds,
        "max_camber_pos_bounds": max_camber_pos_bounds,
        "le_thickness_lock": le_thickness_lock,
        "te_thickness_lock": te_thickness_lock,
        "n_crit": n_crit,
        "nu": nu,
        "w_smoothness": w_smoothness,
        "w_pressure_recovery": w_pressure_recovery,
        "cst_bound_range": cst_bound_range,
        "pop_size": pop_size,
        "max_iter": max_iter,
        "random_seed": random_seed,
        "final_high_fidelity": final_high_fidelity,
        "final_high_fidelity_top_n": final_high_fidelity_top_n,
    }

    if component_type == "Mast":
        config.update({
            "speeds": speeds.tolist(),
            "Re_values": Re_values.tolist(),
            "max_aoa": max_aoa,
            "n_aoa": n_aoa,
            "cpmin_limit": cpmin_limit,    # None = disabled
            "w_cm": w_cm,
            "cd_regression_pct": cd_regression_pct,
            "cm_regression_abs": cm_regression_abs,
            "te_thickness": te_thickness_pct / 100.0,
        })
    else:
        config["operating_points"] = op_points
        config["cm_limit"] = cm_limit if component_type == "Front Wing" else None
        config["cm_limit_alpha"] = cm_limit_alpha if component_type == "Front Wing" else 0.0
        config["dcm_dcl_limit"] = dcm_dcl_limit if component_type == "Front Wing" else None
        config["dcm_dcl_cl_range"] = dcm_dcl_cl_range
        config["min_te_thickness"] = min_te_pct / 100.0
        config["max_te_thickness"] = max_te_pct / 100.0

    if enable_stiffness:
        config["stiffness"] = {
            "section_type": section_type.lower(),
            "wall_thickness_m": (wall_thickness_mm / 1000.0
                                 if wall_thickness_mm else None),
            "tolerance_pct": tolerance_pct,
            "one_sided": one_sided,
            "w_bending": w_bending,
            "w_torsion": w_torsion,
        }

    return config
