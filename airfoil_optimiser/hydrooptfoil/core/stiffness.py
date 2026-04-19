"""
Stiffness constraint: single ±% band relative to seed.

Seed Ixx, Iyy, J are computed once as reference values. Candidates that lose
more than tolerance_pct get a quadratic penalty: 50 * (violation / tolerance)².
One-sided by default (penalise loss only; gains are free).

Config keys: tolerance_pct, one_sided, w_bending, w_torsion, section_type,
wall_thickness_m, Ixx_ref, Iyy_ref, J_ref.
"""


def apply_stiffness(aero_score, section_props, config):
    """
    Apply stiffness penalty: quadratic penalty when Ixx or J drop more than
    tolerance_pct below seed reference. Returns scalar objective (lower = better).
    """
    stiffness_cfg = config.get("stiffness")
    if stiffness_cfg is None:
        return aero_score

    tolerance_pct = stiffness_cfg.get("tolerance_pct", 10.0) / 100.0
    one_sided = stiffness_cfg.get("one_sided", True)
    w_bending = stiffness_cfg.get("w_bending", 0.5)
    w_torsion = stiffness_cfg.get("w_torsion", 0.5)

    Ixx_ref = stiffness_cfg.get("Ixx_ref", 1e-9)
    Iyy_ref = stiffness_cfg.get("Iyy_ref", 1e-9)
    J_ref = stiffness_cfg.get("J_ref", 1e-7)

    Ixx = section_props["Ixx"]
    Iyy = section_props.get("Iyy", Ixx)
    J = section_props.get(
        "J_bredt",
        section_props.get("J_polar", section_props.get("J", 0.0)),
    )

    penalty = 0.0

    def _penalty_one(value, ref, weight):
        if ref <= 0:
            return 0.0
        threshold = ref * (1.0 - tolerance_pct)
        if one_sided and value >= ref:
            return 0.0
        if value >= threshold:
            return 0.0
        violation = threshold - value
        scale = ref * tolerance_pct
        return weight * 50.0 * (violation / scale) ** 2

    penalty += _penalty_one(Ixx, Ixx_ref, w_bending)
    penalty += _penalty_one(Iyy, Iyy_ref, w_bending)
    penalty += _penalty_one(J, J_ref, w_torsion)

    return aero_score + penalty
