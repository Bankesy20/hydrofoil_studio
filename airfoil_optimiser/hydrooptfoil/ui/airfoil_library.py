"""
Built-in seed airfoil library.

Airfoil coordinates come from AeroSandbox's bundled database.  The keys shown
in the sidebar are user-friendly names; the values are AeroSandbox lookup keys.
"""

import numpy as np
from aerosandbox.geometry.airfoil import Airfoil as ASBAirfoil

def library_choices_for_config(component_type_key: str):
    """
    Sidebar-equivalent library names for the given component type.

    component_type_key : 'mast' or 'front_wing' (same as config['component_type']).
    """
    if component_type_key == "mast":
        return [
            "NACA 0012", "NACA 0010", "NACA 0015",
            "NACA 63-012", "NACA 63-010", "NACA 66-012",
        ]
    return [
        "NACA 4412", "NACA 2412", "NACA 6412",
        "NACA 63-412", "SD7003", "E387",
    ]


AIRFOIL_LIBRARY = {
    # ── Symmetric (mast candidates) ──
    "NACA 0010": "naca0010",
    "NACA 0012": "naca0012",
    "NACA 0015": "naca0015",
    "NACA 63-010": "naca63010",
    "NACA 63-012": "naca63012",
    "NACA 66-012": "naca66012",
    # ── Cambered (wing candidates) ──
    "NACA 2412": "naca2412",
    "NACA 4412": "naca4412",
    "NACA 6412": "naca6412",
    "NACA 63-412": "naca63412",
    "SD7003": "sd7003",
    "E387": "e387",
    "S1223": "s1223",
    "FX 63-137": "fx63137",
}


def get_airfoil_coordinates(name_or_file):
    """
    Return an Nx2 numpy array of (x, y) coordinates (normalised chord = 1.0).

    *name_or_file* may be:
      • a string key from AIRFOIL_LIBRARY (e.g. "NACA 0012")
      • a raw NACA string (e.g. "NACA 2412")
      • an N×2 array or nested list of (x, y) (e.g. web API ``kind=coordinates``)
      • an uploaded Streamlit file object (.dat/.txt)
    """
    if isinstance(name_or_file, str):
        if name_or_file in AIRFOIL_LIBRARY:
            af = ASBAirfoil(AIRFOIL_LIBRARY[name_or_file])
        elif name_or_file.upper().startswith("NACA"):
            digits = (name_or_file.replace("NACA ", "")
                      .replace("NACA", "")
                      .replace("-", "")
                      .replace(" ", ""))
            af = ASBAirfoil(f"naca{digits}")
        else:
            af = ASBAirfoil(name_or_file)
        return np.asarray(af.coordinates, dtype=float)

    # Raw .dat bytes (tests / callers that skip a file wrapper)
    if isinstance(name_or_file, (bytes, bytearray)):
        return _parse_dat(name_or_file.decode("utf-8"))

    # Streamlit / Starlette upload objects (must come before array coercion:
    # some array-likes are also readable, but ndarray has no .read)
    read_m = getattr(name_or_file, "read", None)
    if callable(read_m) and not isinstance(name_or_file, (str, bytes, bytearray)):
        content = read_m().decode("utf-8")
        seek_m = getattr(name_or_file, "seek", None)
        if callable(seek_m):
            seek_m(0)
        return _parse_dat(content)

    # Explicit coordinates: list/tuple, ndarray, or ndarray-like from another
    # NumPy build (``isinstance(x, np.ndarray)`` can be false across two copies
    # of numpy in one process).
    arr = np.asarray(name_or_file, dtype=float)
    if arr.ndim == 1 and arr.size >= 4 and arr.size % 2 == 0:
        arr = arr.reshape(-1, 2)
    if arr.ndim == 2 and arr.shape[0] == 2 and arr.shape[1] != 2 and arr.shape[1] > 2:
        arr = arr.T
    if arr.ndim != 2 or arr.shape[1] != 2:
        raise ValueError("Airfoil coordinates must be an N×2 array of (x, y).")
    return arr


def _parse_dat(content):
    """Parse a Selig-format .dat airfoil file to Nx2 array."""
    coords = []
    for line in content.strip().splitlines():
        parts = line.strip().split()
        if len(parts) >= 2:
            try:
                x, y = float(parts[0]), float(parts[1])
                if -0.01 <= x <= 1.1:
                    coords.append([x, y])
            except ValueError:
                continue
    return np.array(coords, dtype=float)
