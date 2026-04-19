import { useEffect, useMemo, useRef, useState } from 'react'
import type { Data } from 'plotly.js'
import Plot from 'react-plotly.js'
import {
  AXIS_ALPHA,
  AXIS_X_CP,
  AXIS_X_DCP,
  axisTitle,
  type ByReBlock,
  buildFlexPolarTraces,
  classifyPlot,
  MULTI_FOIL_CHART_COLORS,
  type PolarChartSpec,
  profileVersusChord,
  type ProfileMatrixContext,
} from '../polarFlexPlot'
import {
  cdAxisRangemodeFragment,
  cpAeroConventionFragment,
  chartLayout,
  plotlyConfigHoverTools,
  plotlyConfigNoTools,
  studio,
} from '../plotTheme'

export const GOLD_RE = [studio.baseline, '#e6c266', '#ccaa55'] as const
export const BLUE_CMP = [studio.edited, studio.accent2, '#8bc4ff'] as const

const LOWER_CP = '#7ee787'
const LOWER_CP_COMPARE = '#5dd4a0'

export function newChartId(): string {
  return `pc-${Math.random().toString(36).slice(2, 10)}`
}

export function defaultPolarCharts(): PolarChartSpec[] {
  return [
    { id: newChartId(), xKey: AXIS_ALPHA, yKey: 'CL', profileStation: 16 },
    { id: newChartId(), xKey: 'CD', yKey: 'CL', profileStation: 16 },
  ]
}

type RowProps = {
  spec: PolarChartSpec
  axisOptions: string[]
  byRe: ByReBlock
  byReB?: ByReBlock
  /** 3+ airfoil polars (stacked in one chart) */
  extraByReList?: { byRe: ByReBlock; label: string }[]
  golds: readonly string[]
  blues: readonly string[]
  onChange: (next: PolarChartSpec) => void
  onRemove: () => void
  canRemove: boolean
  /** Passed to `buildFlexPolarTraces` (default seed) */
  primaryLabel?: string
  /** Passed to `buildFlexPolarTraces` (default compare) */
  compareLabel?: string
}

export function PolarFlexChartRow({
  spec,
  axisOptions,
  byRe,
  byReB,
  extraByReList,
  golds,
  blues,
  onChange,
  onRemove,
  canRemove,
  primaryLabel,
  compareLabel,
}: RowProps) {
  const mode = classifyPlot(spec.xKey, spec.yKey)
  const showStation = mode === 'alpha_profile'

  const { traces, error } = useMemo(
    () =>
      buildFlexPolarTraces({
        byRe,
        byReB: byReB && Object.keys(byReB).length ? byReB : null,
        extraByReList: extraByReList?.length ? extraByReList : undefined,
        xKey: spec.xKey,
        yKey: spec.yKey,
        profileStation: spec.profileStation,
        golds,
        blues,
        primaryLabel,
        compareLabel,
      }),
    [byRe, byReB, extraByReList, spec.xKey, spec.yKey, spec.profileStation, golds, blues, primaryLabel, compareLabel],
  )

  const layout = useMemo(() => {
    const cdFrag = cdAxisRangemodeFragment(spec.xKey, spec.yKey)
    const cpFrag = cpAeroConventionFragment(spec.xKey, spec.yKey)
    return chartLayout({
      xaxis: {
        title: { text: axisTitle(spec.xKey), font: { size: 12, color: studio.textMuted } },
        ...cdFrag.xaxis,
        ...cpFrag.xaxis,
      },
      yaxis: {
        title: { text: axisTitle(spec.yKey), font: { size: 12, color: studio.textMuted } },
        ...cdFrag.yaxis,
        ...cpFrag.yaxis,
      },
    })
  }, [spec.xKey, spec.yKey])

  const plotData = useMemo((): Data[] => {
    return traces.map((t) => ({
      type: 'scatter',
      mode: 'lines',
      x: t.x,
      y: t.y,
      name: t.name,
      line: t.line,
    }))
  }, [traces])

  return (
    <div className="polar-chart-card">
      <div className="polar-chart-controls">
        <label className="field polar-axis-field">
          <span>X</span>
          <select
            value={axisOptions.includes(spec.xKey) ? spec.xKey : axisOptions[0]}
            onChange={(e) => onChange({ ...spec, xKey: e.target.value })}
          >
            {axisOptions.map((k) => (
              <option key={`x-${k}`} value={k}>
                {axisTitle(k)}
              </option>
            ))}
          </select>
        </label>
        <label className="field polar-axis-field">
          <span>Y</span>
          <select
            value={axisOptions.includes(spec.yKey) ? spec.yKey : axisOptions[0]}
            onChange={(e) => onChange({ ...spec, yKey: e.target.value })}
          >
            {axisOptions.map((k) => (
              <option key={`y-${k}`} value={k}>
                {axisTitle(k)}
              </option>
            ))}
          </select>
        </label>
        {showStation && (
          <label className="field polar-station-field">
            <span>Chord station</span>
            <input
              type="number"
              min={0}
              max={31}
              value={spec.profileStation}
              onChange={(e) => onChange({ ...spec, profileStation: Math.min(31, Math.max(0, Number(e.target.value))) })}
            />
          </label>
        )}
        <div className="polar-chart-actions">
          <button type="button" className="ghost" disabled={!canRemove} onClick={onRemove} title="Remove chart">
            Remove
          </button>
        </div>
      </div>
      {error && <p className="error polar-chart-error">{error}</p>}
      {plotData.length > 0 && !error && (
        <div className="plot-chart">
          <Plot
            useResizeHandler
            data={plotData}
            layout={layout}
            config={plotlyConfigHoverTools}
            style={{ width: '100%', height: 440 }}
          />
        </div>
      )}
    </div>
  )
}

type ChordCpAtAlphaBlockProps = {
  byRe: ByReBlock
  byReB: ByReBlock | null
  /** 3+ foils for the same Cp@α view */
  chordExtraByRe?: { byRe: ByReBlock; label: string }[]
  golds: readonly string[]
  blues: readonly string[]
  /** Resets the α index to the default (nearest 0) when a new sweep arrives */
  polarSignature: string
  /** Legend tag for the primary airfoil (default: seed) */
  primaryLabel?: string
  /** Legend tag for the compare airfoil (default: compare) */
  compareLabel?: string
}

/**
 * Streamlit “Cp / dCp @ α”: one α, chordwise Cp = 1 − (u_e/V_∞)²; x is `x_cp` from
 * NeuralFoil's `bl_x_points` — midpoints of 32 equal chord cells, x/c = (2i+1)/64.
 */
export function ChordCpAtAlphaBlock({
  byRe,
  byReB,
  chordExtraByRe,
  golds,
  blues,
  polarSignature,
  primaryLabel = 'seed',
  compareLabel = 'compare',
}: ChordCpAtAlphaBlockProps) {
  const first = useMemo(() => {
    const k0 = Object.keys(byRe)[0]
    return k0 ? byRe[k0] : null
  }, [byRe])
  const alphas = (first?.alphas as number[] | undefined) ?? []
  const n = alphas.length
  const defaultIdx = useMemo(() => {
    if (!n) return 0
    let b = 0
    let bd = Math.abs(alphas[0]!)
    for (let i = 1; i < n; i += 1) {
      const d = Math.abs(alphas[i]!)
      if (d < bd) {
        bd = d
        b = i
      }
    }
    return b
  }, [alphas, n])
  const [cpAlphaIdx, setCpAlphaIdx] = useState(0)
  const prevSig = useRef('')
  useEffect(() => {
    if (polarSignature !== prevSig.current) {
      prevSig.current = polarSignature
      setCpAlphaIdx(defaultIdx)
    } else {
      setCpAlphaIdx((i) => (n ? Math.min(i, n - 1) : 0))
    }
  }, [polarSignature, defaultIdx, n])
  const [cpKind, setCpKind] = useState<'cp' | 'dcp'>('cp')
  const [cpSurface, setCpSurface] = useState<'upper' | 'lower' | 'both'>('both')

  const { plotData, layout } = useMemo(() => {
    const chX: typeof AXIS_X_CP | typeof AXIS_X_DCP = cpKind === 'cp' ? AXIS_X_CP : AXIS_X_DCP
    const profU: 'cp_upper' | 'dcp_upper' = cpKind === 'cp' ? 'cp_upper' : 'dcp_upper'
    const profL: 'cp_lower' | 'dcp_lower' = cpKind === 'cp' ? 'cp_lower' : 'dcp_lower'
    const j = Math.max(0, Math.min(n - 1, cpAlphaIdx))
    if (!n) {
      return {
        plotData: [] as Data[],
        layout: chartLayout({ xaxis: {}, yaxis: {} }),
      }
    }
    const alphaAt = alphas[j]!
    const traces: Data[] = []
    const push = (
      block: ByReBlock,
      isCmp: boolean,
      ovr?: { cU: string; cL: string; label: string },
    ) => {
      let ci = 0
      for (const rk of Object.keys(block)) {
        const row = block[rk]
        if (!row) continue
        const { detailed, matrix_shapes } = row
        const pctx: ProfileMatrixContext = { nAlpha: n, matrix_shapes }
        const cU = ovr?.cU ?? (isCmp ? blues : golds)[ci % (isCmp ? blues : golds).length]!
        const cL = ovr?.cL ?? (isCmp ? LOWER_CP_COMPARE : LOWER_CP)
        const seriesTag = ovr?.label ?? (isCmp ? compareLabel : primaryLabel)
        if (cpSurface === 'upper' || cpSurface === 'both') {
          const p = profileVersusChord(detailed, profU, j, chX, pctx)
          if (p) {
            traces.push({
              type: 'scatter',
              mode: 'lines',
              x: p.x,
              y: p.y,
              name: `${seriesTag} Re=${rk} upper α=${alphaAt.toFixed(2)}°`,
              line: { color: cU, width: isCmp ? 1.75 : 2.6 },
            })
          }
        }
        if (cpSurface === 'lower' || cpSurface === 'both') {
          const p = profileVersusChord(detailed, profL, j, chX, pctx)
          if (p) {
            traces.push({
              type: 'scatter',
              mode: 'lines',
              x: p.x,
              y: p.y,
              name: `${seriesTag} Re=${rk} lower α=${alphaAt.toFixed(2)}°`,
              line: { color: cL, width: isCmp ? 1.75 : 2.6 },
            })
          }
        }
        ci += 1
      }
    }
    push(byRe, false)
    if (byReB && Object.keys(byReB).length) push(byReB, true)
    if (chordExtraByRe) {
      chordExtraByRe.forEach((ex, j) => {
        const c = MULTI_FOIL_CHART_COLORS[j % MULTI_FOIL_CHART_COLORS.length]!
        push(ex.byRe, true, { cU: c, cL: c, label: ex.label })
      })
    }
    const xKey = chX
    const yKey =
      cpKind === 'cp' ? (cpSurface === 'lower' ? 'cp_lower' : 'cp_upper') : (cpSurface === 'lower' ? 'dcp_lower' : 'dcp_upper')
    const cpFrag = cpAeroConventionFragment(xKey, yKey)
    const yTitleText =
      cpKind === 'cp'
        ? cpSurface === 'both'
          ? 'Cp'
          : `Cp (${cpSurface})`
        : cpSurface === 'both'
          ? 'dCp'
          : `dCp (${cpSurface})`
    return {
      plotData: traces,
      layout: chartLayout({
        margin: { t: 50, b: 46, l: 54, r: 20 },
        xaxis: {
          title: { text: axisTitle(xKey), font: { size: 12, color: studio.textMuted } },
          ...cpFrag.xaxis,
          range: [0, 1] as [number, number],
        },
        yaxis: {
          title: { text: yTitleText, font: { size: 12, color: studio.textMuted } },
          ...cpFrag.yaxis,
        },
      }),
    }
  }, [
    byRe,
    byReB,
    chordExtraByRe,
    golds,
    blues,
    n,
    cpAlphaIdx,
    cpKind,
    cpSurface,
    alphas,
    primaryLabel,
    compareLabel,
  ])

  return (
    <div className="chord-cp-block">
      <div className="polar-flex-header">
        <h4>Chord Cp at α</h4>
        <p className="hint">
          Same pipeline as the Streamlit “Cp / dCp @ α” view: incompressible Cp = 1 − (u_e/V∞)² on NeuralFoil&rsquo;s 32
          per-side stations. The API <code>x_cp</code> is NeuralFoil&rsquo;s published <code>bl_x_points</code> —
          midpoints of 32 equal chord cells (x/c = (2i+1)/64 ≈ 0.0156 … 0.9844), so the LE and TE
          themselves are not sampled. Suction (negative) plots upward. The flexible polars with X=Top_Xtr
          and Y=cp are <em>not</em> this Cp(x/c) — they are a parametric (α) trace. For Cp(x/c) use this
          block, or in polars set X to x/c and Y to Cp.
        </p>
      </div>
      <div className="polar-chart-controls">
        <label className="field polar-axis-field">
          <span>α (index in sweep)</span>
          <select
            value={n ? String(Math.max(0, Math.min(n - 1, cpAlphaIdx))) : '0'}
            onChange={(e) => setCpAlphaIdx(Number(e.target.value))}
            disabled={!n}
          >
            {n
              ? alphas.map((a, i) => (
                  <option key={`a-${i}`} value={i}>
                    idx {i}: {a.toFixed(2)}°
                  </option>
                ))
              : null}
          </select>
        </label>
        <label className="field polar-axis-field">
          <span>Distribution</span>
          <select
            value={cpKind}
            onChange={(e) => setCpKind(e.target.value as 'cp' | 'dcp')}
          >
            <option value="cp">Cp</option>
            <option value="dcp">dCp (mid x)</option>
          </select>
        </label>
        <label className="field polar-axis-field">
          <span>Surface</span>
          <select
            value={cpSurface}
            onChange={(e) => setCpSurface(e.target.value as 'upper' | 'lower' | 'both')}
          >
            <option value="both">Upper and lower</option>
            <option value="upper">Upper</option>
            <option value="lower">Lower</option>
          </select>
        </label>
      </div>
      {plotData.length > 0 && (
        <div className="plot-chart chord-cp-plot">
          <Plot
            useResizeHandler
            data={plotData}
            layout={layout}
            config={plotlyConfigNoTools}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      )}
    </div>
  )
}
