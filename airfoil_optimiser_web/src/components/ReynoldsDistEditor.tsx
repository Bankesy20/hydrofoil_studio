import { useMemo, useRef } from 'react'
import { clampReN, logReSamples } from '../logReSamples'
import { clamp, clampReRange, RE_AXIS_MAX, RE_AXIS_MIN, RE_MIN_SPAN } from '../seedPolarLimits'
import { GOLD_RE, BLUE_CMP } from './polarFlexShared'
import { MULTI_FOIL_CHART_COLORS } from '../polarFlexPlot'
import { DraftNumberInput } from './DraftNumberInput'

export type ReynoldsDistParams = { lo: number; hi: number; n: number }

function fmtReShort(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`
  return String(n)
}

function foilSwatch(i: number): string {
  if (i === 0) return GOLD_RE[1]!
  if (i === 1) return BLUE_CMP[2]!
  return MULTI_FOIL_CHART_COLORS[(i - 2) % MULTI_FOIL_CHART_COLORS.length]!
}

const GRID = [100_000, 200_000, 500_000, 1_000_000, 1_500_000, 2_000_000] as const

type Props = {
  lo: number
  hi: number
  n: number
  onChange: (next: ReynoldsDistParams) => void
}

/**
 * Log-spaced Reynolds band + sample count (Re axis 100k–2M).
 */
export function ReynoldsDistEditor({ lo, hi, n, onChange }: Props) {
  const axisRef = useRef<HTMLDivElement | null>(null)
  const { lo: cLo, hi: cHi } = clampReRange(lo, hi)
  const samples = useMemo(() => logReSamples(cLo, cHi, n), [cLo, cHi, n])

  const lp = Math.log10(RE_AXIS_MIN)
  const hp = Math.log10(RE_AXIS_MAX)
  const pct = (re: number) => ((Math.log10(re) - lp) / (hp - lp)) * 100
  const fromPct = (p: number) => Math.round(10 ** (lp + (p / 100) * (hp - lp)))

  const emit = (next: ReynoldsDistParams) => onChange({ ...next, n: clampReN(next.n) })

  const drag =
    (which: 'lo' | 'hi') =>
    (e: React.MouseEvent) => {
      e.preventDefault()
      const onMove = (ev: MouseEvent) => {
        const el = axisRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const p = clamp(((ev.clientX - rect.left) / rect.width) * 100, 0, 100)
        const re = clamp(fromPct(p), RE_AXIS_MIN, RE_AXIS_MAX)
        if (which === 'lo') {
          const nextLo = Math.min(re, cHi - RE_MIN_SPAN)
          emit({ ...clampReRange(nextLo, cHi), n })
        } else {
          const nextHi = Math.max(re, cLo + RE_MIN_SPAN)
          emit({ ...clampReRange(cLo, nextHi), n })
        }
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }

  return (
    <div className="seed-re-dist-wrap">
      <div className="seed-re-dist-head">
        <div className="seed-re-dist-title">Log-spaced distribution</div>
        <div className="seed-re-dist-stats">
          <span>
            <strong>{n}</strong> foils
          </span>
          <span>
            range <strong>{fmtReShort(cLo)}</strong>–<strong>{fmtReShort(cHi)}</strong>
          </span>
        </div>
      </div>

      <div className="seed-re-dist-axis" ref={axisRef}>
        <div className="seed-re-dist-track" />
        <div className="seed-re-dist-selected" style={{ left: `${pct(cLo)}%`, width: `${pct(cHi) - pct(cLo)}%` }} />
        {GRID.map((v) => (
          <div key={v}>
            <div className="seed-re-dist-gridline" style={{ left: `${pct(v)}%` }} />
            <div className="seed-re-dist-gridlabel" style={{ left: `${pct(v)}%` }}>
              {fmtReShort(v)}
            </div>
          </div>
        ))}
        {samples.map((v, i) => (
          <div
            key={`${i}-${v}`}
            className="seed-re-dist-sample-dot"
            style={{ left: `${pct(v)}%`, background: foilSwatch(i) }}
            title={v.toLocaleString('en-US')}
          />
        ))}
        <div className="seed-re-dist-handle" style={{ left: `${pct(cLo)}%` }} onMouseDown={drag('lo')}>
          <span className="seed-re-dist-handle-lbl">{fmtReShort(cLo)}</span>
        </div>
        <div className="seed-re-dist-handle" style={{ left: `${pct(cHi)}%` }} onMouseDown={drag('hi')}>
          <span className="seed-re-dist-handle-lbl">{fmtReShort(cHi)}</span>
        </div>
      </div>

      <div className="seed-re-dist-controls">
        <label className="field seed-re-dist-field">
          <span>Min Re</span>
          <DraftNumberInput
            value={cLo}
            min={RE_AXIS_MIN}
            max={Math.max(RE_AXIS_MIN, cHi - RE_MIN_SPAN)}
            roundTo={1000}
            onCommit={(v) => emit({ ...clampReRange(v, cHi), n })}
          />
        </label>
        <label className="field seed-re-dist-field">
          <span>Max Re</span>
          <DraftNumberInput
            value={cHi}
            min={Math.min(RE_AXIS_MAX, cLo + RE_MIN_SPAN)}
            max={RE_AXIS_MAX}
            roundTo={1000}
            onCommit={(v) => emit({ ...clampReRange(cLo, v), n })}
          />
        </label>
        <label className="field seed-re-dist-field">
          <span>Foils (N)</span>
          <DraftNumberInput
            value={n}
            min={1}
            max={6}
            roundTo={1}
            onCommit={(v) => emit({ lo: cLo, hi: cHi, n: clampReN(v) })}
          />
        </label>
      </div>
    </div>
  )
}
