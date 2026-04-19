"""
Results display for HydroOptFoil — seed analysis, optimisation results, and
comparison tables.

Dark engineering-tool aesthetic.  All plots use Plotly (vector/SVG).
"""

import re

import streamlit as st
import numpy as np
import pandas as pd

from ui.plotting import (
    plot_single_airfoil,
    plot_airfoil_comparison,
    plot_two_airfoils,
    plot_polar_cl_cd,
    plot_cl_cd_ratio,
    plot_cm_alpha,
    plot_cd_alpha,
    plot_convergence,
    plot_cp_distribution,
    plot_cp_distribution_multi,
    plot_xy,
    plot_xy_multi,
)
from core.cst_geometry import get_tc_from_coords, get_camber_from_coords
from core.section_properties import compute_section_properties

_CHART_KW = dict(width="stretch", config={"displayModeBar": False})


def _parse_re_list_str(text, fallback):
    """Parse comma/newline/semicolon-separated Reynolds numbers; preserve order, drop dupes."""
    tokens = re.split(r"[\s,;]+", (text or "").strip())
    out = []
    for t in tokens:
        if not t:
            continue
        try:
            out.append(float(t))
        except ValueError:
            continue
    if not out:
        return list(fallback)
    seen = set()
    uniq = []
    for r in out:
        if r not in seen:
            seen.add(r)
            uniq.append(r)
    return uniq


def _re_caption(re_list):
    if len(re_list) == 1:
        return f"Re {re_list[0]/1e6:.2f}M"
    parts = [f"{r/1e6:.2f}M" for r in re_list]
    return "Re " + ", ".join(parts)


# ──────────────────────────────────────────────────────────────────────────────
# Seed tab
# ──────────────────────────────────────────────────────────────────────────────

def render_seed_analysis(config):
    """Display the seed airfoil shape and key properties."""
    from ui.airfoil_library import get_airfoil_coordinates, library_choices_for_config
    from core.cst_geometry import airfoil_to_cst, cst_to_coordinates, N_CST
    from core.aero_engine import evaluate_polar_sweep_detailed

    seed = config["seed_airfoil"]
    if seed is None:
        st.warning("Select or upload a seed airfoil.")
        return

    coords = get_airfoil_coordinates(seed)

    label_a = seed if isinstance(seed, str) else "Seed (uploaded)"

    st.markdown("**Compare airfoils**")
    compare_on = st.checkbox(
        "Compare with a second airfoil (library or upload)",
        value=False,
        key="seed_compare_enable",
        help="Overlays geometry and adds the second airfoil to polar / Cp plots after **Compute polars**.",
    )

    coords_b = None
    label_b = ""
    compare_id = None
    if compare_on:
        cmp_src = st.radio(
            "Second airfoil source",
            ["Library", "Upload .dat"],
            horizontal=True,
            key="seed_cmp_source",
        )
        legend_in = st.text_input(
            "Legend name for second airfoil (optional)",
            placeholder="Uses library name or file name if empty",
            key="seed_cmp_legend",
        )
        legend_b = legend_in.strip()
        if cmp_src == "Library":
            choices_b = library_choices_for_config(config.get("component_type", "mast"))
            name_b = st.selectbox(
                "Second airfoil",
                choices_b,
                key="seed_cmp_library",
            )
            coords_b = get_airfoil_coordinates(name_b)
            label_b = legend_b or name_b
            compare_id = ("lib", name_b)
        else:
            up_b = st.file_uploader(
                "Second airfoil file (.dat / .txt)",
                type=["dat", "txt"],
                key="seed_cmp_upload",
            )
            if up_b is not None:
                coords_b = get_airfoil_coordinates(up_b)
                label_b = legend_b or getattr(up_b, "name", "uploaded") or "Compare"
                compare_id = ("upload", getattr(up_b, "name", "file"))
            else:
                st.info("Choose a file to load the second airfoil.")

    # ── airfoil plot — overlay when comparing ─────────────────────────────
    _shape_key = f"{compare_id}_{label_a}" if compare_id else str(seed if isinstance(seed, str) else "uploaded")
    if coords_b is not None:
        fig_shape = plot_two_airfoils(
            coords, coords_b, str(label_a), str(label_b),
            chord_mm=config.get("chord_mm"),
        )
    else:
        title = f"seed:  {label_a}"
        fig_shape = plot_single_airfoil(coords, title=title)
    st.plotly_chart(fig_shape, key=f"seed_shape_{_shape_key}", **_CHART_KW)

    # ── properties ───────────────────────────────────────────────────────
    tc, tc_pos = get_tc_from_coords(coords)
    camber, camber_pos = get_camber_from_coords(coords)
    sec = compute_section_properties(coords, config["chord_m"])

    if coords_b is not None:
        tc_b, tc_pos_b = get_tc_from_coords(coords_b)
        camber_b, camber_pos_b = get_camber_from_coords(coords_b)
        sec_b = compute_section_properties(coords_b, config["chord_m"])
        g1, g2 = st.columns(2)
        with g1:
            st.caption("**Primary (seed)**")
            st.code(
                f"  geometry\n"
                f"  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n"
                f"  t/c            {tc*100:6.2f} %\n"
                f"  max-t pos      {tc_pos*100:6.1f} % chord\n"
                f"  camber         {camber*100:6.2f} %\n"
                f"  camber pos     {camber_pos*100:6.1f} % chord\n"
                f"  chord          {config['chord_mm']:6d} mm",
                language=None,
            )
        with g2:
            st.caption(f"**Compare · {label_b}**")
            st.code(
                f"  geometry\n"
                f"  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n"
                f"  t/c            {tc_b*100:6.2f} %\n"
                f"  max-t pos      {tc_pos_b*100:6.1f} % chord\n"
                f"  camber         {camber_b*100:6.2f} %\n"
                f"  camber pos     {camber_pos_b*100:6.1f} % chord\n"
                f"  chord          {config['chord_mm']:6d} mm",
                language=None,
            )
        s1, s2 = st.columns(2)
        with s1:
            st.code(
                f"  section properties\n"
                f"  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n"
                f"  Ixx            {sec['Ixx']:.3e} m\u2074\n"
                f"  J_polar        {sec['J_polar']:.3e} m\u2074\n"
                f"  area           {sec['A']*1e6:8.1f} mm\u00b2",
                language=None,
            )
        with s2:
            st.code(
                f"  section properties\n"
                f"  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n"
                f"  Ixx            {sec_b['Ixx']:.3e} m\u2074\n"
                f"  J_polar        {sec_b['J_polar']:.3e} m\u2074\n"
                f"  area           {sec_b['A']*1e6:8.1f} mm\u00b2",
                language=None,
            )
    else:
        col_geo, col_sec = st.columns(2)
        with col_geo:
            geo_text = (
                f"  geometry\n"
                f"  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n"
                f"  t/c            {tc*100:6.2f} %\n"
                f"  max-t pos      {tc_pos*100:6.1f} % chord\n"
                f"  camber         {camber*100:6.2f} %\n"
                f"  camber pos     {camber_pos*100:6.1f} % chord\n"
                f"  chord          {config['chord_mm']:6d} mm"
            )
            st.code(geo_text, language=None)
        with col_sec:
            st.code(
                f"  section properties\n"
                f"  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n"
                f"  Ixx            {sec['Ixx']:.3e} m\u2074\n"
                f"  J_polar        {sec['J_polar']:.3e} m\u2074\n"
                f"  area           {sec['A']*1e6:8.1f} mm\u00b2",
                language=None,
            )

    st.divider()

    # ── seed polars (NeuralFoil) — expandable plot builder ─────────────────
    with st.expander("seed polars (NeuralFoil)", expanded=False):
        # Defaults aligned with optimiser display plots
        if config.get("component_type") == "mast":
            default_alpha = (-5.0, 5.0, 0.25)
            re_vals = config.get("Re_values", [8e5])
            default_re = float(re_vals[len(re_vals) // 2]) if re_vals else 8e5
        else:
            default_alpha = (-5.0, 15.0, 0.5)
            ops = config.get("operating_points", [])
            default_re = float(ops[0]["Re"]) if ops else 8e5

        # For display, use the middle Ncrit when multi-Ncrit is enabled
        cfg_nc = config.get("n_crit", 7.0)
        default_ncrit = (cfg_nc[len(cfg_nc) // 2] if isinstance(cfg_nc, list) else float(cfg_nc))

        if config.get("component_type") == "mast" and config.get("Re_values"):
            _re_default_txt = ", ".join(
                str(int(r)) for r in sorted(set(config["Re_values"])))
        else:
            _re_default_txt = str(int(default_re))

        st.markdown("**Sweep parameters**")
        re_text = st.text_area(
            "Reynolds numbers",
            value=_re_default_txt,
            height=88,
            help="One or more values: separate with commas, spaces, or newlines "
                 "(e.g. `400000, 800000, 1200000`). All are drawn on the same plot.",
            key="seed_polar_re_text",
        )
        re_list = _parse_re_list_str(re_text, fallback=[float(default_re)])

        row_a = st.columns(3)
        with row_a[0]:
            ncrit = st.number_input("Ncrit", value=float(default_ncrit), step=0.5, format="%.1f")
        with row_a[1]:
            model_size = st.selectbox("model size", ["large", "xlarge"], index=1)
        with row_a[2]:
            st.caption(f"**{len(re_list)}** Re · {_re_caption(re_list)}")

        r1, r2, r3 = st.columns(3)
        with r1:
            a0 = st.number_input("α start (°)", value=float(default_alpha[0]), step=1.0, format="%.1f")
        with r2:
            a1 = st.number_input("α end (°)", value=float(default_alpha[1]), step=1.0, format="%.1f")
        with r3:
            da = st.number_input("Δα (°)", value=float(default_alpha[2]), step=0.05, format="%.2f")

        # Compute seed CST in the same way the optimiser does (mast is symmetrised)
        seed_upper, seed_lower, seed_le, seed_te = airfoil_to_cst(coords, N_CST)
        if config.get("component_type") == "mast":
            fixed_te = float(config.get("te_thickness", 0.0))
            seed_lower = [-w for w in seed_upper]
            seed_le = 0.0
            seed_te = fixed_te
            _ = cst_to_coordinates(seed_upper, seed_lower, seed_le, seed_te)

        compare_key = compare_id if coords_b is not None else ("none",)
        bu = bl = ble = bte = None
        if coords_b is not None:
            bu, bl, ble, bte = airfoil_to_cst(coords_b, N_CST)
            if config.get("component_type") == "mast":
                bl = [-w for w in bu]
                ble = 0.0
                bte = fixed_te
                _ = cst_to_coordinates(bu, bl, ble, bte)

        cache_key = (
            "seed_polars_v3",
            str(seed) if isinstance(seed, str) else "uploaded",
            compare_key,
            tuple(re_list),
            float(ncrit), str(model_size),
            float(a0), float(a1), float(da),
        )

        btn1, btn2, btn3 = st.columns(3)
        with btn1:
            compute = st.button("Compute polars", type="primary", use_container_width=True)
        with btn2:
            add_graph = st.button("Add graph", use_container_width=True)
        with btn3:
            reset_graphs = st.button("Reset graphs", use_container_width=True)

        if compute:
            nfoil = 2 if coords_b is not None else 1
            with st.spinner(
                f"Running NeuralFoil for {len(re_list)} Reynolds number(s)"
                f" × {nfoil} airfoil(s)…"
            ):
                by_re = {}
                by_re_b = {}
                ref_alphas = None
                for re_val in re_list:
                    detailed_k, alphas_k = evaluate_polar_sweep_detailed(
                        seed_upper, seed_lower, seed_le, seed_te,
                        Re=float(re_val),
                        n_crit=float(ncrit),
                        alpha_range=(float(a0), float(a1), float(da)),
                        model_size=str(model_size),
                    )
                    rkey = float(re_val)
                    by_re[rkey] = {"detailed": detailed_k, "alphas": alphas_k}
                    if ref_alphas is None:
                        ref_alphas = alphas_k
                    if coords_b is not None:
                        db, ab = evaluate_polar_sweep_detailed(
                            bu, bl, ble, bte,
                            Re=float(re_val),
                            n_crit=float(ncrit),
                            alpha_range=(float(a0), float(a1), float(da)),
                            model_size=str(model_size),
                        )
                        by_re_b[rkey] = {"detailed": db, "alphas": ab}
            st.session_state[cache_key] = {
                "re_list": re_list,
                "by_re": by_re,
                "by_re_b": by_re_b if coords_b is not None else None,
                "alphas": ref_alphas,
                "label_a": str(label_a),
                "label_b": str(label_b) if coords_b is not None else "",
            }

        stored = st.session_state.get(cache_key)
        if stored is None:
            st.info("Click **Compute polars** to populate plots.")
            return

        re_list = stored["re_list"]
        by_re = stored["by_re"]
        by_re_b = stored.get("by_re_b")
        alphas = stored["alphas"]
        plot_label_a = stored.get("label_a", str(label_a))
        plot_label_b = stored.get("label_b", str(label_b))
        r0 = float(re_list[0])
        detailed = by_re[r0]["detailed"]
        title_airfoils = (
            f"{plot_label_a} vs {plot_label_b}"
            if by_re_b
            else str(plot_label_a)
        )

        # Graph builder (unlimited graphs)
        builder_key = (
            f"seed_plot_builder_v3::"
            f"{str(seed) if isinstance(seed, str) else 'uploaded'}::"
            f"{compare_key!s}"
        )
        if builder_key not in st.session_state:
            st.session_state[builder_key] = [
                {"kind": "xy", "x": "alpha_deg", "ys": ["CL"]},
                {"kind": "xy", "x": "alpha_deg", "ys": ["CD"]},
                {"kind": "xy", "x": "CD", "ys": ["CL"]},
                {"kind": "cp", "surface": "both", "alpha_idx": int(np.argmin(np.abs(alphas)))},
            ]

        if reset_graphs:
            st.session_state.pop(builder_key, None)
            st.rerun()
        if add_graph:
            st.session_state[builder_key].append({"kind": "xy", "x": "alpha_deg", "ys": ["CM"]})

        # Available scalar fields are 1-D arrays of matching length
        scalar_fields = []
        for k, v in detailed.items():
            try:
                arr = np.asarray(v)
            except Exception:
                continue
            if arr.ndim == 1 and len(arr) == len(alphas):
                scalar_fields.append(k)
        scalar_fields = sorted(set(scalar_fields), key=lambda s: (s not in {"CL", "CD", "CM", "Cpmin"}, s))

        # X axis can be alpha, or any scalar series
        x_fields = ["alpha_deg"] + scalar_fields

        _ck_str = str(cache_key)
        for i, spec in enumerate(list(st.session_state[builder_key])):
            with st.container(border=True):
                row_top = st.columns([4, 1])
                with row_top[0]:
                    kind = st.selectbox(
                        "Plot type",
                        ["X vs Y", "Cp / dCp @ α"],
                        index=0 if spec.get("kind") == "xy" else 1,
                        key=f"seed_graph_kind_{i}_{builder_key}",
                    )
                with row_top[1]:
                    if st.button("Remove", key=f"seed_graph_remove_{i}_{builder_key}", use_container_width=True):
                        st.session_state[builder_key].pop(i)
                        st.rerun()

                if kind == "X vs Y":
                    x_field = spec.get("x", "alpha_deg")
                    ys = spec.get("ys", ["CL"])

                    row_mid = st.columns([2, 2])
                    with row_mid[0]:
                        x_field = st.selectbox(
                            "X axis",
                            x_fields,
                            index=x_fields.index(x_field) if x_field in x_fields else 0,
                            key=f"seed_graph_x_{i}_{builder_key}",
                        )
                    with row_mid[1]:
                        mode = st.selectbox(
                            "Line style",
                            ["lines", "lines+markers", "markers"],
                            index=0,
                            key=f"seed_graph_mode_{i}_{builder_key}",
                        )
                    ys = st.multiselect(
                        "Y axis (one or more)",
                        scalar_fields,
                        default=[y for y in ys if y in scalar_fields] or ["CL"],
                        key=f"seed_graph_ys_{i}_{builder_key}",
                    )

                    traces = []
                    for re_val in re_list:
                        rkey = float(re_val)
                        det_r = by_re[rkey]["detailed"]
                        a_r = by_re[rkey]["alphas"]
                        if x_field == "alpha_deg":
                            xv = a_r
                            x_label = "α (°)"
                        else:
                            xv = np.asarray(det_r[x_field], dtype=float)
                            x_label = x_field
                        re_lbl = f"Re {re_val/1e6:.2f}M"
                        for y in ys:
                            yv = np.asarray(det_r[y], dtype=float)
                            suffix = f" · {re_lbl}" if len(re_list) > 1 else ""
                            traces.append((f"{plot_label_a} · {y}{suffix}", xv, yv))
                    if by_re_b is not None:
                        for re_val in re_list:
                            rkey = float(re_val)
                            det_r = by_re_b[rkey]["detailed"]
                            a_r = by_re_b[rkey]["alphas"]
                            if x_field == "alpha_deg":
                                xv = a_r
                            else:
                                xv = np.asarray(det_r[x_field], dtype=float)
                            re_lbl = f"Re {re_val/1e6:.2f}M"
                            for y in ys:
                                yv = np.asarray(det_r[y], dtype=float)
                                suffix = f" · {re_lbl}" if len(re_list) > 1 else ""
                                traces.append((f"{plot_label_b} · {y}{suffix}", xv, yv))

                    title = (
                        f"{title_airfoils} · {', '.join(ys)} vs {x_field} · "
                        f"{_re_caption(re_list)} · Nc {ncrit:.1f}"
                    )
                    fig = plot_xy_multi(
                        traces,
                        title=title,
                        x_label=x_label,
                        y_label=", ".join(ys) if ys else "",
                        mode=mode,
                    )
                    st.plotly_chart(
                        fig,
                        key=f"seed_xy_{i}_{builder_key}_{_ck_str}",
                        **_CHART_KW,
                    )
                    st.session_state[builder_key][i] = {"kind": "xy", "x": x_field, "ys": ys}
                else:
                    default_idx = int(spec.get("alpha_idx", int(np.argmin(np.abs(alphas)))))
                    default_idx = int(np.clip(default_idx, 0, len(alphas) - 1))
                    alpha_opts = np.asarray(alphas, dtype=float).tolist()
                    alpha_sel = st.select_slider(
                        "Angle of attack α (°)",
                        options=alpha_opts,
                        value=float(alpha_opts[default_idx]),
                        key=f"seed_graph_alpha_deg_{i}_{builder_key}",
                        help="Polar was computed at discrete α from your sweep (α start, α end, Δα). "
                             "Pick which sample to show Cp / dCp for.",
                    )
                    st.caption(
                        "Uses the same α samples as the polar sweep above — not a continuous angle dial."
                    )
                    alpha_idx = int(np.argmin(np.abs(np.asarray(alpha_opts, dtype=float) - float(alpha_sel))))

                    row_cp = st.columns(2)
                    with row_cp[0]:
                        dist = st.selectbox(
                            "Distribution",
                            ["Cp", "dCp"],
                            index=0,
                            key=f"seed_graph_dist_{i}_{builder_key}",
                        )
                    with row_cp[1]:
                        surface = st.selectbox(
                            "Surface",
                            ["both", "upper", "lower"],
                            index=["both", "upper", "lower"].index(spec.get("surface", "both"))
                            if spec.get("surface", "both") in ["both", "upper", "lower"] else 0,
                            key=f"seed_graph_surface_{i}_{builder_key}",
                        )

                    alpha_val = float(alphas[alpha_idx])
                    x_cp0 = detailed["x_cp"]

                    if dist == "Cp":
                        title = (
                            f"{title_airfoils} · Cp @ α={alpha_val:.2f}° · "
                            f"{_re_caption(re_list)} · Nc {ncrit:.1f}"
                        )
                        if by_re_b is not None:
                            curves_cp = []
                            for re_val in re_list:
                                rkey = float(re_val)
                                rl = f"Re {re_val/1e6:.2f}M"
                                da = by_re[rkey]["detailed"]
                                db = by_re_b[rkey]["detailed"]
                                curves_cp.append((
                                    f"{plot_label_a} · {rl}",
                                    da["cp_upper"][:, alpha_idx],
                                    da["cp_lower"][:, alpha_idx],
                                ))
                                curves_cp.append((
                                    f"{plot_label_b} · {rl}",
                                    db["cp_upper"][:, alpha_idx],
                                    db["cp_lower"][:, alpha_idx],
                                ))
                            fig = plot_cp_distribution_multi(
                                x_cp0, curves_cp, title=title, invert_cp=True,
                            )
                        elif len(re_list) == 1:
                            rkey = float(re_list[0])
                            det_r = by_re[rkey]["detailed"]
                            fig = plot_cp_distribution(
                                x_cp0,
                                det_r["cp_upper"][:, alpha_idx],
                                det_r["cp_lower"][:, alpha_idx],
                                title=title,
                                invert_cp=True,
                            )
                        else:
                            curves = []
                            for re_val in re_list:
                                rkey = float(re_val)
                                det_r = by_re[rkey]["detailed"]
                                curves.append((
                                    f"Re {re_val/1e6:.2f}M",
                                    det_r["cp_upper"][:, alpha_idx],
                                    det_r["cp_lower"][:, alpha_idx],
                                ))
                            fig = plot_cp_distribution_multi(
                                x_cp0, curves, title=title, invert_cp=True,
                            )
                    else:
                        x_mid = 0.5 * (np.asarray(x_cp0[:-1]) + np.asarray(x_cp0[1:]))
                        traces_d = []
                        if by_re_b is not None:
                            for re_val in re_list:
                                rkey = float(re_val)
                                re_lbl = f"Re {re_val/1e6:.2f}M"
                                for det_r, lbl in (
                                    (by_re[rkey]["detailed"], plot_label_a),
                                    (by_re_b[rkey]["detailed"], plot_label_b),
                                ):
                                    d_u = det_r["dcp_upper"][:, alpha_idx]
                                    d_l = det_r["dcp_lower"][:, alpha_idx]
                                    if surface in ("both", "upper"):
                                        traces_d.append(
                                            (f"dCp upper · {lbl} · {re_lbl}", x_mid, d_u))
                                    if surface in ("both", "lower"):
                                        traces_d.append(
                                            (f"dCp lower · {lbl} · {re_lbl}", x_mid, d_l))
                        else:
                            for re_val in re_list:
                                rkey = float(re_val)
                                det_r = by_re[rkey]["detailed"]
                                re_lbl = f"Re {re_val/1e6:.2f}M"
                                d_u = det_r["dcp_upper"][:, alpha_idx]
                                d_l = det_r["dcp_lower"][:, alpha_idx]
                                if surface in ("both", "upper"):
                                    traces_d.append((f"dCp upper · {re_lbl}", x_mid, d_u))
                                if surface in ("both", "lower"):
                                    traces_d.append((f"dCp lower · {re_lbl}", x_mid, d_l))
                        title = (
                            f"{title_airfoils} · dCp @ α={alpha_val:.2f}° · "
                            f"{_re_caption(re_list)} · Nc {ncrit:.1f}"
                        )
                        fig = plot_xy_multi(
                            traces_d,
                            title=title,
                            x_label="x / c  (proxy stations)",
                            y_label="dCp (per station step)",
                            mode="lines",
                        )

                    st.plotly_chart(
                        fig,
                        key=f"seed_cp_{i}_{builder_key}_{_ck_str}",
                        **_CHART_KW,
                    )
                    st.session_state[builder_key][i] = {"kind": "cp", "surface": surface, "alpha_idx": int(alpha_idx)}


# ──────────────────────────────────────────────────────────────────────────────
# Optimisation results tab
# ──────────────────────────────────────────────────────────────────────────────

def render_results(config, result):
    """Display full optimisation results with comparison plots and tables."""

    # ── headline metrics row ─────────────────────────────────────────────────
    obj = result["best_objective"]
    drag_red = result.get("drag_reduction_pct", 0)
    s_pct = result["seed_tc"] * 100
    o_pct = result["opt_tc"] * 100
    s_ixx = result["seed_section_props"]["Ixx"]
    o_ixx = result["opt_section_props"]["Ixx"]
    ixx_chg = ((o_ixx / max(s_ixx, 1e-20)) - 1) * 100 if s_ixx > 0 else 0

    c1, c2, c3, c4, c5 = st.columns(5)
    with c1:
        st.metric("generations", result["n_iterations"])
    with c2:
        st.metric("objective", f"{obj:.4f}",
                  delta=f"{(obj - 1.0)*100:+.1f}%",
                  delta_color="inverse")
    with c3:
        st.metric("\u0394 cd\u2080", f"{drag_red:+.1f}%",
                  delta_color="normal")
    with c4:
        st.metric("t/c", f"{o_pct:.1f}%",
                  delta=f"{o_pct - s_pct:+.1f}%")
    with c5:
        st.metric("\u0394 Ixx", f"{ixx_chg:+.1f}%")

    st.divider()

    # ── airfoil shape overlay ────────────────────────────────────────────────
    fig = plot_airfoil_comparison(result["seed_coords"],
                                 result["optimized_coords"],
                                 config.get("chord_mm"))
    st.plotly_chart(fig, **_CHART_KW)

    # ── plot settings ────────────────────────────────────────────────────────
    Re = result["display_Re"]

    _ALL_PLOTS = ["cl vs cd", "cd vs \u03b1", "cl/cd vs \u03b1", "cm vs \u03b1"]

    with st.expander("plot settings", expanded=False):
        visible = st.multiselect(
            "show plots", _ALL_PLOTS, default=_ALL_PLOTS,
            help="Toggle individual polar plots on or off.")

        st.markdown("**axis ranges**  *(leave at 0, 0 for auto)*")
        ax_col1, ax_col2 = st.columns(2)
        with ax_col1:
            alpha_lo = st.number_input("\u03b1 min (\u00b0)", value=0.0,
                                        step=1.0, format="%.1f",
                                        key="ax_alpha_lo")
            alpha_hi = st.number_input("\u03b1 max (\u00b0)", value=0.0,
                                        step=1.0, format="%.1f",
                                        key="ax_alpha_hi")
        with ax_col2:
            cd_lo = st.number_input("cd min", value=0.0,
                                     step=0.005, format="%.4f",
                                     key="ax_cd_lo")
            cd_hi = st.number_input("cd max", value=0.0,
                                     step=0.005, format="%.4f",
                                     key="ax_cd_hi")

    # Build range tuples (None = auto)
    alpha_range = (alpha_lo, alpha_hi) if alpha_hi > alpha_lo else None
    cd_range = (cd_lo, cd_hi) if cd_hi > cd_lo else None

    sp = result["seed_polar"]
    sa = result["seed_alphas"]
    op = result["opt_polar"]
    oa = result["opt_alphas"]

    # ── render selected polars in a 2-column grid ────────────────────────
    _plot_fns = {
        "cl vs cd":      lambda: plot_polar_cl_cd(sp, sa, op, oa, Re,
                             x_range=cd_range),
        "cd vs \u03b1":  lambda: plot_cd_alpha(sp, sa, op, oa, Re,
                             x_range=alpha_range, y_range=cd_range),
        "cl/cd vs \u03b1": lambda: plot_cl_cd_ratio(sp, sa, op, oa, Re,
                             x_range=alpha_range),
        "cm vs \u03b1":  lambda: plot_cm_alpha(sp, sa, op, oa, Re,
                             x_range=alpha_range),
    }

    shown = [p for p in _ALL_PLOTS if p in visible]
    for row_start in range(0, len(shown), 2):
        row = shown[row_start:row_start + 2]
        cols = st.columns(len(row))
        for col, name in zip(cols, row):
            with col:
                fig = _plot_fns[name]()
                st.plotly_chart(fig, **_CHART_KW)

    # ── convergence + section properties — collapsed by default ──────────────
    col_a, col_b = st.columns(2)
    with col_a:
        if result.get("convergence_history"):
            with st.expander("convergence history"):
                fig = plot_convergence(result["convergence_history"])
                st.plotly_chart(fig, **_CHART_KW)
    with col_b:
        with st.expander("section properties"):
            _section_properties_table(result)


def _section_properties_table(result):
    seed = result["seed_section_props"]
    opt = result["opt_section_props"]

    def pct(o, s):
        return f"{(o / max(s, 1e-20) - 1) * 100:+.1f}%" if s else "\u2014"

    def _get_j(sec):
        return sec.get("J_bredt", sec.get("J_polar", sec.get("J", 0.0)))

    seed_j = _get_j(seed)
    opt_j = _get_j(opt)
    j_label = ("J_bredt  (torsion)" if "J_bredt" in opt
               else "J_polar  (Ixx+Iyy)")

    # Camber data (may not exist in older results)
    seed_cam = result.get("seed_camber", 0.0)
    opt_cam = result.get("opt_camber", 0.0)
    seed_cam_pos = result.get("seed_camber_pos", 0.0)
    opt_cam_pos = result.get("opt_camber_pos", 0.0)

    data = {
        "property": [
            "Ixx  (side bending)",
            "Iyy  (fore-aft bending)",
            j_label,
            "area",
            "t/c",
            "max-t position",
            "camber",
            "camber position",
        ],
        "seed": [
            f"{seed['Ixx']:.3e}",
            f"{seed['Iyy']:.3e}",
            f"{seed_j:.3e}",
            f"{seed['A']*1e6:.1f} mm\u00b2",
            f"{result['seed_tc']*100:.1f}%",
            f"{result['seed_tc_pos']*100:.0f}% c",
            f"{seed_cam*100:.2f}%",
            f"{seed_cam_pos*100:.0f}% c",
        ],
        "optimised": [
            f"{opt['Ixx']:.3e}",
            f"{opt['Iyy']:.3e}",
            f"{opt_j:.3e}",
            f"{opt['A']*1e6:.1f} mm\u00b2",
            f"{result['opt_tc']*100:.1f}%",
            f"{result['opt_tc_pos']*100:.0f}% c",
            f"{opt_cam*100:.2f}%",
            f"{opt_cam_pos*100:.0f}% c",
        ],
        "\u0394": [
            pct(opt["Ixx"], seed["Ixx"]),
            pct(opt["Iyy"], seed["Iyy"]),
            pct(opt_j, seed_j),
            pct(opt["A"], seed["A"]),
            "", "", "", "",
        ],
    }

    st.dataframe(pd.DataFrame(data), width="stretch",
                 hide_index=True)
