/** Physical / UI bounds for seed polars Reynolds log axis. */
export const RE_AXIS_MIN = 100_000
export const RE_AXIS_MAX = 2_000_000
/** Minimum linear gap between min and max Re (drag + log sampling). */
export const RE_MIN_SPAN = 5_000

/** α sweep axis (preview + drag). */
export const ALPHA_AXIS_MIN = -20
export const ALPHA_AXIS_MAX = 20

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/** Ensure ordered min/max Re inside axis bounds with usable span. */
export function clampReRange(lo: number, hi: number): { lo: number; hi: number } {
  let a = clamp(Math.round(lo), RE_AXIS_MIN, RE_AXIS_MAX)
  let b = clamp(Math.round(hi), RE_AXIS_MIN, RE_AXIS_MAX)
  if (b < a) {
    const t = a
    a = b
    b = t
  }
  if (b - a < RE_MIN_SPAN) {
    b = Math.min(RE_AXIS_MAX, a + RE_MIN_SPAN)
    if (b - a < RE_MIN_SPAN) a = Math.max(RE_AXIS_MIN, b - RE_MIN_SPAN)
  }
  return { lo: a, hi: b }
}

export function clampAlpha(n: number): number {
  return clamp(n, ALPHA_AXIS_MIN, ALPHA_AXIS_MAX)
}
