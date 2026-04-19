/** Log-spaced Reynolds samples for the distribution editor. */
export function logReSamples(lo: number, hi: number, n: number): number[] {
  const a = Math.max(1, Math.round(lo))
  const b = Math.max(a + 1, Math.round(hi))
  if (n < 2) return [a]
  const out: number[] = []
  const l0 = Math.log10(a)
  const l1 = Math.log10(b)
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    out.push(Math.round(10 ** (l0 + t * (l1 - l0))))
  }
  return out
}

export function clampReN(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.max(1, Math.min(6, Math.floor(n)))
}
