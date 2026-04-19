/** Ncrit presets for the seed polars panel. */
export const SEED_NCRIT_OPTIONS = [
  { value: 0.5, label: '0.5 · dirty / turbulent tunnel' },
  { value: 1.5, label: '1.5 · typical free flight' },
  { value: 4, label: '4 · average wind tunnel' },
  { value: 7, label: '7 · clean wind tunnel' },
  { value: 9, label: '9 · smooth lab (XFOIL default)' },
] as const

/** Backend `PolarBody.model_size` (`backend/schemas.py`). */
export const SEED_MODEL_SIZE_OPTIONS = [
  { value: 'tiny', label: 'tiny · fastest' },
  { value: 'small', label: 'small' },
  { value: 'medium', label: 'medium' },
  { value: 'large', label: 'large' },
  { value: 'xlarge', label: 'xlarge · balanced (recommended)' },
] as const

export type SeedModelSize = (typeof SEED_MODEL_SIZE_OPTIONS)[number]['value']

export function nearestSeedNcrit(n: number): number {
  const opts = SEED_NCRIT_OPTIONS.map((o) => o.value)
  return opts.reduce((best, o) => (Math.abs(o - n) < Math.abs(best - n) ? o : best), opts[0]!)
}
