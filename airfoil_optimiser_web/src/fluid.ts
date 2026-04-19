/** Fresh water kinematic viscosity (m²/s) — matches ``fluid_properties.py`` table. */

const T = [0, 5, 10, 15, 20, 25, 30, 35, 40]
const V = [
  1.787e-6, 1.519e-6, 1.307e-6, 1.139e-6, 1.004e-6, 0.893e-6, 0.801e-6, 0.724e-6,
  0.658e-6,
]

export function waterKinematicViscosity(tempC: number): number {
  const t = Math.min(Math.max(tempC, T[0]), T[T.length - 1])
  let i = 0
  while (i < T.length - 1 && T[i + 1] < t) i++
  const t0 = T[i]
  const t1 = T[i + 1]
  const f = (t - t0) / (t1 - t0)
  return V[i] * (1 - f) + V[i + 1] * f
}
