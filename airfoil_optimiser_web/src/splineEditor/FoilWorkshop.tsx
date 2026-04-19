import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import * as api from '../api'
import type { HydroFormState } from '../hydroState'
import { AirfoilEditor } from './AirfoilEditor'
import { exportSeligCoords, formatSelig } from './export/selig'
import { useDebouncedValue } from './hooks/useDebouncedValue'
import {
  buildAirfoilFromSeligPoints,
  buildNaca0012,
  maxDeviationFromNaca,
  sampleAirfoil,
  withFixedPoints,
  type Airfoil,
} from './spline/airfoil'

export type FoilEntry = {
  id: string
  name: string
  airfoil: Airfoil
  visible: boolean
  inPolars: boolean
}

export type FoilWorkshopHandle = {
  /** Foils with “include in polars” checked, in list order, with current sampling. */
  getPolarInclusion: () => { name: string; coordinates: number[][] }[]
}

const PEER_STROKE = [
  { u: '#5b9fe8', l: '#7ab3f0' },
  { u: '#e8554d', l: '#ff7a6e' },
  { u: '#2ecc71', l: '#58d68d' },
  { u: '#9b59b6', l: '#c39bd3' },
  { u: '#e6a84e', l: '#f0c674' },
]

function newId(): string {
  return `foil-${globalThis.crypto?.randomUUID?.() ?? Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function cloneAirfoil(af: Airfoil): Airfoil {
  return JSON.parse(JSON.stringify(af)) as Airfoil
}

type SetHydro = (fn: (p: HydroFormState) => HydroFormState) => void

type Props = { setHydro: SetHydro }

export const FoilWorkshop = forwardRef<FoilWorkshopHandle, Props>(function FoilWorkshop(
  { setHydro },
  ref,
) {
  const initId = useRef(newId())
  const [foils, setFoils] = useState<FoilEntry[]>([
    { id: initId.current, name: 'Foil 1', airfoil: buildNaca0012(), visible: true, inPolars: true },
  ])
  const [activeId, setActiveId] = useState(initId.current)
  const [samples, setSamples] = useState(80)
  const [spacing, setSpacing] = useState<'cosine' | 'uniform'>('cosine')
  const [zoom, setZoom] = useState(1)
  const [showReference, setShowReference] = useState(true)
  const [resetViewKey, setResetViewKey] = useState(0)
  const [splineTouched, setSplineTouched] = useState(false)
  const [importErr, setImportErr] = useState<string | null>(null)
  const previewSamples = 200

  const active = useMemo(
    () => foils.find((f) => f.id === activeId) ?? foils[0]!,
    [foils, activeId],
  )
  const debouncedActive = useDebouncedValue(active, 250)
  const airfoilRef = useRef(active.airfoil)
  airfoilRef.current = active.airfoil

  const maxDevPct = useMemo(() => {
    const dense = sampleAirfoil(active.airfoil, 200, 'cosine')
    return maxDeviationFromNaca(dense, 0.12) * 100
  }, [active.airfoil])

  const peerOverlays = useMemo(() => {
    const out: {
      meta: { key: string; name: string; colorUpper: string; colorLower: string }
      upper: { x: number; y: number }[]
      lower: { x: number; y: number }[]
    }[] = []
    let peerIdx = 0
    for (let i = 0; i < foils.length; i += 1) {
      const f = foils[i]!
      if (f.id === activeId || !f.visible) continue
      const pal = PEER_STROKE[peerIdx % PEER_STROKE.length]!
      peerIdx += 1
      const s = sampleAirfoil(f.airfoil, previewSamples, 'uniform')
      out.push({
        meta: { key: f.id, name: f.name, colorUpper: pal.u, colorLower: pal.l },
        upper: s.upper,
        lower: s.lower,
      })
    }
    return out
  }, [foils, activeId, previewSamples])

  const pushToHydro = useCallback(
    (f: FoilEntry) => {
      const c = exportSeligCoords(f.airfoil, { nPerSurface: samples, spacing })
      setHydro((s) => ({
        ...s,
        seedSource: 'upload',
        seedUploadCoords: c.points,
      }))
    },
    [samples, spacing, setHydro],
  )

  useImperativeHandle(
    ref,
    () => ({
      getPolarInclusion: () => {
        const list = foils.filter((f) => f.inPolars)
        return list.map((f) => ({
          name: f.name,
          coordinates: exportSeligCoords(f.airfoil, { nPerSurface: samples, spacing }).points,
        }))
      },
    }),
    [foils, samples, spacing],
  )

  useEffect(() => {
    if (!splineTouched) return
    pushToHydro(debouncedActive)
  }, [debouncedActive, pushToHydro, splineTouched])

  useEffect(() => {
    if (!splineTouched) return
    pushToHydro({ ...active, airfoil: airfoilRef.current })
  }, [samples, spacing, splineTouched, active, pushToHydro])

  const onAirfoilChange = useCallback(
    (next: Airfoil) => {
      setSplineTouched(true)
      setFoils((rows) => rows.map((r) => (r.id === activeId ? { ...r, airfoil: next } : r)))
    },
    [activeId],
  )

  const addFoil = useCallback(() => {
    const id = newId()
    const n = foils.length + 1
    setFoils((r) => [
      ...r,
      { id, name: `Foil ${n}`, airfoil: buildNaca0012(), visible: true, inPolars: true },
    ])
    setActiveId(id)
  }, [foils.length])

  const duplicateFoil = useCallback(
    (id: string) => {
      const src = foils.find((f) => f.id === id)
      if (!src) return
      const nid = newId()
      setFoils((r) => {
        const copy: FoilEntry = {
          id: nid,
          name: `${src.name} (copy)`,
          airfoil: cloneAirfoil(src.airfoil),
          visible: true,
          inPolars: true,
        }
        const i = r.findIndex((f) => f.id === id)
        const next = [...r]
        next.splice(i + 1, 0, copy)
        return next
      })
      setActiveId(nid)
    },
    [foils],
  )

  const removeFoil = useCallback((id: string) => {
    setFoils((r) => {
      if (r.length <= 1) return r
      const next = r.filter((f) => f.id !== id)
      if (id === activeId) setActiveId(next[0]!.id)
      return next
    })
  }, [activeId])

  const changeTeGap = useCallback(
    (gap: number) => {
      setSplineTouched(true)
      setFoils((rows) =>
        rows.map((r) => (r.id === activeId ? { ...r, airfoil: withFixedPoints({ ...r.airfoil, teGap: gap }) } : r)),
      )
    },
    [activeId],
  )

  const resetActiveToNaca = useCallback(() => {
    const next = buildNaca0012()
    setFoils((rows) => rows.map((r) => (r.id === activeId ? { ...r, airfoil: next, name: r.name } : r)))
    setSplineTouched(true)
    pushToHydro({ ...active, airfoil: next })
  }, [activeId, active, pushToHydro])

  const resetView = useCallback(() => {
    setZoom(1)
    setResetViewKey((k) => k + 1)
  }, [])

  const seligText = useMemo(() => {
    const c = exportSeligCoords(active.airfoil, { nPerSurface: samples, spacing })
    return formatSelig(c)
  }, [active.airfoil, samples, spacing])

  const downloadDat = () => {
    const blob = new Blob([seligText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${active.airfoil.name.replace(/\s+/g, '_')}.dat`
    a.click()
    URL.revokeObjectURL(url)
  }

  const copyDat = async () => {
    await navigator.clipboard.writeText(seligText)
  }

  return (
    <section className="foil-workshop">
      <h3 className="foil-workshop-title">Foil sections</h3>
      <p className="hint foil-workshop-hint">
        The spline view is the only airfoil plot: select a section, edit it, and check <strong>plr</strong> for
        multi-foil polars. Load a <strong>Selig .dat</strong> (same order the server exports) into the active section
        under <strong>Active foil</strong>, then use the control points to tweak it. The active section updates the app
        seed (sidebar) for optimisation.
      </p>
      {importErr && <p className="error foil-import-error">{importErr}</p>}
      <div className="foil-workshop-layout">
        <aside className="foil-list-panel">
          <div className="foil-list-header">
            <span>Sections ({foils.length})</span>
            <button type="button" className="primary small" onClick={addFoil} title="Add another foil">
              + Add
            </button>
          </div>
          <ul className="foil-list">
            {foils.map((f) => {
              const isAct = f.id === activeId
              return (
                <li
                  key={f.id}
                  className={isAct ? 'foil-list-item active' : 'foil-list-item'}
                  onClick={() => setActiveId(f.id)}
                >
                  <input
                    className="foil-name-input"
                    value={f.name}
                    onChange={(e) =>
                      setFoils((rows) => rows.map((r) => (r.id === f.id ? { ...r, name: e.target.value } : r)))
                    }
                    onClick={(e) => e.stopPropagation()}
                    onFocus={() => setActiveId(f.id)}
                    aria-label="Foil name"
                  />
                  <label className="foil-ico" title="Show on canvas" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={f.visible}
                      onChange={(e) =>
                        setFoils((rows) => rows.map((r) => (r.id === f.id ? { ...r, visible: e.target.checked } : r)))
                      }
                    />
                    <span aria-hidden>vis</span>
                  </label>
                  <label className="foil-ico" title="Include in polar run" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={f.inPolars}
                      onChange={(e) =>
                        setFoils((rows) => rows.map((r) => (r.id === f.id ? { ...r, inPolars: e.target.checked } : r)))
                      }
                    />
                    <span aria-hidden>plr</span>
                  </label>
                  <button
                    type="button"
                    className="foil-ico-btn"
                    title="Duplicate"
                    onClick={(e) => {
                      e.stopPropagation()
                      duplicateFoil(f.id)
                    }}
                  >
                    ⧉
                  </button>
                  <button
                    type="button"
                    className="foil-ico-btn"
                    title="Delete"
                    disabled={foils.length <= 1}
                    onClick={(e) => {
                      e.stopPropagation()
                      removeFoil(f.id)
                    }}
                  >
                    Del
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>

        <div className="foil-workshop-center">
          <div className="seed-spline-editor-wrap foil-editor-frame">
            <AirfoilEditor
              key={resetViewKey}
              airfoil={active.airfoil}
              onChange={onAirfoilChange}
              zoom={zoom}
              onZoomChange={setZoom}
              showReference={showReference}
              previewSamples={previewSamples}
              peerOverlays={peerOverlays}
            />
          </div>
        </div>

        <aside className="seed-spline-side foil-side-panel">
          <div className="seed-spline-block">
            <h4>View</h4>
            <label className="seed-spline-field">
              Zoom: <strong>{zoom.toFixed(1)}×</strong>
              <input
                type="range"
                min={0.5}
                max={40}
                step={0.1}
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
              />
            </label>
            <label className="seed-spline-check">
              <input
                type="checkbox"
                checked={showReference}
                onChange={(e) => setShowReference(e.target.checked)}
              />
              <span>NACA 0012 reference (dashed)</span>
            </label>
            <button type="button" className="ghost" onClick={resetView}>
              Reset view
            </button>
            <p className="hint">
              Max deviation from analytic NACA 0012: <strong>{maxDevPct.toFixed(3)}% chord</strong>
            </p>
          </div>
          <div className="seed-spline-block">
            <h4>Sampling (export & polars)</h4>
            <label className="seed-spline-field">
              Points per surface: <strong>{samples}</strong>
              <input
                type="range"
                min={20}
                max={200}
                step={2}
                value={samples}
                onChange={(e) => setSamples(parseInt(e.target.value, 10))}
              />
            </label>
            <label className="seed-spline-field">
              Spacing
              <select
                value={spacing}
                onChange={(e) => setSpacing(e.target.value as 'cosine' | 'uniform')}
              >
                <option value="cosine">Cosine (LE/TE)</option>
                <option value="uniform">Uniform</option>
              </select>
            </label>
            <label className="seed-spline-field">
              TE gap (% chord): <strong>{(active.airfoil.teGap * 100).toFixed(2)}</strong>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={active.airfoil.teGap * 100}
                onChange={(e) => changeTeGap(parseFloat(e.target.value) / 100)}
              />
            </label>
          </div>
          <div className="seed-spline-block">
            <h4>Active foil</h4>
            <label className="seed-spline-field">
              <span>Import Selig .dat / .txt</span>
              <input
                type="file"
                accept=".dat,.txt"
                onChange={async (e) => {
                  setImportErr(null)
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  try {
                    const { coordinates } = await api.parseDat(await file.text())
                    const baseName = file.name.replace(/\.[^.]+$/i, '')
                    const nextAf = buildAirfoilFromSeligPoints(coordinates, { name: baseName || 'uploaded' })
                    setFoils((rows) =>
                      rows.map((r) =>
                        r.id === activeId
                          ? { ...r, airfoil: nextAf, name: baseName || r.name }
                          : r,
                      ),
                    )
                    setSplineTouched(true)
                  } catch (err) {
                    setImportErr(err instanceof Error ? err.message : String(err))
                  }
                }}
              />
            </label>
            <p className="hint foil-import-hint">
              Fitted the same way as the NACA 0012 path in airfoil_analyser (B-spline LSQ, x = t² on chord). Trailing
              edge uses the file y (cambered foils, not a forced symmetric gap), so the shape should track your .dat.
            </p>
            <div className="seed-spline-actions">
              <button type="button" onClick={resetActiveToNaca}>
                Reset to NACA 0012
              </button>
              <button type="button" onClick={() => void copyDat()}>
                Copy .dat
              </button>
              <button type="button" onClick={downloadDat}>
                Download .dat
              </button>
            </div>
          </div>
        </aside>
      </div>
    </section>
  )
})
