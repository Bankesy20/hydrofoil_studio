import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from './api'
import { ExportTab } from './components/ExportTab'
import { FlowTab } from './components/FlowTab'
import { OptimTab } from './components/OptimTab'
import { SeedTab } from './components/SeedTab'
import { Sidebar } from './components/Sidebar'
import { initialHydroForm, type HydroFormState } from './hydroState'
import { buildOptimizePayload } from './optimizePayload'
import './App.css'

type TabId = 'seed' | 'flow' | 'optim' | 'export'

export default function App() {
  const [meta, setMeta] = useState<{
    presets: Record<string, Record<string, unknown>>
    library_by_component: { mast: string[]; front_wing: string[] }
  } | null>(null)
  const [metaErr, setMetaErr] = useState<string | null>(null)
  const [form, setForm] = useState<HydroFormState>(() => initialHydroForm())
  const [tab, setTab] = useState<TabId>('seed')
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<string | null>(null)
  const [convergence, setConvergence] = useState<number[]>([])
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [optErr, setOptErr] = useState<string | null>(null)
  const esCloseRef = useRef<(() => void) | null>(null)
  const optimizeDoneRef = useRef(false)

  useEffect(() => {
    api
      .getMeta()
      .then((m) => {
        setMeta(m)
        setMetaErr(null)
      })
      .catch((e) => setMetaErr(e instanceof Error ? e.message : String(e)))
  }, [])

  const setHydro = useCallback((fn: (p: HydroFormState) => HydroFormState) => {
    setForm(fn)
  }, [])

  const stopEvents = useCallback(() => {
    esCloseRef.current?.()
    esCloseRef.current = null
  }, [])

  const runOptimization = useCallback(async () => {
    stopEvents()
    optimizeDoneRef.current = false
    setOptErr(null)
    setConvergence([])
    setResult(null)
    setJobId(null)
    setJobStatus(null)
    setTab('optim')
    try {
      const payload = await buildOptimizePayload(form)
      const { job_id } = await api.createOptimizeJob(payload)
      setJobId(job_id)
      setJobStatus('running')
      esCloseRef.current = api.subscribeJobEvents(
        job_id,
        async (ev) => {
          if (ev.type === 'progress' && typeof ev.best_objective === 'number') {
            setConvergence((c) => [...c, ev.best_objective as number])
          }
          if (ev.type === 'done') {
            if (optimizeDoneRef.current) return
            optimizeDoneRef.current = true
            const st = String(ev.status ?? '')
            setJobStatus(st)
            stopEvents()
            if (st === 'completed') {
              try {
                const r = await api.getJobResult(job_id)
                setResult((r.result as Record<string, unknown>) ?? null)
              } catch (e) {
                setOptErr(e instanceof Error ? e.message : String(e))
              }
            } else if (st === 'failed') {
              setOptErr(String(ev.error ?? 'failed'))
            }
          }
        },
        (e) => setOptErr(e.message),
      )
    } catch (e) {
      setOptErr(e instanceof Error ? e.message : String(e))
    }
  }, [form, stopEvents])

  const cancelOptimization = useCallback(async () => {
    if (jobId) await api.cancelJob(jobId)
    stopEvents()
    setJobStatus('cancelled')
  }, [jobId, stopEvents])

  const resetResults = useCallback(() => {
    stopEvents()
    setJobId(null)
    setJobStatus(null)
    setConvergence([])
    setResult(null)
    setOptErr(null)
  }, [stopEvents])

  useEffect(() => () => stopEvents(), [stopEvents])

  const mastList = meta?.library_by_component.mast ?? []
  const wingList = meta?.library_by_component.front_wing ?? []
  const presets = meta?.presets ?? {}

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>HydroOptFoil</h1>
        <span className="version">web</span>
      </header>
      {metaErr && <p className="error banner">{metaErr}</p>}
      <div className="app-body">
        <Sidebar
          presets={presets}
          mastAirfoils={mastList.length ? mastList : ['NACA 0012', 'NACA 0010']}
          wingAirfoils={wingList.length ? wingList : ['NACA 4412', 'NACA 2412']}
          s={form}
          set={setHydro}
          onRunOptimization={() => void runOptimization()}
          onResetResults={resetResults}
        />
        <main className="main">
          <nav className="tabs">
            {(
              [
                ['seed', 'Seed airfoil'],
                ['flow', 'Flow calculator'],
                ['optim', 'Optimisation'],
                ['export', 'Export'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={tab === id ? 'tab active' : 'tab'}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="tab-panel">
            {tab === 'seed' && <SeedTab form={form} setHydro={setHydro} />}
            {tab === 'flow' && <FlowTab chordMm={form.chordMm} />}
            {tab === 'optim' && (
              <OptimTab
                form={form}
                jobId={jobId}
                status={jobStatus}
                convergence={convergence}
                result={result}
                error={optErr}
                onCancel={() => void cancelOptimization()}
              />
            )}
            {tab === 'export' && <ExportTab form={form} result={result} />}
          </div>
        </main>
      </div>
    </div>
  )
}
