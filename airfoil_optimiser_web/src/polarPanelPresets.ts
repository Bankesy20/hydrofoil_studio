/** Reynolds presets for the seed polars panel. */
export type ReynoldsPreset = { name: string; values: number[] }

export const REYNOLDS_PRESETS: ReynoldsPreset[] = [
  { name: 'Low Re glider', values: [100_000, 200_000, 400_000] },
  { name: 'Sailplane cruise', values: [494_024, 741_036, 988_048, 1_235_060] },
  { name: 'UAV prop', values: [50_000, 100_000, 200_000, 400_000, 800_000] },
  { name: 'Trainer', values: [300_000, 600_000, 1_200_000] },
]

export function fmtRePolar(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`
  return String(n)
}
