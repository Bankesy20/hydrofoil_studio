import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Data } from 'plotly.js'
import Plot from 'react-plotly.js'
import * as api from '../api'
import { buildNcritList, mastReAndSpeeds, type HydroFormState } from '../hydroState'
import { coordsFieldTo2d } from '../resultGeometry'
import { AXIS_ALPHA, type ByReBlock, buildAxisOptionValues, hasProfileData, type PolarChartSpec } from '../polarFlexPlot'
import {
  ChordCpAtAlphaBlock,
  defaultPolarCharts,
  GOLD_RE,
  BLUE_CMP,
  newChartId,
  PolarFlexChartRow,
} from './polarFlexShared'
import {
  airfoilGeometryLayout,
  chartLayout,
  plotlyConfigNoTools,
  studio,
  traceCompareAirfoil,
  traceOptLine,
  traceSeedAirfoil,
} from '../plotTheme'

type Props = {
  form: HydroFormState
  jobId: string | null
  status: string | null
  convergence: number[]
  result: Record<string, unknown> | null
  error: string | null
  onCancel: () => void
}

export function OptimTab({ form, jobId, status, convergence, result, error, onCancel }: Props) {
  const [reText, setReText] = useState('')
  const [ncrit, setNcrit] = useState(7)
  const [modelSize, setModelSize] = useState<'large' | 'xlarge'>('xlarge')
  const [alphaStartStr, setAlphaStartStr] = useState('-5')
  const [alphaEndStr, setAlphaEndStr] = useState('5')
  const [alphaStepStr, setAlphaStepStr] = useState('0.25')
  const [polar, setPolar] = useState<Record<string, unknown> | null>(null)
  const [busy, setBusy] = useState(false)
  const [genErr, setGenErr] = useState<string | null>(null)
  const [polarCharts, setPolarCharts] = useState<PolarChartSpec[]>(() => defaultPolarCharts())
  const formRef = useRef(form)
  formRef.current = form
  const analyzeGen = useRef(0)

  const resultSig = useMemo(
    () =>
      result
        ? `${String(result.best_objective)}-${String(result.n_iterations)}-${String(result.drag_reduction_pct)}`
        : null,
    [result],
  )

  const defaultReText = useMemo(() => {
    if (form.componentType === 'mast') {
      const { Re_values } = mastReAndSpeeds(form)
      return Re_values.map((r) => String(Math.round(r))).join(', ')
    }
    return String(form.operatingPoints[0]?.Re ?? 800000)
  }, [form])

  const ncritDefault = useMemo(() => {
    const n = buildNcritList(form)
    return Array.isArray(n) ? n[Math.floor(n.length / 2)] : n
  }, [form])

  useEffect(() => {
    setNcrit(ncritDefault)
    setReText((t) => (t ? t : defaultReText))
    if (form.componentType === 'front_wing') {
      setAlphaStartStr('-5')
      setAlphaEndStr('15')
      setAlphaStepStr('0.5')
    } else {
      setAlphaStartStr('-5')
      setAlphaEndStr('5')
      setAlphaStepStr('0.25')
    }
  }, [defaultReText, ncritDefault, form.componentType])

  useEffect(() => {
    if (!resultSig) return
    setPolar(null)
    setGenErr(null)
    setPolarCharts(defaultPolarCharts())
  }, [resultSig])

  const optCoords = result ? coordsFieldTo2d(result.optimized_coords) : undefined
  const seedCoords = result ? coordsFieldTo2d(result.seed_coords) : undefined

  const convTrace = useMemo((): Data[] => {
    if (!convergence.length) return []
    return [
      {
        ...traceOptLine,
        x: convergence.map((_, i) => i + 1),
        y: convergence,
        name: 'best objective',
      },
    ]
  }, [convergence])

  const convLayout = chartLayout({
    xaxis: { title: { text: 'generation', font: { size: 12, color: studio.textMuted } } },
    yaxis: { title: { text: 'objective', font: { size: 12, color: studio.textMuted } } },
  })

  const airfoilLayout = airfoilGeometryLayout()

  const byRe = polar?.by_re as
    | Record<string, { detailed: Record<string, number[]>; alphas: number[] }>
    | undefined
  const byReB = polar?.by_re_b as typeof byRe | undefined

  const firstPolarBlock = useMemo(() => {
    if (!byRe) return null
    const k = Object.keys(byRe)[0]
    return k ? byRe[k] : null
  }, [byRe])

  const axisOptions = useMemo(() => {
    if (!firstPolarBlock) {
      return [AXIS_ALPHA, 'CL', 'CD', 'CM', 'Cpmin', 'Top_Xtr', 'Bot_Xtr']
    }
    return buildAxisOptionValues(firstPolarBlock.detailed as Record<string, unknown>, firstPolarBlock.alphas.length)
  }, [firstPolarBlock])

  const ensureAxisInList = useCallback(
    (key: string) => (axisOptions.includes(key) ? key : (axisOptions[0] ?? AXIS_ALPHA)),
    [axisOptions],
  )

  const addPolarChart = useCallback(() => {
    setPolarCharts((rows) => [
      ...rows,
      {
        id: newChartId(),
        xKey: ensureAxisInList(AXIS_ALPHA),
        yKey: ensureAxisInList('CD'),
        profileStation: 16,
      },
    ])
  }, [ensureAxisInList])

  const removePolarChart = useCallback((id: string) => {
    setPolarCharts((rows) => (rows.length <= 1 ? rows : rows.filter((r) => r.id !== id)))
  }, [])

  async function computeResultPolars() {
    if (!optCoords || !seedCoords) {
      setGenErr('Missing seed or optimised coordinates in the job result.')
      return
    }
    setGenErr(null)
    setBusy(true)
    const f = formRef.current
    const reList = reText
      .split(/[\s,;]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => Number(t))
      .filter((x) => Number.isFinite(x))
    if (!reList.length) {
      setGenErr('Enter at least one Reynolds number')
      setBusy(false)
      return
    }
    const a0 = parseFloat(alphaStartStr.trim())
    const a1 = parseFloat(alphaEndStr.trim())
    const da = parseFloat(alphaStepStr.trim())
    if (![a0, a1, da].every(Number.isFinite)) {
      setGenErr('Enter valid α start, α end, and Δα (numbers; negatives allowed for α range).')
      setBusy(false)
      return
    }
    const t = f.componentType === 'mast' ? f.teThicknessPct / 100 : null
    const myGen = ++analyzeGen.current
    const body: Record<string, unknown> = {
      component_type: f.componentType,
      chord_mm: f.chordMm,
      te_thickness: t,
      seed_airfoil: { kind: 'coordinates' as const, coordinates: optCoords },
      compare: { kind: 'coordinates' as const, coordinates: seedCoords, legend: 'seed' },
      compute_polars: true,
      polar: {
        re_list: reList,
        ncrit,
        model_size: modelSize,
        alpha_start: a0,
        alpha_end: a1,
        alpha_step: da,
      },
    }
    try {
      const r = await api.postSeedAnalyze(body)
      if (myGen !== analyzeGen.current) return
      setPolar((r.polars as Record<string, unknown>) ?? null)
    } catch (e) {
      if (myGen === analyzeGen.current) {
        setGenErr(e instanceof Error ? e.message : String(e))
      }
    } finally {
      if (myGen === analyzeGen.current) setBusy(false)
    }
  }

  return (
    <div className="tab-optim">
      {error && <p className="error">{error}</p>}
      {jobId && (
        <p className="status-line">
          Job <code>{jobId}</code> — {status ?? '…'}
          {(status === 'running' || status === 'pending') && (
            <button type="button" className="ghost" onClick={onCancel}>
              Cancel
            </button>
          )}
        </p>
      )}
      {!jobId && !result && <p className="muted">Use Run optimization in the sidebar.</p>}

      {convTrace.length > 0 && (
        <div className="plot-chart">
          <Plot
            useResizeHandler
            data={convTrace}
            layout={convLayout}
            config={plotlyConfigNoTools}
            style={{ width: '100%', height: 360 }}
          />
        </div>
      )}

      {optCoords && seedCoords && (
        <div className="plot-chart">
          <Plot
            useResizeHandler
            data={
              [
                {
                  ...traceSeedAirfoil,
                  x: seedCoords.map((p) => p[0]),
                  y: seedCoords.map((p) => p[1]),
                  name: 'seed',
                },
                {
                  ...traceCompareAirfoil,
                  x: optCoords.map((p) => p[0]),
                  y: optCoords.map((p) => p[1]),
                  name: 'optimised',
                },
              ] as Data[]
            }
            layout={airfoilLayout}
            config={plotlyConfigNoTools}
            style={{ width: '100%', height: 400 }}
          />
        </div>
      )}

      {optCoords && seedCoords && result && (
        <section className="optim-polar-section">
          <h3>Result polars (NeuralFoil)</h3>
          <p className="hint">
            The optimisation run may have used a different α sweep or Re list. Recompute with the same controls as the
            <strong> Seed airfoil</strong> tab: flexible axis charts, chord Cp, and your choice of Reynolds, N
            <sub>crit</sub>, and model size. Primary airfoil is the <em>optimised</em> shape; the thin traces are the
            original seed.
          </p>
          {genErr && <p className="error">{genErr}</p>}
          <label className="field">
            <span>Reynolds numbers (comma-separated)</span>
            <textarea rows={3} value={reText || defaultReText} onChange={(e) => setReText(e.target.value)} />
          </label>
          <div className="row2">
            <label>
              Ncrit
              <input type="number" value={ncrit} step={0.5} onChange={(e) => setNcrit(Number(e.target.value))} />
            </label>
            <label>
              Model
              <select value={modelSize} onChange={(e) => setModelSize(e.target.value as 'large' | 'xlarge')}>
                <option>large</option>
                <option>xlarge</option>
              </select>
            </label>
          </div>
          <div className="row2">
            <label>
              α start
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={alphaStartStr}
                onChange={(e) => setAlphaStartStr(e.target.value)}
              />
            </label>
            <label>
              α end
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={alphaEndStr}
                onChange={(e) => setAlphaEndStr(e.target.value)}
              />
            </label>
            <label>
              Δα
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={alphaStepStr}
                onChange={(e) => setAlphaStepStr(e.target.value)}
              />
            </label>
          </div>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void computeResultPolars()}
          >
            {busy ? 'Computing…' : 'Compute polars'}
          </button>

          {byRe && firstPolarBlock && hasProfileData(firstPolarBlock.detailed as Record<string, unknown>) && (
            <ChordCpAtAlphaBlock
              byRe={byRe as ByReBlock}
              byReB={byReB && Object.keys(byReB).length ? (byReB as ByReBlock) : null}
              golds={GOLD_RE}
              blues={BLUE_CMP}
              primaryLabel="optimised"
              compareLabel="seed"
              polarSignature={`${(firstPolarBlock.alphas as number[]).join(',')}|${Object.keys(byRe).join(',')}`}
            />
          )}

          {byRe && (
            <div className="polar-flex-section">
              <div className="polar-flex-header">
                <h4>Polar charts</h4>
                <p className="hint polar-flex-hint">
                  Gold traces: optimised. Blue: seed. Adjust X and Y to plot any available series, add charts, or
                  set chordwise station for profile data.
                </p>
                <button type="button" className="ghost" onClick={addPolarChart}>
                  + Add chart
                </button>
              </div>

              {polarCharts.map((spec) => (
                <PolarFlexChartRow
                  key={spec.id}
                  spec={spec}
                  axisOptions={axisOptions}
                  byRe={byRe}
                  byReB={byReB}
                  golds={GOLD_RE}
                  blues={BLUE_CMP}
                  primaryLabel="optimised"
                  compareLabel="seed"
                  onChange={(next) => setPolarCharts((rows) => rows.map((r) => (r.id === spec.id ? next : r)))}
                  onRemove={() => removePolarChart(spec.id)}
                  canRemove={polarCharts.length > 1}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {result && (
        <pre className="mono-block small">
          {JSON.stringify(
            {
              best_objective: result.best_objective,
              n_iterations: result.n_iterations,
              drag_reduction_pct: result.drag_reduction_pct,
              opt_tc: result.opt_tc,
            },
            null,
            2,
          )}
        </pre>
      )}
    </div>
  )
}
