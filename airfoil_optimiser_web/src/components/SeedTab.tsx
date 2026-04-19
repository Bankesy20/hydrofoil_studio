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
import { DraftNumberInput } from './DraftNumberInput'
import {
  nearestSeedNcrit,
  SEED_MODEL_SIZE_OPTIONS,
  SEED_NCRIT_OPTIONS,
  type SeedModelSize,
} from '../seedPolarNcritModel'
import { clamp, clampAlpha, clampReRange, RE_AXIS_MAX, RE_AXIS_MIN } from '../seedPolarLimits'

type SetHydro = (fn: (p: HydroFormState) => HydroFormState) => void

type Props = { form: HydroFormState; setHydro: SetHydro }

function parseReList(text: string): number[] {
  return text
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => Number(t))
    .filter((x) => Number.isFinite(x) && x > 0)
}

export function SeedTab({ form, setHydro }: Props) {
  const workshopRef = useRef<FoilWorkshopHandle | null>(null)
  const [distLo, setDistLo] = useState(100_000)
  const [distHi, setDistHi] = useState(2_000_000)
  const [distN, setDistN] = useState(4)
  const [singleReMode, setSingleReMode] = useState(false)
  const [singleReValue, setSingleReValue] = useState(800_000)
  const [ncrit, setNcrit] = useState(7)
  const [modelSize, setModelSize] = useState<SeedModelSize>('xlarge')
  const [alpha0, setAlpha0] = useState(-5)
  const [alpha1, setAlpha1] = useState(5)
  const [alphaStep, setAlphaStep] = useState(0.25)
  const [merged, setMerged] = useState<MergedPolars | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [polarCharts, setPolarCharts] = useState<PolarChartSpec[]>(() => defaultPolarCharts())
  const [autoCompute, setAutoCompute] = useState(false)
  const [geometryChangeTick, setGeometryChangeTick] = useState(0)
  const analyzeGen = useRef(0)
  const autoPendingRef = useRef(false)
  const autoTimerRef = useRef<number | null>(null)
  const busyRef = useRef(false)
  const computeRef = useRef<(() => Promise<void>) | null>(null)

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
    if (!nums.length) return
    if (nums.length === 1) {
      const one = clamp(Math.round(nums[0]!), RE_AXIS_MIN, RE_AXIS_MAX)
      setSingleReMode(true)
      setSingleReValue(one)
      setDistLo(one)
      setDistHi(one)
      setDistN(1)
      return
    }
    const rawLo = Math.min(...nums.map((x) => Math.round(x)))
    const rawHi = Math.max(...nums.map((x) => Math.round(x)))
    const { lo, hi } = clampReRange(
      clamp(rawLo, RE_AXIS_MIN, RE_AXIS_MAX),
      clamp(rawHi, RE_AXIS_MIN, RE_AXIS_MAX),
    )
    setSingleReMode(false)
    setDistLo(lo)
    setDistHi(hi)
    setDistN(clampReN(nums.length))
    setSingleReValue(lo)
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

  const computePolars = useCallback(async () => {
    setErr(null)
    setBusy(true)
    const w = workshopRef.current
    const myGen = ++analyzeGen.current
    const reList = singleReMode
      ? [clamp(Math.round(singleReValue), RE_AXIS_MIN, RE_AXIS_MAX)]
      : logReSamples(distLo, distHi, distN)
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
  }, [alpha0, alpha1, alphaStep, distHi, distLo, distN, form, modelSize, ncrit, singleReMode, singleReValue])

  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  useEffect(() => {
    computeRef.current = computePolars
  }, [computePolars])

  useEffect(() => {
    if (!autoCompute) return
    if (geometryChangeTick < 1) return
    autoPendingRef.current = true
    if (autoTimerRef.current !== null) window.clearTimeout(autoTimerRef.current)
    autoTimerRef.current = window.setTimeout(() => {
      if (busyRef.current) return
      autoPendingRef.current = false
      void computeRef.current?.()
    }, 350)
    return () => {
      if (autoTimerRef.current !== null) {
        window.clearTimeout(autoTimerRef.current)
        autoTimerRef.current = null
      }
    }
  }, [autoCompute, geometryChangeTick])

  useEffect(() => {
    if (!autoCompute || busyRef.current || !autoPendingRef.current) return
    autoPendingRef.current = false
    void computeRef.current?.()
  }, [autoCompute, busy])

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

  const movePolarChart = useCallback((from: number, to: number) => {
    setPolarCharts((rows) => {
      if (from < 0 || from >= rows.length || to < 0 || to >= rows.length || from === to) return rows
      const next = [...rows]
      const [moved] = next.splice(from, 1)
      if (!moved) return rows
      next.splice(to, 0, moved)
      return next
    })
  }, [])

  return (
    <div className="tab-seed">
      <FoilWorkshop
        ref={workshopRef}
        setHydro={setHydro}
        seedSource={form.seedSource}
        seedSectionId={form.seedSectionId}
        onGeometryChange={() => setGeometryChangeTick((n) => n + 1)}
        toolbarPanel={
          <>
            <h4>Polars setup</h4>
            <div className="seed-polar-stack seed-polar-stack-compact">
              <div className="seed-polar-section">
                <div className="seed-polar-section-head">
                  <span className="seed-polar-section-lbl">Reynolds numbers</span>
                  <span className="seed-polar-section-hint">Numeric input only</span>
                </div>
                <label className="seed-polar-inline-check">
                  <input
                    type="checkbox"
                    checked={singleReMode}
                    onChange={(e) => {
                      const next = e.target.checked
                      setSingleReMode(next)
                      if (next) {
                        const one = clamp(Math.round(singleReValue || distLo), RE_AXIS_MIN, RE_AXIS_MAX)
                        setSingleReValue(one)
                        setDistLo(one)
                        setDistHi(one)
                        setDistN(1)
                      } else {
                        const pair = clampReRange(
                          clamp(distLo || singleReValue, RE_AXIS_MIN, RE_AXIS_MAX),
                          clamp(distHi || singleReValue, RE_AXIS_MIN, RE_AXIS_MAX),
                        )
                        setDistLo(pair.lo)
                        setDistHi(pair.hi)
                        setDistN(Math.max(2, clampReN(distN || 4)))
                      }
                    }}
                  />
                  <span>Use one Reynolds only</span>
                </label>
                <div className="seed-polar-grid2 seed-polar-grid3-compact">
                  {singleReMode ? (
                    <label className="field seed-polar-ncrit-field">
                      <span>Reynolds</span>
                      <DraftNumberInput
                        min={RE_AXIS_MIN}
                        max={RE_AXIS_MAX}
                        value={singleReValue}
                        onCommit={(v) => {
                          const clamped = clamp(Math.round(v), RE_AXIS_MIN, RE_AXIS_MAX)
                          setSingleReValue(clamped)
                          setDistLo(clamped)
                          setDistHi(clamped)
                        }}
                      />
                    </label>
                  ) : (
                    <>
                      <label className="field seed-polar-ncrit-field">
                        <span>Re min</span>
                        <DraftNumberInput
                          min={RE_AXIS_MIN}
                          max={RE_AXIS_MAX}
                          value={distLo}
                          onCommit={(v) => {
                            const lo = clamp(Math.round(v), RE_AXIS_MIN, RE_AXIS_MAX)
                            const pair = clampReRange(lo, distHi)
                            setDistLo(pair.lo)
                            setDistHi(pair.hi)
                            setSingleReValue(pair.lo)
                          }}
                        />
                      </label>
                      <label className="field seed-polar-ncrit-field">
                        <span>Re max</span>
                        <DraftNumberInput
                          min={RE_AXIS_MIN}
                          max={RE_AXIS_MAX}
                          value={distHi}
                          onCommit={(v) => {
                            const hi = clamp(Math.round(v), RE_AXIS_MIN, RE_AXIS_MAX)
                            const pair = clampReRange(distLo, hi)
                            setDistLo(pair.lo)
                            setDistHi(pair.hi)
                          }}
                        />
                      </label>
                      <label className="field seed-polar-ncrit-field">
                        <span>Re points (n)</span>
                        <DraftNumberInput
                          min={2}
                          max={6}
                          value={Math.max(2, distN)}
                          onCommit={(v) => {
                            setDistN(Math.max(2, clampReN(v)))
                          }}
                        />
                      </label>
                    </>
                  )}
                </div>
              </div>

              <div className="seed-polar-grid2 seed-polar-grid3-compact">
                <label className="field seed-polar-ncrit-field seed-polar-alpha-field">
                  <span>Alpha min (deg)</span>
                  <DraftNumberInput
                    min={-20}
                    max={20}
                    roundTo={0.25}
                    value={alpha0}
                    onCommit={(v) => {
                      setAlpha0(clampAlpha(v))
                    }}
                  />
                </label>
                <label className="field seed-polar-ncrit-field seed-polar-alpha-field">
                  <span>Alpha max (deg)</span>
                  <DraftNumberInput
                    min={-20}
                    max={20}
                    roundTo={0.25}
                    value={alpha1}
                    onCommit={(v) => {
                      setAlpha1(clampAlpha(v))
                    }}
                  />
                </label>
                <label className="field seed-polar-ncrit-field seed-polar-alpha-field">
                  <span>Delta alpha (deg)</span>
                  <DraftNumberInput
                    min={0.05}
                    max={40}
                    roundTo={0.05}
                    value={alphaStep}
                    onCommit={(v) => {
                      setAlphaStep(Math.max(0.05, v))
                    }}
                  />
                </label>
              </div>

              <div className="seed-polar-grid2">
                <label className="field seed-polar-ncrit-field">
                  <span>Ncrit</span>
                  <select value={ncrit} onChange={(e) => setNcrit(Number(e.target.value))}>
                    {SEED_NCRIT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field seed-polar-ncrit-field">
                  <span>Model</span>
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
              className="primary seed-polar-compact-run"
              disabled={busy}
              onClick={() => void computePolars()}
            >
              {busy ? 'Computing…' : 'Compute polars'}
            </button>
            <label className="seed-polar-inline-check seed-polar-autocompute-check">
              <input
                type="checkbox"
                checked={autoCompute}
                onChange={(e) => {
                  const next = e.target.checked
                  setAutoCompute(next)
                  if (next) {
                    if (busy) {
                      autoPendingRef.current = true
                    } else {
                      autoPendingRef.current = false
                      void computePolars()
                    }
                  }
                }}
              />
              <span>Auto compute on spline edits</span>
            </label>
          </>
        }
      />
      {err && <p className="error">{err}</p>}

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

          <div className="polar-flex-grid">
            {polarCharts.map((spec, idx) => (
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
                onMoveUp={() => movePolarChart(idx, idx - 1)}
                onMoveDown={() => movePolarChart(idx, idx + 1)}
                canRemove={polarCharts.length > 1}
                canMoveUp={idx > 0}
                canMoveDown={idx < polarCharts.length - 1}
                primaryLabel={primaryL}
                compareLabel={compareL || undefined}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
