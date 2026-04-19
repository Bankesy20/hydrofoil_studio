import { useMemo, useState } from 'react'
import { buildExportStem } from '../exportName'
import { coordsFieldTo2d } from '../resultGeometry'
import * as api from '../api'
import type { HydroFormState } from '../hydroState'

type Props = { form: HydroFormState; result: Record<string, unknown> | null }

type CstPayload = { upper: number[]; lower: number[]; le: number; te: number }

/**
 * Resolves N×2 points from the job result. Coordinates can arrive as a proper
 * array of [x,y] or a flat x,y,… list after JSON; if broken, we still have Kulfan CST.
 */
function parseExportGeometry(result: Record<string, unknown>): {
  coordinates: number[][] | undefined
  cst: CstPayload | undefined
} {
  const cstRaw = result.optimized_cst as
    | { upper?: number[]; lower?: number[]; le?: number; te?: number }
    | undefined
  const cst: CstPayload | undefined =
    cstRaw &&
    Array.isArray(cstRaw.upper) &&
    cstRaw.upper.length > 0 &&
    Array.isArray(cstRaw.lower) &&
    cstRaw.lower.length > 0
      ? {
          upper: cstRaw.upper,
          lower: cstRaw.lower,
          le: Number(cstRaw.le ?? 0),
          te: Number(cstRaw.te ?? 0),
        }
      : undefined

  const fromCoords = coordsFieldTo2d(result.optimized_coords)
  if (fromCoords) {
    return { coordinates: fromCoords, cst }
  }
  return { coordinates: undefined, cst }
}

function downloadFile(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 200)
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function ExportTab({ form, result }: Props) {
  const [npts, setNpts] = useState(161)
  const [leBunch, setLeBunch] = useState(1.3)
  const [name, setName] = useState('')

  const autoName = useMemo(() => {
    if (result?.best_objective !== undefined) {
      return `${buildExportStem(form)}_obj${Number(result.best_objective).toFixed(4)}`
    }
    return buildExportStem(form)
  }, [form, result])

  const effectiveName = name.trim() || autoName

  if (!result) {
    return <p className="muted">Run an optimisation first to export.</p>
  }
  const { coordinates: expCoords, cst: cstFromResult } = parseExportGeometry(result)
  if (!expCoords && !cstFromResult) {
    return (
      <p className="error">
        This job result has no usable airfoil geometry (missing coordinates and CST). Try running the
        optimisation again.
      </p>
    )
  }

  const polar = result.opt_polar as Record<string, number[]> | undefined
  const alphas = result.opt_alphas as number[] | undefined

  function buildExportMetaLines() {
    if (!result) return []
    const sec = result.opt_section_props as Record<string, number> | undefined
    const jVal = sec ? (sec.J_bredt ?? sec.J_polar) : undefined
    const baseMeta = [
      `Name: ${effectiveName}`,
      `Chord: ${form.chordMm} mm`,
      `Objective: ${Number(result.best_objective).toFixed(6)}`,
      `Generations: ${String(result.n_iterations)}`,
      `t/c: ${(Number(result.opt_tc) * 100).toFixed(1)}%`,
    ]
    const inertiaLines: string[] = sec
      ? [
          `Ixx: ${sec.Ixx != null && Number.isFinite(Number(sec.Ixx)) ? Number(sec.Ixx).toExponential(3) : 'n/a'} m^4`,
          `Iyy: ${sec.Iyy != null && Number.isFinite(Number(sec.Iyy)) ? Number(sec.Iyy).toExponential(3) : 'n/a'} m^4`,
          `J: ${
            jVal != null && Number.isFinite(Number(jVal)) ? Number(jVal).toExponential(3) : 'n/a'
          } m^4`,
          `Area: ${sec.A != null && Number.isFinite(Number(sec.A)) ? (Number(sec.A) * 1e6).toFixed(1) : 'n/a'} mm^2`,
        ]
      : []
    return [...baseMeta, ...inertiaLines]
  }

  /**
   * Same as airfoil_analyser `CoordinatePanel.downloadDat`: Selig .dat = title line + x y rows
   * only. Do not put metadata in the .dat (no `#` lines) — many CAD/CFD tools reject that.
   * Use "Download all" for summary text with chord, t/c, section properties, etc.
   */
  function exportBodyBase() {
    const b: Record<string, unknown> = { export_name: effectiveName, export_npts: npts, le_bunch: leBunch }
    if (expCoords && expCoords.length >= 3) {
      b.coordinates = expCoords
    }
    if (cstFromResult) {
      b.cst = cstFromResult
    }
    return b
  }

  async function downloadDatOnly() {
    if (!result) return
    const r = await api.postExport({ ...exportBodyBase() })
    const datName = r.dat_filename.toLowerCase().endsWith('.dat') ? r.dat_filename : `${r.dat_filename}.dat`
    downloadFile(datName, r.dat, 'application/octet-stream')
  }

  async function doExport() {
    if (!result) return
    const lines = buildExportMetaLines()

    const r = await api.postExport({
      ...exportBodyBase(),
      polar: polar ?? undefined,
      alphas: alphas ?? undefined,
      summary_lines: lines,
    })
    /* `text/plain` + Blob often renames to .txt in Safari/Chrome; octet-stream helps keep .dat */
    const datName = r.dat_filename.toLowerCase().endsWith('.dat') ? r.dat_filename : `${r.dat_filename}.dat`

    /*
     * Multiple a.click() in one event handler often leave only the *last* file (Chrome,
     * Safari). Staggering lets each start; the airfoil .dat is *last* so a worst-case
     * single-allowed download is still the geometry, not the summary.
     * airfoil_analyser/CoordinatePanel uses a single .dat only — this matches that
     * priority.
     */
    if (r.polar_csv) {
      downloadFile(r.polar_filename, r.polar_csv, 'text/csv')
      await wait(250)
    }
    if (r.summary_txt) {
      downloadFile(r.summary_filename, r.summary_txt, 'text/plain;charset=utf-8')
      await wait(250)
    }
    downloadFile(datName, r.dat, 'application/octet-stream')
  }

  return (
    <div className="tab-export">
      <h3>Download results</h3>
      <label className="field">
        <span>Export point count</span>
        <input
          type="number"
          value={npts}
          min={80}
          max={250}
          step={10}
          onChange={(e) => setNpts(Number(e.target.value))}
        />
      </label>
      <label className="field">
        <span>LE bunching</span>
        <input
          type="number"
          value={leBunch}
          min={1}
          max={2}
          step={0.1}
          onChange={(e) => setLeBunch(Number(e.target.value))}
        />
      </label>
      <label className="field">
        <span>File name stem</span>
        <input value={name} placeholder={autoName} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="export-actions">
        <button type="button" className="primary" onClick={() => void downloadDatOnly()}>
          Download airfoil .dat
        </button>
        <button type="button" className="ghost" onClick={() => void doExport()}>
          Download all (polar CSV, summary, .dat)
        </button>
      </div>
    </div>
  )
}
