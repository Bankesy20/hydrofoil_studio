import { useRef } from 'react'
import { alphaSamples } from '../alphaSamples'
import { ALPHA_AXIS_MAX, ALPHA_AXIS_MIN, clamp } from '../seedPolarLimits'
import { DraftNumberInput } from './DraftNumberInput'

type Props = {
  a0: number
  a1: number
  da: number
  onChangeA0: (v: number) => void
  onChangeA1: (v: number) => void
  onChangeDa: (v: number) => void
}

const SNAP_DEG = 0.25

function pct(v: number): number {
  return ((v - ALPHA_AXIS_MIN) / (ALPHA_AXIS_MAX - ALPHA_AXIS_MIN)) * 100
}

function fromPct(p: number): number {
  const ang = ALPHA_AXIS_MIN + (p / 100) * (ALPHA_AXIS_MAX - ALPHA_AXIS_MIN)
  const snapped = Math.round(ang / SNAP_DEG) * SNAP_DEG
  return clamp(snapped, ALPHA_AXIS_MIN, ALPHA_AXIS_MAX)
}

/**
 * α sweep with draggable endpoints (α₀, α₁), axis −20°…+20°, and draft numeric inputs.
 */
export function AlphaSweepPanel({ a0, a1, da, onChangeA0, onChangeA1, onChangeDa }: Props) {
  const axisRef = useRef<HTMLDivElement | null>(null)
  const samples = alphaSamples(a0, a1, da)
  const lo = Math.min(a0, a1)
  const hi = Math.max(a0, a1)

  const ticks: number[] = []
  for (let v = ALPHA_AXIS_MIN; v <= ALPHA_AXIS_MAX; v += 5) ticks.push(v)

  const drag =
    (which: 'a0' | 'a1') =>
    (e: React.MouseEvent) => {
      e.preventDefault()
      const move = (ev: MouseEvent) => {
        const el = axisRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const p = clamp(((ev.clientX - rect.left) / rect.width) * 100, 0, 100)
        const v = fromPct(p)
        if (which === 'a0') onChangeA0(v)
        else onChangeA1(v)
      }
      const up = () => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    }

  return (
    <div className="seed-alpha-sweep">
      <div className="seed-alpha-sweep-head">
        <div className="seed-alpha-sweep-title">α sweep</div>
        <div className="seed-alpha-sweep-count">
          <strong>{samples.length}</strong>
          <span className="seed-alpha-sweep-count-muted"> samples · </span>
          {lo.toFixed(2)}° → {hi.toFixed(2)}° · step {Number(da).toFixed(2)}°
        </div>
      </div>

      <div className="seed-alpha-axis seed-alpha-axis-with-handles" ref={axisRef}>
        <div className="seed-alpha-line" />
        {ticks.map((v) => (
          <div key={`t${v}`} className="seed-alpha-tick" style={{ left: `${pct(v)}%` }} />
        ))}
        {ticks.map((v) => (
          <div key={`l${v}`} className="seed-alpha-label" style={{ left: `${pct(v)}%` }}>
            {v}°
          </div>
        ))}
        <div className="seed-alpha-range" style={{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }} />
        {samples.map((v, i) => {
          const edge = i === 0 || i === samples.length - 1
          return (
            <div
              key={`${i}-${v}`}
              className={edge ? 'seed-alpha-sample seed-alpha-sample-edge' : 'seed-alpha-sample'}
              style={{ left: `${pct(v)}%` }}
              title={`${v.toFixed(2)}°`}
            />
          )
        })}
        <div className="seed-alpha-handle" style={{ left: `${pct(a0)}%` }} onMouseDown={drag('a0')}>
          <span className="seed-alpha-handle-lbl">α₀ {a0.toFixed(2)}°</span>
        </div>
        <div className="seed-alpha-handle" style={{ left: `${pct(a1)}%` }} onMouseDown={drag('a1')}>
          <span className="seed-alpha-handle-lbl">α₁ {a1.toFixed(2)}°</span>
        </div>
      </div>

      <div className="seed-alpha-controls">
        <div className="seed-alpha-mini-field">
          <span className="seed-alpha-k">α₀</span>
          <DraftNumberInput
            className="seed-alpha-draft"
            value={a0}
            min={ALPHA_AXIS_MIN}
            max={ALPHA_AXIS_MAX}
            roundTo={SNAP_DEG}
            onCommit={onChangeA0}
          />
          <span className="seed-alpha-deg">°</span>
        </div>
        <div className="seed-alpha-mini-field">
          <span className="seed-alpha-k">α₁</span>
          <DraftNumberInput
            className="seed-alpha-draft"
            value={a1}
            min={ALPHA_AXIS_MIN}
            max={ALPHA_AXIS_MAX}
            roundTo={SNAP_DEG}
            onCommit={onChangeA1}
          />
          <span className="seed-alpha-deg">°</span>
        </div>
        <div className="seed-alpha-mini-field">
          <span className="seed-alpha-k">Δα</span>
          <DraftNumberInput
            className="seed-alpha-draft"
            value={da}
            min={0.05}
            max={40}
            roundTo={0.05}
            onCommit={onChangeDa}
          />
          <span className="seed-alpha-deg">°</span>
        </div>
      </div>
    </div>
  )
}
