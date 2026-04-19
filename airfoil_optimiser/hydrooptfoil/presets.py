"""
Preset configurations for common hydrofoil use cases.

Mast presets: objective = minimise drag (normalised to seed).
  cpmin_limit : optional Cpmin constraint (None = disabled).
  w_cm : Cm stability penalty weight (0 = ignore).
"""

PRESETS = {
    # ──────────────────────────────────────────────────────────────────────────
    # MAST presets
    # ──────────────────────────────────────────────────────────────────────────
    "mast_downwind_race": {
        "component_type": "mast",
        "label": "Mast — Downwind Race",
        "chord_mm": 110,
        "min_tc_pct": 10.0,
        "max_tc_pct": 13.0,
        "te_thickness_pct": 0.5,
        "speed_min": 8.0,
        "speed_max": 14.0,
        "n_speeds": 4,
        "max_aoa": 1.5,
        "n_aoa": 4,
        "n_crit": 6,
        "cpmin_limit": -2.5,   # strict for high speed
        "w_cm": 0.0,
        # Population is approximate *individuals* per generation (not SciPy multiplier)
        "pop_size": 128,
        "max_iter": 400,
        "final_high_fidelity": True,
        "final_high_fidelity_top_n": 10,
    },
    "mast_wing_allround": {
        "component_type": "mast",
        "label": "Mast — Wing/Surf Allround",
        "chord_mm": 124,
        "min_tc_pct": 12.0,
        "max_tc_pct": 16.0,
        "te_thickness_pct": 0.5,
        "speed_min": 4.0,
        "speed_max": 10.0,
        "n_speeds": 4,
        "max_aoa": 3.0,
        "n_aoa": 5,
        "n_crit": 7,
        "cpmin_limit": None,   # low-speed, ventilation unlikely
        "w_cm": 0.1,
        "pop_size": 96,
        "max_iter": 300,
        "final_high_fidelity": True,
        "final_high_fidelity_top_n": 10,
    },
    "mast_kitefoil": {
        "component_type": "mast",
        "label": "Mast — Kitefoil",
        "chord_mm": 100,
        "min_tc_pct": 10.0,
        "max_tc_pct": 12.5,
        "te_thickness_pct": 0.5,
        "speed_min": 10.0,
        "speed_max": 20.0,
        "n_speeds": 4,
        "max_aoa": 1.0,
        "n_aoa": 3,
        "n_crit": 5,
        "cpmin_limit": -2.0,   # very strict — high-speed ventilation
        "w_cm": 0.0,
        "pop_size": 128,
        "max_iter": 400,
        "final_high_fidelity": True,
        "final_high_fidelity_top_n": 10,
    },

    # ──────────────────────────────────────────────────────────────────────────
    # FRONT WING presets
    # ──────────────────────────────────────────────────────────────────────────
    "front_wing_allround": {
        "component_type": "front_wing",
        "label": "Front Wing — Allround",
        "chord_mm": 180,
        "min_tc_pct": 9.0,
        "max_tc_pct": 14.0,
        "n_crit": 7,
        "n_op_points": 3,
        "operating_points": [
            {"name": "Cruise",     "Re": 800000,  "target_cl": 0.6,
             "objective": "max_cl_cd", "weight": 0.5},
            {"name": "High speed", "Re": 1200000, "target_cl": 0.3,
             "objective": "min_cd",    "weight": 0.3},
            {"name": "Low speed",  "Re": 400000,  "target_cl": 0.9,
             "objective": "min_cd",    "weight": 0.2},
        ],
        "cm_limit": 0.10,
        "cm_limit_alpha": 0.0,
        "dcm_dcl_limit": None,
        "dcm_dcl_tolerance_pct": 10,
        "dcm_dcl_cl_min": -1.0,
        "dcm_dcl_cl_max": 1.0,
        "pop_size": 180,
        "max_iter": 400,
        "final_high_fidelity": True,
        "final_high_fidelity_top_n": 12,
    },
    "front_wing_pump": {
        "component_type": "front_wing",
        "label": "Front Wing — Pump/DW",
        "chord_mm": 200,
        "min_tc_pct": 8.0,
        "max_tc_pct": 12.0,
        "n_crit": 7,
        "n_op_points": 3,
        "operating_points": [
            {"name": "Pump",        "Re": 500000, "target_cl": 0.9,
             "objective": "max_cl_cd", "weight": 0.5},
            {"name": "Glide",       "Re": 800000, "target_cl": 0.4,
             "objective": "min_cd",    "weight": 0.3},
            {"name": "Stall margin","Re": 300000, "target_cl": 1.2,
             "objective": "max_cl",    "weight": 0.2},
        ],
        "cm_limit": None,  # pump foils: Cm less critical
        "cm_limit_alpha": 0.0,
        "dcm_dcl_limit": None,
        "dcm_dcl_tolerance_pct": 10,
        "dcm_dcl_cl_min": -1.0,
        "dcm_dcl_cl_max": 1.0,
        "pop_size": 180,
        "max_iter": 400,
        "final_high_fidelity": True,
        "final_high_fidelity_top_n": 12,
    },
}
