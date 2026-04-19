const jsonHeaders = { 'Content-Type': 'application/json' }

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text()
    let detail = text
    try {
      const j = JSON.parse(text) as { detail?: unknown }
      if (j.detail !== undefined) detail = JSON.stringify(j.detail)
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status}: ${detail}`)
  }
  return res.json() as Promise<T>
}

export async function getMeta() {
  return handle<{
    presets: Record<string, Record<string, unknown>>
    library_by_component: { mast: string[]; front_wing: string[] }
  }>(await fetch('/api/meta'))
}

export async function postFlow(body: Record<string, unknown>) {
  return handle<Record<string, unknown>>(
    await fetch('/api/flow', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  )
}

export async function parseDat(content: string) {
  return handle<{ coordinates: number[][] }>(
    await fetch('/api/dat/parse', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ content }),
    }),
  )
}

export async function postEdgeLocks(body: Record<string, unknown>) {
  return handle<{
    le_thickness_lock: Record<string, number[]> | null
    te_thickness_lock: Record<string, number[]> | null
  }>(await fetch('/api/geometry/edge_locks', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }))
}

export async function postSeedAnalyze(body: Record<string, unknown>) {
  return handle<Record<string, unknown>>(
    await fetch('/api/seed/analyze', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  )
}

export async function createOptimizeJob(body: Record<string, unknown>) {
  return handle<{ job_id: string }>(
    await fetch('/api/optimize/jobs', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(body),
    }),
  )
}

export async function cancelJob(jobId: string) {
  return handle<{ cancelled: boolean }>(
    await fetch(`/api/optimize/jobs/${jobId}/cancel`, { method: 'POST' }),
  )
}

export async function getJobResult(jobId: string) {
  return handle<{ status: string; result?: Record<string, unknown> }>(
    await fetch(`/api/optimize/jobs/${jobId}/result`),
  )
}

export function subscribeJobEvents(
  jobId: string,
  onEvent: (data: Record<string, unknown>) => void,
  onError: (e: Error) => void,
): () => void {
  const es = new EventSource(`/api/optimize/jobs/${jobId}/events`)
  es.onmessage = (ev) => {
    try {
      onEvent(JSON.parse(ev.data) as Record<string, unknown>)
    } catch (e) {
      onError(e instanceof Error ? e : new Error(String(e)))
    }
  }
  es.onerror = () => {
    onError(new Error('EventSource error'))
    es.close()
  }
  return () => es.close()
}

export async function postExport(body: Record<string, unknown>) {
  return handle<{
    dat: string
    dat_filename: string
    polar_csv: string | null
    polar_filename: string
    summary_txt: string | null
    summary_filename: string
  }>(
    await fetch('/api/export', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  )
}
