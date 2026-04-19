import { useEffect, useState } from 'react'
import * as api from '../api'

type Props = { chordMm: number }

export function FlowTab({ chordMm }: Props) {
  const [speed, setSpeed] = useState(10)
  const [unit, setUnit] = useState<'m/s' | 'km/h' | 'knots' | 'mph'>('m/s')
  const [chord, setChord] = useState(chordMm)
  const [waterTemp, setWaterTemp] = useState(20)
  const [salt, setSalt] = useState(false)
  const [liftMode, setLiftMode] = useState<'mass_kg' | 'force_n'>('mass_kg')
  const [massKg, setMassKg] = useState(85)
  const [liftN, setLiftN] = useState(850)
  const [areaCm2, setAreaCm2] = useState(1200)
  const [share, setShare] = useState(100)
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setChord(chordMm)
  }, [chordMm])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await api.postFlow({
          speed,
          speed_unit: unit,
          chord_mm: chord,
          water_temp_c: waterTemp,
          salt_water: salt,
          lift_mode: liftMode,
          mass_kg: massKg,
          lift_n: liftN,
          area_cm2: areaCm2,
          lift_share_pct: share,
        })
        if (!cancelled) {
          setData(r)
          setErr(null)
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [speed, unit, chord, waterTemp, salt, liftMode, massKg, liftN, areaCm2, share])

  return (
    <div className="tab-flow two-col">
      <div>
        <h3>Inputs</h3>
        <label className="field">
          <span>Speed</span>
          <input
            type="number"
            value={speed}
            step={0.5}
            onChange={(e) => setSpeed(Number(e.target.value))}
          />
        </label>
        <label className="field">
          <span>Unit</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)}>
            <option>m/s</option>
            <option>km/h</option>
            <option>knots</option>
            <option>mph</option>
          </select>
        </label>
        <label className="field">
          <span>Chord (mm)</span>
          <input
            type="number"
            value={chord}
            min={20}
            max={500}
            onChange={(e) => setChord(Number(e.target.value))}
          />
        </label>
        <label className="field">
          <span>Water temp (°C)</span>
          <input
            type="number"
            value={waterTemp}
            min={0}
            max={40}
            onChange={(e) => setWaterTemp(Number(e.target.value))}
          />
        </label>
        <label className="field row">
          <input type="checkbox" checked={salt} onChange={(e) => setSalt(e.target.checked)} />
          <span>Salt water (+5% ν)</span>
        </label>
        <details>
          <summary>Lift / required Cl</summary>
          <label className="field">
            <span>Load</span>
            <select
              value={liftMode}
              onChange={(e) => setLiftMode(e.target.value as typeof liftMode)}
            >
              <option value="mass_kg">Mass (kg)</option>
              <option value="force_n">Force (N)</option>
            </select>
          </label>
          {liftMode === 'mass_kg' ? (
            <label className="field">
              <span>Mass (kg)</span>
              <input
                type="number"
                value={massKg}
                onChange={(e) => setMassKg(Number(e.target.value))}
              />
            </label>
          ) : (
            <label className="field">
              <span>Lift (N)</span>
              <input
                type="number"
                value={liftN}
                onChange={(e) => setLiftN(Number(e.target.value))}
              />
            </label>
          )}
          <label className="field">
            <span>Area (cm²)</span>
            <input
              type="number"
              value={areaCm2}
              onChange={(e) => setAreaCm2(Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>Lift share (%)</span>
            <input
              type="number"
              value={share}
              min={10}
              max={100}
              onChange={(e) => setShare(Number(e.target.value))}
            />
          </label>
        </details>
      </div>
      <div>
        <h3>Results</h3>
        {err && <p className="error">{err}</p>}
        {data && (
          <>
            <dl className="metrics">
              <dt>Reynolds</dt>
              <dd>{String(data.re_label)}</dd>
              <dt>Dynamic pressure</dt>
              <dd>
                {Number(data.dynamic_pressure_pa) < 1000
                  ? `${Number(data.dynamic_pressure_pa).toFixed(0)} Pa`
                  : `${(Number(data.dynamic_pressure_pa) / 1000).toFixed(2)} kPa`}
              </dd>
              <dt>Required Cl</dt>
              <dd>{Number(data.required_cl).toFixed(3)}</dd>
              <dt>ν (m²/s)</dt>
              <dd>{Number(data.nu).toExponential(3)}</dd>
            </dl>
            <pre className="mono-block">
              {JSON.stringify(data.speed_conversions, null, 2)}
            </pre>
            <h4>Re lookup (fresh ν)</h4>
            <table className="data-table">
              <thead>
                <tr>
                  <th>v (m/s)</th>
                  <th>chord (mm)</th>
                  <th>Re (k)</th>
                </tr>
              </thead>
              <tbody>
                {(data.re_table as { speed_m_s: number; chord_mm: number; re_k: number }[]).map(
                  (row, i) => (
                    <tr key={i}>
                      <td>{row.speed_m_s}</td>
                      <td>{row.chord_mm}</td>
                      <td>{row.re_k}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}
