/**
 * Flexible polar plotting: map API `detailed` + `alphas` to arbitrary X/Y series,
 * including chordwise Cp / dCp profiles and derived sweep quantities.
 */

/**
 * Cp / dCp arrays from the API: numpy (n_st, n_α) → JSON row-major, default shape [32, n] or dCp [31, n].
 * The 32 station x/c locations come from `detailed.x_cp` (= NeuralFoil's `bl_x_points`,
 * midpoints of 32 equal chord cells: (2i+1)/64 ≈ 0.0156 … 0.9844).
 */
export type ProfileMatrixContext = {
  nAlpha: number
  matrix_shapes?: Record<string, [number, number]>
}

export type RePolarBlock = {
  detailed: Record<string, unknown>
  alphas: number[]
  /** Server-side (rows, cols) of each profile matrix, before JSON, from numpy; disambiguates edge cases. */
  matrix_shapes?: Record<string, [number, number]>
}

export type ByReBlock = Record<string, RePolarBlock>

export type PolarChartSpec = {
  id: string
  /** Logical axis key (see POLAR_AXIS_META) */
  xKey: string
  yKey: string
  /** When plotting Cp vs α (or dCp vs α), chordwise station index 0…nStations-1 */
  profileStation: number
}

export const AXIS_ALPHA = 'alpha'
export const AXIS_X_CP = 'x_cp'
export const AXIS_X_DCP = 'x_dcp_mid'

/** Y-only profile series (2D in API: shape [nStations, nAlpha]) */
export const PROFILE_Y_KEYS = ['cp_upper', 'cp_lower', 'dcp_upper', 'dcp_lower'] as const

const PROFILE_KEYS_SET = new Set<string>(PROFILE_Y_KEYS)

const N_ST_CP = 32
const N_ST_DCP = 31

function nStationsForKey(profileKey: string): 31 | 32 {
  return profileKey.startsWith('dcp_') ? N_ST_DCP : N_ST_CP
}

/**
 * Resolves how the 2D JSON list maps to (station, α) indices.
 * Python stores row = station, col = α. If a bug ever transposed to (n_α, 32) we read [α][st].
 */
export function resolveProfileLayout(
  m: number[][],
  profileKey: string,
  nAlpha: number,
  matrix_shapes?: Record<string, [number, number]>,
): 'stations' | 'alpha' {
  if (!m.length || !m[0]?.length) return 'stations'
  const nSt = nStationsForKey(profileKey)
  const sh = matrix_shapes?.[profileKey]
  if (sh) {
    const [r, c] = sh
    if (r === nSt && c === nAlpha) return 'stations'
    if (c === nSt && r === nAlpha) return 'alpha'
  }
  const R = m.length
  const C = m[0].length
  if (R === nSt && C === nAlpha) return 'stations'
  if (C === nSt && R === nAlpha) return 'alpha'
  if (R === 32 && C === nAlpha) return 'stations' // dcp: 32 cannot happen; cp ok
  if (C === 32 && R === nAlpha) return 'alpha'
  if (R === 31 && C === nAlpha) return 'stations'
  if (C === 31 && R === nAlpha) return 'alpha'
  return 'stations'
}

const DERIVED_KEYS = ['dCL/dα', 'dCM/dα', 'dCD/dα'] as const

export function xDcpMidFromXCp(xCp: number[]): number[] {
  if (xCp.length < 2) return []
  const out: number[] = []
  for (let i = 0; i < xCp.length - 1; i++) out.push(0.5 * (xCp[i] + xCp[i + 1]))
  return out
}

function dydxCentral(y: number[], x: number[]): number[] {
  const n = y.length
  if (n !== x.length || n < 2) return y.map(() => Number.NaN)
  const g = new Array<number>(n)
  g[0] = (y[1] - y[0]) / (x[1] - x[0])
  g[n - 1] = (y[n - 1] - y[n - 2]) / (x[n - 1] - x[n - 2])
  for (let i = 1; i < n - 1; i++) g[i] = (y[i + 1] - y[i - 1]) / (x[i + 1] - x[i - 1])
  return g
}

function asNumberArray(v: unknown, len?: number): number[] | null {
  if (!Array.isArray(v) || v.length === 0) return null
  if (typeof v[0] !== 'number' || !Number.isFinite(v[0])) return null
  const a = v as number[]
  if (len !== undefined && a.length !== len) return null
  return a
}

function isProfileMatrix(v: unknown): v is number[][] {
  return Array.isArray(v) && v.length > 0 && Array.isArray(v[0]) && typeof (v[0] as number[])[0] === 'number'
}

/** Keys in `detailed` that are one value per alpha (same length as alphas). */
export function discoverSweepKeys(detailed: Record<string, unknown>, nAlpha: number): string[] {
  const keys: string[] = []
  for (const [k, v] of Object.entries(detailed)) {
    if (PROFILE_Y_KEYS.includes(k as (typeof PROFILE_Y_KEYS)[number])) continue
    if (k === 'x_cp') continue
    const a = asNumberArray(v, nAlpha)
    if (a) keys.push(k)
  }
  return keys.sort((a, b) => a.localeCompare(b))
}

export function hasProfileData(detailed: Record<string, unknown>): boolean {
  return PROFILE_Y_KEYS.some((k) => isProfileMatrix(detailed[k]))
}

function getDerived(detailed: Record<string, unknown>, alphas: number[], key: string): number[] | null {
  const al = asNumberArray(alphas)
  if (!al) return null
  if (key === 'dCL/dα') {
    const cl = asNumberArray(detailed.CL, al.length)
    return cl ? dydxCentral(cl, al) : null
  }
  if (key === 'dCM/dα') {
    const cm = asNumberArray(detailed.CM, al.length)
    return cm ? dydxCentral(cm, al) : null
  }
  if (key === 'dCD/dα') {
    const cd = asNumberArray(detailed.CD, al.length)
    return cd ? dydxCentral(cd, al) : null
  }
  return null
}

/**
 * Resolve a logical axis key to a numeric series for one Re block.
 * Returns null if unavailable or wrong dimensionality.
 */
export function resolveSweepSeries(
  key: string,
  detailed: Record<string, unknown>,
  alphas: number[],
): number[] | null {
  if (key === AXIS_ALPHA) return asNumberArray(alphas)
  if (key === AXIS_X_CP) return asNumberArray(detailed.x_cp)
  if (key === AXIS_X_DCP) {
    const xc = asNumberArray(detailed.x_cp)
    return xc ? xDcpMidFromXCp(xc) : null
  }
  const d = getDerived(detailed, alphas, key)
  if (d) return d
  const v = detailed[key]
  const n = alphas.length
  const arr = asNumberArray(v)
  if (!arr || arr.length !== n) return null
  return arr
}

/** One column of a profile matrix vs alpha (fixed chord station). */
export function profileVersusAlpha(
  detailed: Record<string, unknown>,
  profileKey: string,
  alphas: number[],
  stationIndex: number,
  ctx?: ProfileMatrixContext,
): number[] | null {
  const m = detailed[profileKey]
  if (!isProfileMatrix(m) || !alphas.length) return null
  const nAlpha = alphas.length
  const lay = resolveProfileLayout(m, profileKey, nAlpha, ctx?.matrix_shapes)
  const st = Math.max(0, Math.min(nStationsForKey(profileKey) - 1, Math.floor(stationIndex)))
  if (lay === 'stations') {
    if (m[0].length !== nAlpha) return null
    if (m.length < st + 1) return null
    const out: number[] = []
    for (let a = 0; a < nAlpha; a++) out.push(m[st][a] ?? Number.NaN)
    return out
  }
  // rows = α, cols = station
  if (m.length !== nAlpha) return null
  if (m[0].length < st + 1) return null
  const out: number[] = []
  for (let a = 0; a < nAlpha; a++) out.push(m[a][st] ?? Number.NaN)
  return out
}

/** Chordwise profile y vs x for one alpha index (one curve). */
export function profileVersusChord(
  detailed: Record<string, unknown>,
  profileKey: string,
  alphaIndex: number,
  xKey: typeof AXIS_X_CP | typeof AXIS_X_DCP,
  ctx?: ProfileMatrixContext,
): { x: number[]; y: number[] } | null {
  const m = detailed[profileKey]
  if (!isProfileMatrix(m)) return null
  const inferred = m[0]?.length ?? 0
  const nAlpha = ctx?.nAlpha ?? inferred
  if (!nAlpha) return null
  const layout = resolveProfileLayout(m, profileKey, nAlpha, ctx?.matrix_shapes)
  const xc = asNumberArray(detailed.x_cp)
  if (!xc) return null
  const nSt = nStationsForKey(profileKey)
  const ai = Math.max(0, Math.min(nAlpha - 1, Math.floor(alphaIndex)))
  if (xKey === AXIS_X_CP) {
    if (xc.length !== N_ST_CP) return null
    const y: number[] = []
    if (layout === 'stations') {
      for (let st = 0; st < m.length; st++) y.push(m[st]![ai] ?? Number.NaN)
    } else {
      for (let st = 0; st < nSt; st++) y.push(m[ai]![st] ?? Number.NaN)
    }
    if (y.length !== xc.length) return null
    return { x: [...xc], y }
  }
  if (xc.length !== N_ST_CP) return null
  const xd = xDcpMidFromXCp(xc)
  if (xd.length !== N_ST_DCP) return null
  const y: number[] = []
  if (layout === 'stations') {
    for (let st = 0; st < m.length; st++) y.push(m[st]![ai] ?? Number.NaN)
  } else {
    for (let st = 0; st < nSt; st++) y.push(m[ai]![st] ?? Number.NaN)
  }
  if (y.length !== xd.length) return null
  return { x: xd, y }
}

export type PlotMode = 'sweep' | 'chord_profile' | 'alpha_profile' | 'invalid'

export function classifyPlot(xKey: string, yKey: string): PlotMode {
  const xProf = PROFILE_KEYS_SET.has(xKey)
  const yProf = PROFILE_KEYS_SET.has(yKey)
  const xChord = xKey === AXIS_X_CP || xKey === AXIS_X_DCP
  const yChord = yKey === AXIS_X_CP || yKey === AXIS_X_DCP
  if (xProf && yProf) return 'invalid'
  if ((xChord && yProf) || (yChord && xProf)) return 'chord_profile'
  if (xProf || yProf) return 'alpha_profile'
  return 'sweep'
}

function subsampleIndices(n: number, maxTraces: number): number[] {
  if (n <= 0) return []
  if (n <= maxTraces) return Array.from({ length: n }, (_, i) => i)
  const out: number[] = []
  for (let t = 0; t < maxTraces; t++) {
    out.push(Math.round((t * (n - 1)) / Math.max(1, maxTraces - 1)))
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

/** Resolve one axis for sweep or α–profile plots (station only applies to Cp matrices). */
export function resolveAxisSeries(
  key: string,
  detailed: Record<string, unknown>,
  alphas: number[],
  profileStation: number,
  profileCtx?: ProfileMatrixContext,
): number[] | null {
  if (PROFILE_KEYS_SET.has(key)) {
    return profileVersusAlpha(detailed, key, alphas, profileStation, profileCtx)
  }
  return resolveSweepSeries(key, detailed, alphas)
}

export function axisTitle(key: string): string {
  if (key === AXIS_ALPHA) return 'α (°)'
  if (key === AXIS_X_CP) return 'x/c  (NeuralFoil BL stations)' /* nf.bl_x_points: midpoints of 32 equal chord cells */
  if (key === AXIS_X_DCP) return 'x/c  (dCp at midpoints between stations)'
  return key
}

/** Options for X/Y dropdowns: fixed specials + API keys + derived. */
export function buildAxisOptionValues(detailed: Record<string, unknown>, nAlpha: number): string[] {
  const base = [AXIS_ALPHA, AXIS_X_CP, AXIS_X_DCP, ...discoverSweepKeys(detailed, nAlpha), ...DERIVED_KEYS]
  const prof = PROFILE_Y_KEYS.filter((k) => isProfileMatrix(detailed[k]))
  return [...new Set([...base, ...prof])]
}

export type FlexTrace = {
  x: number[]
  y: number[]
  name: string
  line?: { color?: string; width?: number; dash?: 'dash' | 'dot' | 'solid' }
}

/** Extra polars (3+ airfoils) after primary + first compare */
export const MULTI_FOIL_CHART_COLORS = [
  '#5dd4a0',
  '#c792ea',
  '#e6a84e',
  '#ff7a7a',
  '#56b3fa',
] as const

export function buildFlexPolarTraces(opts: {
  byRe: ByReBlock
  byReB?: ByReBlock | null
  /** 3+ foils: more families, same x/y and station semantics */
  extraByReList?: { byRe: ByReBlock; label: string }[]
  xKey: string
  yKey: string
  profileStation: number
  /** Max chordwise curves per Re (alpha subsample) */
  maxProfileTracesPerRe?: number
  golds: readonly string[]
  blues: readonly string[]
  /** Legend prefix for the primary (byRe) family; default "seed" */
  primaryLabel?: string
  /** Legend prefix for the compare (byReB) family; default "compare" */
  compareLabel?: string
}): { traces: FlexTrace[]; error: string | null } {
  const {
    byRe,
    byReB,
    extraByReList,
    xKey,
    yKey,
    profileStation,
    maxProfileTracesPerRe = 24,
    golds,
    blues,
    primaryLabel = 'seed',
    compareLabel = 'compare',
  } = opts
  const mode = classifyPlot(xKey, yKey)
  if (mode === 'invalid') {
    return {
      traces: [],
      error:
        'This X/Y pair is not supported (use one Cp surface matrix vs x/c, or one matrix vs a sweep variable with a station index).',
    }
  }
  {
    const misleading = explainMisleadingAlphaProfile(xKey, yKey, mode)
    if (misleading) return { traces: [], error: misleading }
  }

  const traces: FlexTrace[] = []

  const processBlock = (
    block: ByReBlock,
    colors: readonly string[],
    isCompare: boolean,
    labelPrefix: string,
  ): string | null => {
    let ci = 0
    for (const rk of Object.keys(block)) {
      const row = block[rk]!
      const { detailed, alphas } = row
      const a = asNumberArray(alphas)
      if (!a) return `Missing alphas for Re=${rk}`
      const pctx: ProfileMatrixContext = { nAlpha: a.length, matrix_shapes: row.matrix_shapes }

      if (mode === 'sweep') {
        const xs = resolveSweepSeries(xKey, detailed, a)
        const ys = resolveSweepSeries(yKey, detailed, a)
        if (!xs || !ys) return `Missing series for Re=${rk} (${xKey} / ${yKey})`
        if (xs.length !== ys.length) {
          return `Length mismatch for Re=${rk}: ${xKey} (${xs.length}) vs ${yKey} (${ys.length})`
        }
        traces.push({
          x: xs,
          y: ys,
          name: `${labelPrefix} Re=${rk}`,
          line: {
            color: colors[ci % colors.length],
            width: isCompare ? 1.45 : 2,
          },
        })
        ci += 1
      } else if (mode === 'alpha_profile') {
        const xs = resolveAxisSeries(xKey, detailed, a, profileStation, pctx)
        const ys = resolveAxisSeries(yKey, detailed, a, profileStation, pctx)
        if (!xs || !ys) return `Missing data for Re=${rk} (${xKey} / ${yKey})`
        if (xs.length !== ys.length) {
          return `Length mismatch for Re=${rk}: ${xKey} (${xs.length}) vs ${yKey} (${ys.length})`
        }
        traces.push({
          x: xs,
          y: ys,
          name: `${labelPrefix} Re=${rk} st=${profileStation}`,
          line: {
            color: colors[ci % colors.length],
            width: isCompare ? 1.45 : 2,
          },
        })
        ci += 1
      } else if (mode === 'chord_profile') {
        const ck = chordProfileKeys(xKey, yKey)
        if (!ck) return 'Chord profile: pair x/c (Cp or dCp grid) with one surface matrix.'
        const { chordXKey, profKey } = ck
        const idxs = subsampleIndices(a.length, maxProfileTracesPerRe)
        for (const j of idxs) {
          const pr = profileVersusChord(detailed, profKey, j, chordXKey, pctx)
          if (!pr) continue
          const userWantsXChordFirst = xKey === AXIS_X_CP || xKey === AXIS_X_DCP
          traces.push({
            x: userWantsXChordFirst ? pr.x : pr.y,
            y: userWantsXChordFirst ? pr.y : pr.x,
            name: `${labelPrefix} Re=${rk} α=${a[j].toFixed(2)}°`,
            line: {
              color: colors[ci % colors.length],
              width: isCompare ? 1.05 : 1.35,
            },
          })
        }
        ci += 1
      }
    }
    return null
  }

  const err = processBlock(byRe, golds, false, primaryLabel)
  if (err) return { traces: [], error: err }
  if (byReB && Object.keys(byReB).length) {
    const errB = processBlock(byReB, blues, true, compareLabel)
    if (errB) return { traces: [], error: errB }
  }
  for (let fi = 0; fi < (extraByReList?.length ?? 0); fi += 1) {
    const ex = extraByReList![fi]!
    const c = [MULTI_FOIL_CHART_COLORS[fi % MULTI_FOIL_CHART_COLORS.length]!] as const
    const errX = processBlock(ex.byRe, c, true, ex.label)
    if (errX) return { traces: [], error: errX }
  }

  return { traces, error: traces.length ? null : 'No traces produced (check axes and data).' }
}

function chordProfileKeys(
  xKey: string,
  yKey: string,
): { chordXKey: typeof AXIS_X_CP | typeof AXIS_X_DCP; profKey: string } | null {
  let chordXKey: typeof AXIS_X_CP | typeof AXIS_X_DCP | null = null
  let profKey: string | null = null
  if (xKey === AXIS_X_CP || xKey === AXIS_X_DCP) {
    chordXKey = xKey as typeof AXIS_X_CP
    if (xKey === AXIS_X_DCP) chordXKey = AXIS_X_DCP
    if (PROFILE_KEYS_SET.has(yKey)) profKey = yKey
  } else if (yKey === AXIS_X_CP || yKey === AXIS_X_DCP) {
    chordXKey = yKey as typeof AXIS_X_CP
    if (yKey === AXIS_X_DCP) chordXKey = AXIS_X_DCP
    if (PROFILE_KEYS_SET.has(xKey)) profKey = xKey
  }
  if (!chordXKey || !profKey) return null
  return { chordXKey, profKey }
}

function isChordwiseProfileKey(k: string): boolean {
  return k === 'cp_upper' || k === 'cp_lower' || k === 'dcp_upper' || k === 'dcp_lower'
}

/** Cp on Y vs Top_Xtr on X (etc.) is not Cp(x/c); it is two scalars along α. Block and point users to a chord Cp view. */
function explainMisleadingAlphaProfile(xKey: string, yKey: string, mode: PlotMode): string | null {
  if (mode !== 'alpha_profile') return null
  const pX = PROFILE_KEYS_SET.has(xKey)
  const pY = PROFILE_KEYS_SET.has(yKey)
  if (!pX && !pY) return null
  if (pX && pY) return null
  const profKey = pX ? xKey : yKey
  const sweepKey = pX ? yKey : xKey
  if (!isChordwiseProfileKey(profKey)) return null
  if (sweepKey === AXIS_ALPHA) return null
  if (sweepKey === AXIS_X_CP || sweepKey === AXIS_X_DCP) return null
  if (sweepKey !== 'Top_Xtr' && sweepKey !== 'Bot_Xtr') return null
  return [
    'This pair is not a chordwise Cp (or dCp) plot: Top_Xtr and Bot_Xtr are transition vs α, not x/c on the airfoil.',
    'To plot a classic Cp(x/c) curve, set X to “x/c (NeuralFoil BL stations)”, Y to Cp upper/lower, and pick α via subsampled lines in the chord view—or use the “Chord Cp at α” block below. ',
    'The “Chord station” number here indexes the 32 Cp points along the chord (at x/c = (2i+1)/64), not a similarity-variable axis.',
  ].join('')
}
