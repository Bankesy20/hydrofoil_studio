/** Linear α samples for sweep preview. */
export function alphaSamples(a0: number, a1: number, da: number): number[] {
  if (!Number.isFinite(a0) || !Number.isFinite(a1) || !Number.isFinite(da) || da <= 0) return []
  const lo = Math.min(a0, a1)
  const hi = Math.max(a0, a1)
  const n = Math.floor((hi - lo) / da) + 1
  const out: number[] = []
  for (let i = 0; i < n && i < 400; i++) out.push(+(lo + i * da).toFixed(4))
  return out
}
