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
import {
  buildAirfoilFromSeligPoints,
  buildNaca0012,
  buildSymmetricNaca00,
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

const SYM_NACA_PRESETS = ['0008', '0010', '0012', '0015'] as const

/** Cheap fingerprint so we can skip setHydro when exports are unchanged (avoids render loops). */
function coordsFingerprint(coords: number[][] | null | undefined): string {
  if (!coords?.length) return '0'
  const a = coords[0]!
  const m = coords[coords.length >> 1]!
  const z = coords[coords.length - 1]!
  return `${coords.length}:${a[0]},${a[1]}:${m[0]},${m[1]}:${z[0]},${z[1]}`
}

function newId(): string {
  return `foil-${globalThis.crypto?.randomUUID?.() ?? Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function cloneAirfoil(af: Airfoil): Airfoil {
  return JSON.parse(JSON.stringify(af)) as Airfoil
}

type SetHydro = (fn: (p: HydroFormState) => HydroFormState) => void

type Props = {
  setHydro: SetHydro
  seedSource: HydroFormState['seedSource']
  seedSectionId: HydroFormState['seedSectionId']
}

export const FoilWorkshop = forwardRef<FoilWorkshopHandle, Props>(function FoilWorkshop(
  { setHydro, seedSource, seedSectionId },
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
  const [importErr, setImportErr] = useState<string | null>(null)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [nacaDraft, setNacaDraft] = useState('0012')
  const activeImportInputRef = useRef<HTMLInputElement>(null)
  const modalImportInputRef = useRef<HTMLInputElement>(null)
  const previewSamples = 200

  const active = useMemo(
    () => foils.find((f) => f.id === activeId) ?? foils[0]!,
    [foils, activeId],
  )

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
    const opts = foils.map((f) => ({ id: f.id, name: f.name }))
    const optsJson = JSON.stringify(opts)
    if (seedSource !== 'section') {
      setHydro((s) => {
        if (JSON.stringify(s.foilSectionOptions) === optsJson) return s
        return { ...s, foilSectionOptions: opts }
      })
      return
    }
    setHydro((s) => {
      const inList = (id: string | null) => Boolean(id && foils.some((f) => f.id === id))
      const resolved = inList(s.seedSectionId) ? s.seedSectionId! : foils[0]?.id ?? null
      if (!resolved) {
        const next = { ...s, foilSectionOptions: opts, seedUploadCoords: null, seedSectionId: null }
        if (
          JSON.stringify(s.foilSectionOptions) === optsJson &&
          s.seedSectionId === null &&
          s.seedUploadCoords === null
        ) {
          return s
        }
        return next
      }
      const f = foils.find((x) => x.id === resolved)
      if (!f) {
        const next = { ...s, foilSectionOptions: opts, seedUploadCoords: null, seedSectionId: null }
        if (
          JSON.stringify(s.foilSectionOptions) === optsJson &&
          s.seedSectionId === null &&
          s.seedUploadCoords === null
        ) {
          return s
        }
        return next
      }
      const c = exportSeligCoords(f.airfoil, { nPerSurface: samples, spacing })
      const fp = coordsFingerprint(c.points)
      if (
        s.seedSectionId === resolved &&
        coordsFingerprint(s.seedUploadCoords) === fp &&
        JSON.stringify(s.foilSectionOptions) === optsJson
      ) {
        return s
      }
      return {
        ...s,
        foilSectionOptions: opts,
        seedUploadCoords: c.points,
        seedSectionId: resolved,
      }
    })
  }, [foils, samples, spacing, seedSource, seedSectionId, setHydro])

  const onAirfoilChange = useCallback(
    (next: Airfoil) => {
      setFoils((rows) => rows.map((r) => (r.id === activeId ? { ...r, airfoil: next } : r)))
    },
    [activeId],
  )

  const appendFoilEntry = useCallback((entry: FoilEntry) => {
    setFoils((rows) => [...rows, entry])
    setActiveId(entry.id)
  }, [])

  const addSymmetricNacaSection = useCallback(
    (code: string) => {
      setImportErr(null)
      try {
        const af = buildSymmetricNaca00(code)
        appendFoilEntry({
          id: newId(),
          name: af.name,
          airfoil: af,
          visible: true,
          inPolars: true,
        })
        setAddModalOpen(false)
      } catch (err) {
        setImportErr(err instanceof Error ? err.message : String(err))
      }
    },
    [appendFoilEntry],
  )

  const ingestDatFile = useCallback(
    async (file: File, mode: 'active' | 'new') => {
      setImportErr(null)
      try {
        const { coordinates } = await api.parseDat(await file.text())
        const baseName = file.name.replace(/\.[^.]+$/i, '') || 'uploaded'
        const nextAf = buildAirfoilFromSeligPoints(coordinates, { name: baseName })
        if (mode === 'active') {
          setFoils((rows) =>
            rows.map((r) =>
              r.id === activeId ? { ...r, airfoil: nextAf, name: baseName || r.name } : r,
            ),
          )
        } else {
          const id = newId()
          setFoils((rows) => [
            ...rows,
            {
              id,
              name: baseName || `Foil ${rows.length + 1}`,
              airfoil: nextAf,
              visible: true,
              inPolars: true,
            },
          ])
          setActiveId(id)
        }
      } catch (err) {
        setImportErr(err instanceof Error ? err.message : String(err))
      }
    },
    [activeId],
  )

  useEffect(() => {
    if (!addModalOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAddModalOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [addModalOpen])

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
      setFoils((rows) =>
        rows.map((r) => (r.id === activeId ? { ...r, airfoil: withFixedPoints({ ...r.airfoil, teGap: gap }) } : r)),
      )
    },
    [activeId],
  )

  const resetActiveToNaca = useCallback(() => {
    const next = buildNaca0012()
    setFoils((rows) => rows.map((r) => (r.id === activeId ? { ...r, airfoil: next, name: r.name } : r)))
  }, [activeId])

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
        Select a section, edit splines, check <strong>plr</strong> for multi-foil polars. Import a Selig{' '}
        <strong>.dat</strong> into the <strong>active</strong> section from the list panel, or add a section via{' '}
        <strong>+ Add</strong> (NACA or file). The active section drives the app seed for optimisation.
      </p>
      {importErr && <p className="error foil-import-error">{importErr}</p>}
      {addModalOpen && (
        <div
          className="foil-modal-backdrop"
          role="presentation"
          onClick={() => {
            setAddModalOpen(false)
            setImportErr(null)
          }}
        >
          <div
            className="foil-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="foil-add-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="foil-modal-head">
              <h4 id="foil-add-modal-title">Add section</h4>
              <button
                type="button"
                className="foil-modal-close"
                aria-label="Close"
                onClick={() => {
                  setAddModalOpen(false)
                  setImportErr(null)
                }}
              >
                ×
              </button>
            </div>
            <p className="hint foil-modal-lead">
              Symmetric <strong>NACA 00TT</strong> uses the same spline fit as the default 0012. Cambered codes (2412,
              …) are not available here yet — use <strong>Import from file</strong> instead.
            </p>
            <div className="foil-modal-section">
              <span className="foil-modal-label">Quick symmetric</span>
              <div className="foil-naca-chips">
                {SYM_NACA_PRESETS.map((code) => (
                  <button key={code} type="button" className="ghost small" onClick={() => addSymmetricNacaSection(code)}>
                    NACA {code}
                  </button>
                ))}
              </div>
            </div>
            <div className="foil-modal-section">
              <label className="foil-modal-field">
                <span className="foil-modal-label">Custom 00TT</span>
                <div className="foil-modal-row">
                  <input
                    className="foil-modal-input"
                    value={nacaDraft}
                    onChange={(e) => setNacaDraft(e.target.value)}
                    placeholder="0012"
                    maxLength={8}
                    inputMode="numeric"
                  />
                  <button type="button" className="primary small" onClick={() => addSymmetricNacaSection(nacaDraft)}>
                    Add
                  </button>
                </div>
              </label>
            </div>
            <div className="foil-modal-section">
              <span className="foil-modal-label">From file</span>
              <p className="hint foil-modal-file-hint">Selig order (TE → LE upper, LE → TE lower), same as server export.</p>
              <input
                ref={modalImportInputRef}
                type="file"
                accept=".dat,.txt"
                className="visually-hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  await ingestDatFile(file, 'new')
                  setAddModalOpen(false)
                }}
              />
              <button type="button" className="primary small" onClick={() => modalImportInputRef.current?.click()}>
                Choose .dat / .txt…
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="foil-workshop-layout">
        <aside className="foil-list-panel">
          <div className="foil-list-header">
            <span>Sections ({foils.length})</span>
            <button
              type="button"
              className="primary small"
              onClick={() => {
                setImportErr(null)
                setNacaDraft('0012')
                setAddModalOpen(true)
              }}
              title="Add section"
            >
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
          <div className="foil-list-import">
            <span className="foil-list-import-label">Import into active</span>
            <input
              ref={activeImportInputRef}
              type="file"
              accept=".dat,.txt"
              className="visually-hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                await ingestDatFile(file, 'active')
              }}
            />
            <button type="button" className="ghost small foil-list-import-btn" onClick={() => activeImportInputRef.current?.click()}>
              Choose .dat / .txt…
            </button>
            <p className="hint foil-list-import-hint">Replaces the active section geometry; tweak with control points after import.</p>
          </div>
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

        <aside className="seed-spline-side foil-side-panel foil-tools-column">
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
            <h4>Export active</h4>
            <p className="hint foil-export-hint">
              B-spline LSQ match to samples (same idea as the NACA path). TE gap from sampling, not a forced symmetric
              closure on cambered files.
            </p>
            <div className="seed-spline-actions seed-spline-actions-compact">
              <button type="button" onClick={resetActiveToNaca}>
                Reset to 0012
              </button>
              <button type="button" onClick={() => void copyDat()}>
                Copy .dat
              </button>
              <button type="button" onClick={downloadDat}>
                Download
              </button>
            </div>
          </div>
        </aside>
      </div>
    </section>
  )
})
