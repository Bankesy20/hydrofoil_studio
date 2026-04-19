"""
HydroOptFoil — Hydrofoil Section Optimiser
===========================================

Streamlit entry point.  Run with:

    cd hydrooptfoil
    streamlit run app.py
"""

import streamlit as st
import numpy as np

from core.optimizer import run_optimization
from core.cst_geometry import dat_string_from_coords, repanel_cosine
from core.fluid_properties import water_kinematic_viscosity
from ui.sidebar import render_sidebar
from ui.results import render_results, render_seed_analysis
from ui.plotting import plot_convergence


def _build_export_name(config):
    """
    Build a descriptive filename stem from optimisation config.

    Mast example:  N0012_Re250k-750k_AoA2.0_Nc7_tc10-16_Cp-2.5_Cm0.3_Sm0.2_P30i300
    Wing example:  N4412_Op3_Nc7_tc8-14_Sm0.2_P30i300
    """
    parts = []

    # -- seed airfoil shorthand
    seed = config.get("seed_airfoil")
    if isinstance(seed, str):
        short = (seed.replace("NACA ", "N").replace("-", "")
                      .replace(" ", ""))
    else:
        short = "custom"
    parts.append(short)

    ct = config.get("component_type", "mast")

    if ct == "mast":
        # Re range in thousands
        re_vals = config.get("Re_values", [])
        if re_vals:
            re_lo = int(round(min(re_vals) / 1e3))
            re_hi = int(round(max(re_vals) / 1e3))
            parts.append(f"Re{re_lo}k-{re_hi}k")

        parts.append(f"AoA{config.get('max_aoa', 0):.1f}")
    else:
        # Wing: number of operating points
        n_ops = len(config.get("operating_points", []))
        parts.append(f"Op{n_ops}")

    parts.append(f"Nc{config.get('n_crit', 9)}")

    # t/c bounds (as percentage)
    tc_lo = round(config.get("min_tc", 0) * 100)
    tc_hi = round(config.get("max_tc", 0) * 100)
    parts.append(f"tc{tc_lo}-{tc_hi}")

    # Cpmin — only when active (mast)
    cpmin = config.get("cpmin_limit")
    if cpmin is not None:
        parts.append(f"Cp{cpmin:.1f}")

    # Cm penalty — only when non-zero (mast)
    w_cm = config.get("w_cm", 0)
    if w_cm:
        parts.append(f"Cm{w_cm:.1f}")

    # Smoothness
    w_sm = config.get("w_smoothness", 0)
    if w_sm:
        parts.append(f"Sm{w_sm}")

    # Population & iterations
    pop = config.get("pop_size", 30)
    itr = config.get("max_iter", 300)
    parts.append(f"P{pop}i{itr}")

    return "_".join(parts)

# ── page configuration (must be first Streamlit call) ────────────────────────
st.set_page_config(
    page_title="HydroOptFoil",
    page_icon="\U0001F30A",      # 🌊
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── custom CSS — dark engineering-tool aesthetic ──────────────────────────────
st.markdown("""
<style>
    /* ── layout ────────────────────────────────────────────────── */
    .block-container { padding-top: 0.8rem; padding-bottom: 0.5rem; }

    /* ── typography — monospace feel ───────────────────────────── */
    h1, h2, h3, h4, h5, h6,
    .stMetricLabel, .stMetricValue, .stMetricDelta {
        font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono',
                     'Cascadia Code', 'Consolas', monospace !important;
    }
    h1 { font-size: 1.5rem !important; letter-spacing: -0.02em; }
    h2 { font-size: 1.15rem !important; }
    h3 { font-size: 1.0rem !important; }

    /* ── tabs ──────────────────────────────────────────────────── */
    .stTabs [data-baseweb="tab-list"] { gap: 4px; }
    .stTabs [data-baseweb="tab"] {
        padding: 6px 16px;
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        font-size: 0.82rem;
        letter-spacing: 0.03em;
    }

    /* ── metrics — compact & mono ─────────────────────────────── */
    [data-testid="stMetric"] {
        background: rgba(13, 17, 23, 0.5);
        border: 1px solid rgba(48, 54, 61, 0.6);
        border-radius: 6px;
        padding: 10px 12px 8px 12px;
    }
    [data-testid="stMetricLabel"] {
        font-size: 0.7rem !important;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        opacity: 0.7;
    }
    [data-testid="stMetricValue"] {
        font-size: 1.15rem !important;
    }

    /* ── expanders ─────────────────────────────────────────────── */
    .streamlit-expanderHeader {
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.85rem;
    }

    /* ── dataframe — tighter ──────────────────────────────────── */
    .stDataFrame { font-size: 0.8rem; }

    /* ── reduce vertical gaps between elements ──────────────── */
    .stPlotlyChart, .stPyplot {
        margin-bottom: -0.5rem !important;
    }
    .element-container {
        margin-bottom: 0.2rem !important;
    }
    /* tighter column gaps */
    [data-testid="column"] {
        padding: 0 0.3rem !important;
    }

    /* ── dividers ─────────────────────────────────────────────── */
    hr { border-color: rgba(48, 54, 61, 0.5) !important; margin: 0.3rem 0 !important; }

    /* ── sidebar — compact labels ─────────────────────────────── */
    section[data-testid="stSidebar"] .stSelectbox label,
    section[data-testid="stSidebar"] .stNumberInput label,
    section[data-testid="stSidebar"] .stSlider label {
        font-size: 0.8rem;
    }
    section[data-testid="stSidebar"] .stCaption {
        font-size: 0.68rem !important;
        margin-top: -0.4rem;
    }

    /* ── header banner ────────────────────────────────────────── */
    .app-header {
        display: flex;
        align-items: baseline;
        gap: 10px;
        margin-bottom: 2px;
    }
    .app-header h1 {
        margin: 0 !important;
        padding: 0 !important;
    }
    .app-version {
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.7rem;
        opacity: 0.45;
        letter-spacing: 0.05em;
    }
</style>
""", unsafe_allow_html=True)

st.markdown(
    '<div class="app-header">'
    '<h1>HydroOptFoil</h1>'
    '<span class="app-version">v0.2.0</span>'
    '</div>',
    unsafe_allow_html=True,
)
st.caption("hydrofoil section optimiser  \u2014  masts & front wings")

# ── sidebar (all configuration) ──────────────────────────────────────────────
config = render_sidebar()

# ── main area — tabbed layout ────────────────────────────────────────────────
tab_seed, tab_flow, tab_optim, tab_export = st.tabs(
    ["Seed Airfoil", "Flow Calculator", "Optimisation", "Export"])

# ────────────────────── TAB 1: seed analysis ─────────────────────────────────
with tab_seed:
    if config is None or config.get("seed_airfoil") is None:
        st.info("Select a seed airfoil in the sidebar to get started.")
    else:
        render_seed_analysis(config)

with tab_flow:
    left, right = st.columns(2, gap="large")

    with left:
        st.subheader("Inputs")

        sp_c1, sp_c2 = st.columns([2, 1])
        with sp_c1:
            speed = st.number_input("Speed", value=10.0, step=0.5, format="%.1f")
        with sp_c2:
            speed_unit = st.selectbox("Unit", ["m/s", "km/h", "knots", "mph"])

        if speed_unit == "m/s":
            v_ms = float(speed)
        elif speed_unit == "km/h":
            v_ms = float(speed) / 3.6
        elif speed_unit == "knots":
            v_ms = float(speed) * 0.514444
        else:  # mph
            v_ms = float(speed) * 0.44704

        chord_mm = st.number_input(
            "Chord (mm)", min_value=20, max_value=500, value=120, step=1
        )
        chord_m = float(chord_mm) / 1000.0

        water_temp = st.number_input(
            "Water temperature (°C)", min_value=0, max_value=40, value=20, step=1
        )

        water_type = st.radio(
            "Water type", ["Fresh water", "Salt water"], horizontal=True
        )
        nu = water_kinematic_viscosity(water_temp)
        if water_type == "Salt water":
            nu = nu * 1.05
        st.caption(f"ν used: {nu:.3e} m²/s")

        with st.expander("Lift / required Cl", expanded=False):
            load_mode = st.radio(
                "Load input",
                ["Mass (kg)", "Force (N)"],
                horizontal=True,
            )
            if load_mode == "Mass (kg)":
                mass_kg = st.number_input(
                    "Total supported mass (kg)",
                    min_value=1.0,
                    max_value=300.0,
                    value=85.0,
                    step=1.0,
                )
                lift_n = float(mass_kg) * 9.80665
            else:
                lift_n = st.number_input(
                    "Total lift force (N)",
                    min_value=10.0,
                    max_value=5000.0,
                    value=850.0,
                    step=10.0,
                )

            area_cm2 = st.number_input(
                "Foil planform area (cm²)",
                min_value=50,
                max_value=5000,
                value=1200,
                step=10,
                help="Use the lifting surface area for the foil you want Cl for "
                     "(e.g., front wing).",
            )
            area_m2 = float(area_cm2) * 1e-4

            lift_share_pct = st.slider(
                "Lift share for this foil (%)",
                min_value=10,
                max_value=100,
                value=100,
                step=5,
                help="If you're sizing the front wing and expect it to carry "
                     "less than 100% of the load, reduce this.",
            )
            lift_n = lift_n * (float(lift_share_pct) / 100.0)

    with right:
        st.subheader("Results")

        Re = (v_ms * chord_m) / max(nu, 1e-12)

        def _fmt_re(re):
            re = float(re)
            if re >= 1e6:
                return f"{re/1e6:.2f} M"
            if re >= 1e3:
                return f"{re/1e3:.0f} k"
            return f"{re:.0f}"

        st.metric("Reynolds number", _fmt_re(Re))

        rho = 998.0  # kg/m^3 (good enough for now)
        q = 0.5 * rho * (v_ms ** 2)
        q_str = f"{q:.0f} Pa" if q < 1000 else f"{q/1000:.2f} kPa"
        st.metric("Dynamic pressure", q_str)

        # Required Cl for specified load & area (if expander was opened, vars exist)
        try:
            cl_req = float(lift_n) / max(q * area_m2, 1e-12)
            st.metric("Required Cl (for lift)", f"{cl_req:.2f}")
        except Exception:
            pass

        v_kmh = v_ms * 3.6
        v_kn = v_ms / 0.514444
        v_mph = v_ms / 0.44704
        st.code(
            "Speed conversions\n"
            f"  {v_ms:.3f} m/s\n"
            f"  {v_kmh:.2f} km/h\n"
            f"  {v_kn:.2f} knots\n"
            f"  {v_mph:.2f} mph",
            language=None,
        )

        st.metric("ν (kinematic viscosity)", f"{nu:.3e} m²/s")

    st.caption(
        "Typical Re ranges: Kitefoil mast 500k–2M · Wing foil mast 200k–800k · Front wing 300k–1.5M"
    )

    # Quick reference table: Re for common speed/chord combos
    import pandas as pd

    speeds_ms = np.array([6.0, 8.0, 10.0, 12.0, 14.0], dtype=float)
    chords_mm = np.array([80, 120, 160, 200], dtype=float)
    rows = []
    for cmm in chords_mm:
        c_m = cmm / 1000.0
        for v in speeds_ms:
            rows.append({
                "speed (m/s)": v,
                "chord (mm)": int(cmm),
                "Re": (v * c_m) / max(nu, 1e-12),
            })
    df = pd.DataFrame(rows)
    df["Re (k)"] = (df["Re"] / 1e3).round(0).astype(int)
    df = df.drop(columns=["Re"])
    st.dataframe(df, width="stretch", hide_index=True)

# ────────────────────── TAB 2: optimisation ──────────────────────────────────
with tab_optim:
    if config is None or config.get("seed_airfoil") is None:
        st.info("Select a seed airfoil in the sidebar to run optimisation.")
    elif st.session_state.get("run_requested"):
        status_text = st.empty()
        chart_placeholder = st.empty()

        convergence_history = []

        def _progress_cb(iteration, best_value, total_iterations):
            convergence_history.append(best_value)
            imp = (1.0 - best_value) * 100 if best_value < 10 else 0
            status_text.code(
                f"  improvement:  {imp:+.2f} %\n"
                f"  objective:    {best_value:.6f}  (seed = 1.0)\n"
                f"  generation:   {iteration} / {total_iterations}",
                language=None,
            )
            if len(convergence_history) > 1:
                fig = plot_convergence(convergence_history)
                chart_placeholder.plotly_chart(
                    fig, width="stretch",
                    config={"displayModeBar": False})

        with st.spinner("Optimising…"):
            result = run_optimization(config, callback=_progress_cb)

        st.session_state["result"] = result
        st.session_state["run_requested"] = False
        st.rerun()

    elif "result" in st.session_state:
        render_results(config, st.session_state["result"])

    else:
        st.info("Click **Run Optimization** in the sidebar to start.")

# ────────────────────── TAB 3: export ────────────────────────────────────────
with tab_export:
    if "result" in st.session_state:
        result = st.session_state["result"]

        st.subheader("Download Results")

        # ── export settings ───────────────────────────────────────────────────
        n_raw = len(result["optimized_coords"])
        export_npts = st.slider(
            "Export point count", min_value=80, max_value=250,
            value=161, step=10,
            help=f"Resample with cosine spacing (dense at LE/TE). "
                 f"Original has {n_raw} pts. XFLR5 works best with ~120-180.")

        le_bunch = st.slider(
            "LE point bunching", min_value=1.0, max_value=2.0,
            value=1.3, step=0.1,
            help="Higher = denser clustering at leading edge. "
                 "1.0 = standard cosine, 1.3 = recommended for XFoil/XFLR5.")

        export_coords = repanel_cosine(
            result["optimized_coords"], n_points=export_npts,
            le_bunch=le_bunch)

        st.caption(f"export: {len(export_coords)} pts  "
                   f"(cosine-spaced, original: {n_raw} pts)")

        auto_name = _build_export_name(result.get("config", config))
        export_name = st.text_input(
            "File name", value=auto_name,
            help="Name used for all downloaded files and the .dat header line.")

        # ── .dat file ────────────────────────────────────────────────────────
        dat = dat_string_from_coords(export_coords, export_name)
        st.download_button(
            "Download Optimised Airfoil (.dat)",
            dat,
            file_name=f"{export_name}.dat",
            mime="text/plain",
        )

        # ── polar CSV ────────────────────────────────────────────────────────
        import pandas as pd
        polar = result["opt_polar"]
        alphas = result["opt_alphas"]
        df_polar = pd.DataFrame({
            "alpha_deg": alphas,
            "CL": polar["CL"],
            "CD": polar["CD"],
            "CM": polar["CM"],
        })
        st.download_button(
            "Download Optimised Polar (.csv)",
            df_polar.to_csv(index=False),
            file_name=f"{export_name}_polar.csv",
            mime="text/csv",
        )

        # ── summary text ─────────────────────────────────────────────────────
        sec = result["opt_section_props"]
        lines = [
            f"Name: {export_name}",
            f"Objective: {result['best_objective']:.6f}",
            f"Generations: {result['n_iterations']}",
            f"t/c: {result['opt_tc']*100:.1f}%",
            f"Ixx: {sec['Ixx']:.3e} m^4",
            f"Iyy: {sec['Iyy']:.3e} m^4",
            f"J: {sec.get('J_bredt', sec['J_polar']):.3e} m^4",
            f"Area: {sec['A']*1e6:.1f} mm^2",
        ]
        st.download_button(
            "Download Summary (.txt)",
            "\n".join(lines),
            file_name=f"{export_name}_summary.txt",
            mime="text/plain",
        )
    else:
        st.info("Run an optimisation first to export results.")
