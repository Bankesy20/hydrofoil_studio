import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HydroFormState } from '../hydroState'
import { buildNcritList, mastReAndSpeeds } from '../hydroState'
import {
  AXIS_ALPHA,
  type ByReBlock,
  buildAxisOptionValues,
  hasProfileData,
  type PolarChartSpec,
} from '../polarFlexPlot'
import {
  ChordCpAtAlphaBlock,
  defaultPolarCharts,
  GOLD_RE,
  BLUE_CMP,
  newChartId,
  PolarFlexChartRow,
} from './polarFlexShared'
import { FoilWorkshop, type FoilWorkshopHandle } from '../splineEditor/FoilWorkshop'
import { type MergedPolars, runMergedSeedPolars } from '../seedPolarsRun'

type SetHydro = (fn: (p: HydroFormState) => HydroFormState) => void

type Props = { form: HydroFormState; setHydro: SetHydro }

export function SeedTab({ form, setHydro }: Props) {
  const workshopRef = useRef<FoilWorkshopHandle | null>(null)
  const [reText, setReText] = useState('')
  const [ncrit, setNcrit] = useState(7)
  const [modelSize, setModelSize] = useState<'large' | 'xlarge'>('xlarge')
  const [alphaStartStr, setAlphaStartStr] = useState('-5')
  const [alphaEndStr, setAlphaEndStr] = useState('5')
  const [alphaStepStr, setAlphaStepStr] = useState('0.25')
  const [merged, setMerged] = useState<MergedPolars | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [polarCharts, setPolarCharts] = useState<PolarChartSpec[]>(() => defaultPolarCharts())
  const analyzeGen = useRef(0)

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

  async function computePolars() {
    setErr(null)
    setBusy(true)
    const w = workshopRef.current
    const myGen = ++analyzeGen.current
    const reList = reText
      .split(/[\s,;]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => Number(t))
      .filter((x) => Number.isFinite(x))
    if (!reList.length) {
      setErr('Enter at least one Reynolds number')
      setBusy(false)
      return
    }
    const a0 = parseFloat(alphaStartStr.trim())
    const a1 = parseFloat(alphaEndStr.trim())
    const da = parseFloat(alphaStepStr.trim())
    if (![a0, a1, da].every(Number.isFinite)) {
      setErr('Enter valid α start, α end, and Δα (numbers; negatives allowed for α range).')
      setBusy(false)
      return
    }
    try {
      if (!w) {
        setErr('Workshop not ready')
        setBusy(false)
        return
      }
      const inc = w.getPolarInclusion()
      const m = await runMergedSeedPolars(
        form,
        {
          re_list: reList,
          ncrit,
          model_size: modelSize,
          alpha_start: a0,
          alpha_end: a1,
          alpha_step: da,
        },
        inc,
      )
      if (myGen !== analyzeGen.current) return
      setMerged(m)
    } catch (e) {
      if (myGen === analyzeGen.current) {
        setErr(e instanceof Error ? e.message : String(e))
      }
    } finally {
      if (myGen === analyzeGen.current) setBusy(false)
    }
  }

  const byRe: ByReBlock | undefined = merged?.byRe
  const byReB: ByReBlock | null | undefined = merged?.byReB
  const extraByReList = merged?.extraByReList
  const chordExtraByRe = extraByReList && extraByReList.length > 0 ? extraByReList : undefined
  const primaryL = merged?.primaryLabel
  const compareL = merged?.compareLabel
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
    (key: string) => (axisOptions.includes(key) ? key : axisOptions[0] ?? AXIS_ALPHA),
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

  return (
    <div className="tab-seed">
      <FoilWorkshop
        ref={workshopRef}
        setHydro={setHydro}
        seedSource={form.seedSource}
        seedSectionId={form.seedSectionId}
      />
      {err && <p className="error">{err}</p>}

      <h3>NeuralFoil polars (multi-foil)</h3>
      <p className="hint">
        Foil 1 in the list is the primary (gold) curve; foil 2 is the first compare (blue) when 2+ are included; further
        foils use the extra colors. Recompute after editing — the canvas above is the geometry source of truth.
      </p>
      <label className="field">
        <span>Reynolds numbers (comma-separated)</span>
        <textarea
          rows={3}
          value={reText || defaultReText}
          onChange={(e) => setReText(e.target.value)}
        />
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
      <div className="row3">
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
        onClick={() => void computePolars()}
      >
        {busy ? 'Computing…' : 'Compute polars'}
      </button>

      {byRe && firstPolarBlock && hasProfileData(firstPolarBlock.detailed as Record<string, unknown>) && (
        <ChordCpAtAlphaBlock
          byRe={byRe as ByReBlock}
          byReB={byReB && Object.keys(byReB).length ? (byReB as ByReBlock) : null}
          chordExtraByRe={chordExtraByRe}
          golds={GOLD_RE}
          blues={BLUE_CMP}
          polarSignature={merged?.signature ?? ''}
          primaryLabel={primaryL}
          compareLabel={compareL || 'compare'}
        />
      )}

      {byRe && (
        <div className="polar-flex-section">
          <div className="polar-flex-header">
            <h4>Polar charts</h4>
            <p className="hint polar-flex-hint">
              For Cp(x/c) at a single α, use <strong>Chord Cp at α</strong> above. 3+ foils add as extra series on each
              chart. Two foils: primary and compare; one foil: primary only.
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
              byRe={byRe!}
              byReB={byReB ?? undefined}
              extraByReList={extraByReList}
              golds={GOLD_RE}
              blues={BLUE_CMP}
              onChange={(next) => setPolarCharts((rows) => rows.map((r) => (r.id === spec.id ? next : r)))}
              onRemove={() => removePolarChart(spec.id)}
              canRemove={polarCharts.length > 1}
              primaryLabel={primaryL}
              compareLabel={compareL || undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}
