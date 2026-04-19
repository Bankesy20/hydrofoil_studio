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
import { clampReN, logReSamples } from '../logReSamples'
import { ReynoldsDistEditor } from './ReynoldsDistEditor'
import { AlphaSweepPanel } from './AlphaSweepPanel'
import { fmtRePolar, REYNOLDS_PRESETS } from '../polarPanelPresets'
import {
  nearestSeedNcrit,
  SEED_MODEL_SIZE_OPTIONS,
  SEED_NCRIT_OPTIONS,
  type SeedModelSize,
} from '../seedPolarNcritModel'
import { clamp, clampAlpha, clampReRange, RE_AXIS_MAX, RE_AXIS_MIN } from '../seedPolarLimits'

type SetHydro = (fn: (p: HydroFormState) => HydroFormState) => void

type Props = { form: HydroFormState; setHydro: SetHydro }

function IconSparkle() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden className="seed-polar-presets-icon">
      <path
        d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function parseReList(text: string): number[] {
  return text
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => Number(t))
    .filter((x) => Number.isFinite(x) && x > 0)
}

function applyParsedReToDist(
  nums: number[],
  setDistLo: (n: number) => void,
  setDistHi: (n: number) => void,
  setDistN: (n: number) => void,
) {
  if (nums.length >= 2) {
    const rawLo = Math.min(...nums.map((x) => Math.round(x)))
    const rawHi = Math.max(...nums.map((x) => Math.round(x)))
    const { lo, hi } = clampReRange(
      clamp(rawLo, RE_AXIS_MIN, RE_AXIS_MAX),
      clamp(rawHi, RE_AXIS_MIN, RE_AXIS_MAX),
    )
    setDistLo(lo)
    setDistHi(hi)
    setDistN(clampReN(nums.length))
  } else if (nums.length === 1) {
    const u = clamp(Math.round(nums[0]!), RE_AXIS_MIN, RE_AXIS_MAX)
    let lo = Math.max(RE_AXIS_MIN, Math.round(u / 5))
    let hi = Math.min(RE_AXIS_MAX, Math.round(u * 5))
    const pair = clampReRange(lo, hi)
    setDistLo(pair.lo)
    setDistHi(pair.hi)
    setDistN(4)
  }
}

export function SeedTab({ form, setHydro }: Props) {
  const workshopRef = useRef<FoilWorkshopHandle | null>(null)
  const [distLo, setDistLo] = useState(100_000)
  const [distHi, setDistHi] = useState(2_000_000)
  const [distN, setDistN] = useState(4)
  const [ncrit, setNcrit] = useState(7)
  const [modelSize, setModelSize] = useState<SeedModelSize>('xlarge')
  const [alpha0, setAlpha0] = useState(-5)
  const [alpha1, setAlpha1] = useState(5)
  const [alphaStep, setAlphaStep] = useState(0.25)
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
    setNcrit(nearestSeedNcrit(ncritDefault))
  }, [ncritDefault])

  useEffect(() => {
    const nums = parseReList(defaultReText)
    if (nums.length) applyParsedReToDist(nums, setDistLo, setDistHi, setDistN)
  }, [defaultReText, form.componentType])

  useEffect(() => {
    if (form.componentType === 'front_wing') {
      setAlpha0(-5)
      setAlpha1(15)
      setAlphaStep(0.5)
    } else {
      setAlpha0(-5)
      setAlpha1(5)
      setAlphaStep(0.25)
    }
  }, [form.componentType])

  async function computePolars() {
    setErr(null)
    setBusy(true)
    const w = workshopRef.current
    const myGen = ++analyzeGen.current
    const reList = logReSamples(distLo, distHi, distN)
    if (!reList.length) {
      setErr('Enter at least one Reynolds number')
      setBusy(false)
      return
    }
    const a0 = clampAlpha(alpha0)
    const a1 = clampAlpha(alpha1)
    const da = alphaStep
    if (![a0, a1, da].every(Number.isFinite) || da <= 0) {
      setErr('Enter valid α₀, α₁, and Δα (Δα must be positive).')
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

  const applyRePreset = useCallback((values: number[]) => {
    if (values.length < 1) return
    applyParsedReToDist(values, setDistLo, setDistHi, setDistN)
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

      <div className="seed-polar-stack">
        <div className="seed-polar-section">
          <div className="seed-polar-section-head">
            <span className="seed-polar-section-lbl">Reynolds numbers</span>
            <span className="seed-polar-section-hint">Drag handles to set range · log-spaced sampling</span>
          </div>
          <ReynoldsDistEditor
            lo={distLo}
            hi={distHi}
            n={distN}
            onChange={({ lo, hi, n }) => {
              setDistLo(lo)
              setDistHi(hi)
              setDistN(n)
            }}
          />
        </div>

        <div className="seed-polar-section">
          <div className="seed-polar-section-head">
            <span className="seed-polar-section-lbl seed-polar-presets-lbl">
              <IconSparkle /> Presets
            </span>
            <span className="seed-polar-section-hint">Click to load</span>
          </div>
          <div className="seed-polar-presets">
            {REYNOLDS_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                className="seed-polar-preset-chip"
                onClick={() => applyRePreset(p.values)}
              >
                <span className="seed-polar-preset-name">{p.name}</span>
                <span className="seed-polar-preset-sep">·</span>
                <span>{p.values.length} foils</span>
                <span className="seed-polar-preset-sep">·</span>
                <span>
                  {fmtRePolar(Math.min(...p.values))}–{fmtRePolar(Math.max(...p.values))}
                </span>
              </button>
            ))}
          </div>
        </div>

        <AlphaSweepPanel
          a0={alpha0}
          a1={alpha1}
          da={alphaStep}
          onChangeA0={setAlpha0}
          onChangeA1={setAlpha1}
          onChangeDa={setAlphaStep}
        />

        <div className="seed-polar-grid2">
          <label className="field seed-polar-ncrit-field">
            <span>Ncrit · transition criterion</span>
            <select value={ncrit} onChange={(e) => setNcrit(Number(e.target.value))}>
              {SEED_NCRIT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field seed-polar-ncrit-field">
            <span>NeuralFoil model</span>
            <select value={modelSize} onChange={(e) => setModelSize(e.target.value as SeedModelSize)}>
              {SEED_MODEL_SIZE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
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
