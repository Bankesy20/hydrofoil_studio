/**
 * Normalise `optimized_coords` / `seed_coords` from a job `result` into N×2
 * after JSON. Arrays can be nested `[[x,y],…]` or flat `[x0,y0,x1,y1,…]`.
 */
export function coordsFieldTo2d(val: unknown): number[][] | undefined {
  if (!Array.isArray(val) || val.length < 3) {
    return undefined
  }
  if (Array.isArray(val[0])) {
    const rows = val as number[][]
    const good = rows
      .filter(
        (r) =>
          Array.isArray(r) && r.length >= 2 && r.every((n) => typeof n === 'number' && Number.isFinite(n)),
      )
      .map((r) => [Number(r[0]), Number(r[1])] as [number, number])
    return good.length >= 3 ? good : undefined
  }
  if (typeof (val[0] as unknown) === 'number') {
    const flat = val as unknown as number[]
    const pairs: number[][] = []
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const a = flat[i]!
      const b = flat[i + 1]!
      if (Number.isFinite(a) && Number.isFinite(b)) {
        pairs.push([a, b])
      }
    }
    return pairs.length >= 3 ? pairs : undefined
  }
  return undefined
}
