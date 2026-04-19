import numpy as np

# Kinematic viscosity of fresh water (m²/s) at standard temperatures.
# Source: CRC Handbook / ITTC recommended values.
_WATER_NU_TABLE_T = np.array([0, 5, 10, 15, 20, 25, 30, 35, 40], dtype=float)
_WATER_NU_TABLE_V = np.array([
    1.787e-6,   # 0 °C
    1.519e-6,   # 5 °C
    1.307e-6,   # 10 °C
    1.139e-6,   # 15 °C
    1.004e-6,   # 20 °C
    0.893e-6,   # 25 °C
    0.801e-6,   # 30 °C
    0.724e-6,   # 35 °C
    0.658e-6,   # 40 °C
], dtype=float)


def water_kinematic_viscosity(temp_c: float) -> float:
    """
    Return kinematic viscosity of fresh water (m²/s) at *temp_c* (°C).

    Uses linear interpolation of a standard lookup table (CRC / ITTC values).
    """
    temp_c = float(np.clip(temp_c, _WATER_NU_TABLE_T[0], _WATER_NU_TABLE_T[-1]))
    return float(np.interp(temp_c, _WATER_NU_TABLE_T, _WATER_NU_TABLE_V))

