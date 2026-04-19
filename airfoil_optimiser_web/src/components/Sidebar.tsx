import type { HydroFormState, LeLockMode, OperatingPoint } from '../hydroState'
import { applyPreset } from '../hydroState'

type Props = {
  presets: Record<string, Record<string, unknown>>
  mastAirfoils: string[]
  wingAirfoils: string[]
  s: HydroFormState
  set: (fn: (p: HydroFormState) => HydroFormState) => void
  onRunOptimization: () => void
  onResetResults: () => void
}

export function Sidebar({
  presets,
  mastAirfoils,
  wingAirfoils,
  s,
  set,
  onRunOptimization,
  onResetResults,
}: Props) {
  const presetNames = ['Custom', ...Object.keys(presets).filter((k) => {
    const ct = presets[k]?.component_type as string
    return ct === s.componentType
  })]

  const airfoils = s.componentType === 'mast' ? mastAirfoils : wingAirfoils

  const updateOp = (i: number, patch: Partial<OperatingPoint>) => {
    set((p) => {
      const op = [...p.operatingPoints]
      op[i] = { ...op[i], ...patch }
      return { ...p, operatingPoints: op }
    })
  }

  return (
    <aside className="sidebar">
      <h2>Configuration</h2>
      <div className="sidebar-scroll">
      <label className="field">
        <span>Component</span>
        <select
          value={s.componentType === 'mast' ? 'Mast' : 'Front Wing'}
          onChange={(e) =>
            set((p) => ({
              ...p,
              componentType: e.target.value === 'Mast' ? 'mast' : 'front_wing',
              seedLibraryName:
                e.target.value === 'Mast' ? 'NACA 0012' : 'NACA 4412',
            }))
          }
        >
          <option>Mast</option>
          <option>Front Wing</option>
        </select>
      </label>

      <label className="field">
        <span>Preset</span>
        <select
          value={s.presetKey}
          onChange={(e) =>
            set((p) => applyPreset({ ...p, presetKey: e.target.value }, e.target.value, presets))
          }
        >
          {presetNames.map((n) => (
            <option key={n} value={n}>
              {n === 'Custom' ? 'Custom' : (presets[n]?.label as string) ?? n}
            </option>
          ))}
        </select>
      </label>

      <details open>
        <summary>Seed airfoil</summary>
        <label className="field">
          <span>Source</span>
          <select
            value={s.seedSource}
            onChange={(e) => {
              const v = e.target.value as 'library' | 'section'
              set((p) => {
                if (v === 'section') {
                  const first = p.foilSectionOptions[0]?.id ?? null
                  return {
                    ...p,
                    seedSource: 'section',
                    seedSectionId: p.seedSectionId && p.foilSectionOptions.some((o) => o.id === p.seedSectionId)
                      ? p.seedSectionId
                      : first,
                  }
                }
                return { ...p, seedSource: 'library' }
              })
            }}
          >
            <option value="library">Library</option>
            <option value="section">Foil section (Seed tab)</option>
          </select>
        </label>
        {s.seedSource === 'library' ? (
          <label className="field">
            <span>Airfoil</span>
            <select
              value={s.seedLibraryName}
              onChange={(e) => set((p) => ({ ...p, seedLibraryName: e.target.value }))}
            >
              {airfoils.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label className="field">
              <span>Section</span>
              <select
                value={s.seedSectionId ?? ''}
                disabled={!s.foilSectionOptions.length}
                onChange={(e) =>
                  set((p) => ({
                    ...p,
                    seedSectionId: e.target.value || null,
                  }))
                }
              >
                {!s.foilSectionOptions.length ? (
                  <option value="">— open Seed tab first —</option>
                ) : (
                  s.foilSectionOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <p className="hint sidebar-seed-section-hint">
              Uses the same sampling as the foil workshop (points per surface & spacing). Import or edit sections on
              the <strong>Seed airfoil</strong> tab.
            </p>
          </>
        )}
      </details>

      <details open>
        <summary>Geometry</summary>
        <label className="field">
          <span>Chord (mm)</span>
          <input
            type="number"
            value={s.chordMm}
            min={50}
            max={300}
            onChange={(e) => set((p) => ({ ...p, chordMm: Number(e.target.value) }))}
          />
        </label>
        <label className="field row">
          <input
            type="checkbox"
            checked={s.lockTc}
            onChange={(e) => set((p) => ({ ...p, lockTc: e.target.checked }))}
          />
          <span>Lock thickness to seed</span>
        </label>
        {!s.lockTc && (
          <div className="row2">
            <label>
              Min t/c %
              <input
                type="number"
                value={s.minTcPct}
                step={0.5}
                onChange={(e) => set((p) => ({ ...p, minTcPct: Number(e.target.value) }))}
              />
            </label>
            <label>
              Max t/c %
              <input
                type="number"
                value={s.maxTcPct}
                step={0.5}
                onChange={(e) => set((p) => ({ ...p, maxTcPct: Number(e.target.value) }))}
              />
            </label>
          </div>
        )}
        <p className="hint">Shape locks — max thickness position</p>
        <div className="row2">
          <label>
            No further forward (% c)
            <input
              type="number"
              value={s.tcPosLoPct}
              min={0}
              max={60}
              onChange={(e) => set((p) => ({ ...p, tcPosLoPct: Number(e.target.value) }))}
            />
          </label>
          <label>
            No further back (% c)
            <input
              type="number"
              value={s.tcPosHiPct}
              min={0}
              max={70}
              onChange={(e) => set((p) => ({ ...p, tcPosHiPct: Number(e.target.value) }))}
            />
          </label>
        </div>
        <label className="field">
          <span>LE lock mode</span>
          <select
            value={s.leLockMode}
            onChange={(e) =>
              set((p) => ({ ...p, leLockMode: e.target.value as LeLockMode }))
            }
          >
            <option>Off</option>
            <option>Absolute (± % chord)</option>
            <option>Relative (± % of seed)</option>
          </select>
        </label>
        {s.leLockMode === 'Absolute (± % chord)' && (
          <label className="field">
            <span>LE tolerance (± % chord)</span>
            <input
              type="number"
              value={s.leTolPct}
              step={0.05}
              onChange={(e) => set((p) => ({ ...p, leTolPct: Number(e.target.value) }))}
            />
          </label>
        )}
        {s.leLockMode === 'Relative (± % of seed)' && (
          <label className="field">
            <span>LE tolerance (± % of seed)</span>
            <input
              type="number"
              value={s.leTolRelPct}
              step={5}
              onChange={(e) => set((p) => ({ ...p, leTolRelPct: Number(e.target.value) }))}
            />
          </label>
        )}
        <label className="field">
          <span>TE tolerance (± % chord)</span>
          <input
            type="number"
            value={s.teTolPct}
            step={0.05}
            onChange={(e) => set((p) => ({ ...p, teTolPct: Number(e.target.value) }))}
          />
        </label>
        {s.componentType === 'front_wing' && (
          <>
            <label className="field">
              <span>Max camber (% chord)</span>
              <input
                type="number"
                value={s.maxCamberPct}
                step={0.5}
                onChange={(e) => set((p) => ({ ...p, maxCamberPct: Number(e.target.value) }))}
              />
            </label>
            <div className="row2">
              <label>
                Camber fwd limit (% c)
                <input
                  type="number"
                  value={s.camberPosLoPct}
                  onChange={(e) => set((p) => ({ ...p, camberPosLoPct: Number(e.target.value) }))}
                />
              </label>
              <label>
                Camber aft limit (% c)
                <input
                  type="number"
                  value={s.camberPosHiPct}
                  onChange={(e) => set((p) => ({ ...p, camberPosHiPct: Number(e.target.value) }))}
                />
              </label>
            </div>
            <div className="row2">
              <label>
                Min TE % chord
                <input
                  type="number"
                  value={s.minTePct}
                  step={0.1}
                  onChange={(e) => set((p) => ({ ...p, minTePct: Number(e.target.value) }))}
                />
              </label>
              <label>
                Max TE % chord
                <input
                  type="number"
                  value={s.maxTePct}
                  step={0.1}
                  onChange={(e) => set((p) => ({ ...p, maxTePct: Number(e.target.value) }))}
                />
              </label>
            </div>
          </>
        )}
        {s.componentType === 'mast' && (
          <label className="field">
            <span>TE thickness (% chord)</span>
            <input
              type="number"
              value={s.teThicknessPct}
              step={0.1}
              onChange={(e) => set((p) => ({ ...p, teThicknessPct: Number(e.target.value) }))}
            />
          </label>
        )}
      </details>

      <details open>
        <summary>Operating conditions</summary>
        <label className="field">
          <span>Water temp (°C)</span>
          <input
            type="number"
            value={s.waterTempC}
            onChange={(e) => set((p) => ({ ...p, waterTempC: Number(e.target.value) }))}
          />
        </label>
        {s.componentType === 'mast' ? (
          <>
            <div className="row2">
              <label>
                Min speed (m/s)
                <input
                  type="number"
                  value={s.speedMin}
                  step={0.5}
                  onChange={(e) => set((p) => ({ ...p, speedMin: Number(e.target.value) }))}
                />
              </label>
              <label>
                Max speed (m/s)
                <input
                  type="number"
                  value={s.speedMax}
                  step={0.5}
                  onChange={(e) => set((p) => ({ ...p, speedMax: Number(e.target.value) }))}
                />
              </label>
            </div>
            <label className="field">
              <span>Speed points</span>
              <input
                type="number"
                value={s.nSpeeds}
                min={2}
                max={6}
                onChange={(e) => set((p) => ({ ...p, nSpeeds: Number(e.target.value) }))}
              />
            </label>
            <label className="field">
              <span>Max AoA (deg)</span>
              <input
                type="number"
                value={s.maxAoa}
                step={0.5}
                onChange={(e) => set((p) => ({ ...p, maxAoa: Number(e.target.value) }))}
              />
            </label>
            <label className="field">
              <span>AoA points</span>
              <input
                type="number"
                value={s.nAoa}
                min={2}
                max={6}
                onChange={(e) => set((p) => ({ ...p, nAoa: Number(e.target.value) }))}
              />
            </label>
          </>
        ) : (
          <>
            <label className="field">
              <span>Operating points</span>
              <input
                type="number"
                value={s.nOpPoints}
                min={1}
                max={6}
                onChange={(e) => set((p) => ({ ...p, nOpPoints: Number(e.target.value) }))}
              />
            </label>
            {Array.from({ length: s.nOpPoints }, (_, i) => (
              <div key={i} className="op-block">
                <strong>Point {i + 1}</strong>
                <div className="row2">
                  <label>
                    Re
                    <input
                      type="number"
                      value={s.operatingPoints[i]?.Re ?? 0}
                      step={100000}
                      onChange={(e) => updateOp(i, { Re: Number(e.target.value) })}
                    />
                  </label>
                  <label>
                    Target Cl
                    <input
                      type="number"
                      value={s.operatingPoints[i]?.target_cl ?? 0}
                      step={0.1}
                      onChange={(e) => updateOp(i, { target_cl: Number(e.target.value) })}
                    />
                  </label>
                </div>
                <div className="row2">
                  <label>
                    Objective
                    <select
                      value={s.operatingPoints[i]?.objective ?? 'min_cd'}
                      onChange={(e) =>
                        updateOp(i, {
                          objective: e.target.value as OperatingPoint['objective'],
                        })
                      }
                    >
                      <option value="min_cd">min_cd</option>
                      <option value="max_cl_cd">max_cl_cd</option>
                      <option value="max_cl">max_cl</option>
                    </select>
                  </label>
                  <label>
                    Weight
                    <input
                      type="number"
                      value={s.operatingPoints[i]?.weight ?? 0}
                      step={0.1}
                      onChange={(e) => updateOp(i, { weight: Number(e.target.value) })}
                    />
                  </label>
                </div>
              </div>
            ))}
          </>
        )}
        <label className="field row">
          <input
            type="checkbox"
            checked={s.multiNcrit}
            onChange={(e) => set((p) => ({ ...p, multiNcrit: e.target.checked }))}
          />
          <span>Multi-Ncrit averaging</span>
        </label>
        {s.multiNcrit ? (
          <div className="row2">
            <label>
              Ncrit min
              <input
                type="number"
                value={s.ncritMin}
                step={0.5}
                onChange={(e) => set((p) => ({ ...p, ncritMin: Number(e.target.value) }))}
              />
            </label>
            <label>
              Ncrit max
              <input
                type="number"
                value={s.ncritMax}
                step={0.5}
                onChange={(e) => set((p) => ({ ...p, ncritMax: Number(e.target.value) }))}
              />
            </label>
            <label className="field">
              <span>Ncrit points</span>
              <input
                type="number"
                value={s.nNcrit}
                min={2}
                max={6}
                onChange={(e) => set((p) => ({ ...p, nNcrit: Number(e.target.value) }))}
              />
            </label>
          </div>
        ) : (
          <label className="field">
            <span>n_crit</span>
            <input
              type="number"
              value={s.ncritSingle}
              min={0}
              max={12}
              onChange={(e) => set((p) => ({ ...p, ncritSingle: Number(e.target.value) }))}
            />
          </label>
        )}
      </details>

      <details>
        <summary>Constraints & penalties</summary>
        {s.componentType === 'mast' ? (
          <>
            <label className="field row">
              <input
                type="checkbox"
                checked={s.enableCpmin}
                onChange={(e) => set((p) => ({ ...p, enableCpmin: e.target.checked }))}
              />
              <span>Cpmin limit</span>
            </label>
            {s.enableCpmin && (
              <label className="field">
                <span>Cpmin limit</span>
                <input
                  type="number"
                  value={s.cpminLimit}
                  step={0.1}
                  onChange={(e) => set((p) => ({ ...p, cpminLimit: Number(e.target.value) }))}
                />
              </label>
            )}
            <label className="field">
              <span>Cm penalty weight</span>
              <input
                type="number"
                value={s.wCm}
                step={0.1}
                min={0}
                max={1}
                onChange={(e) => set((p) => ({ ...p, wCm: Number(e.target.value) }))}
              />
            </label>
            <label className="field">
              <span>Max CD regression at low AoA (%)</span>
              <input
                type="number"
                value={s.cdRegressionPct}
                onChange={(e) => set((p) => ({ ...p, cdRegressionPct: Number(e.target.value) }))}
              />
            </label>
            <label className="field">
              <span>Max CM regression (abs)</span>
              <input
                type="number"
                value={s.cmRegressionAbs}
                step={0.0005}
                onChange={(e) => set((p) => ({ ...p, cmRegressionAbs: Number(e.target.value) }))}
              />
            </label>
          </>
        ) : (
          <>
            <label className="field row">
              <input
                type="checkbox"
                checked={s.enableCmLimit}
                onChange={(e) => set((p) => ({ ...p, enableCmLimit: e.target.checked }))}
              />
              <span>Cm limit</span>
            </label>
            {s.enableCmLimit && (
              <div className="row2">
                <label>
                  Max |Cm|
                  <input
                    type="number"
                    value={s.cmLimit}
                    step={0.01}
                    onChange={(e) => set((p) => ({ ...p, cmLimit: Number(e.target.value) }))}
                  />
                </label>
                <label>
                  At AoA (deg)
                  <input
                    type="number"
                    value={s.cmLimitAlpha}
                    step={0.5}
                    onChange={(e) => set((p) => ({ ...p, cmLimitAlpha: Number(e.target.value) }))}
                  />
                </label>
              </div>
            )}
            <label className="field row">
              <input
                type="checkbox"
                checked={s.enableDcmDcl}
                onChange={(e) => set((p) => ({ ...p, enableDcmDcl: e.target.checked }))}
              />
              <span>dCm/dCl constraint</span>
            </label>
            {s.enableDcmDcl && (
              <div className="row2">
                <label>
                  Tolerance vs seed (%)
                  <input
                    type="number"
                    value={s.dcmDclTolPct}
                    step={5}
                    onChange={(e) => set((p) => ({ ...p, dcmDclTolPct: Number(e.target.value) }))}
                  />
                </label>
                <label>
                  Cl min
                  <input
                    type="number"
                    value={s.dcmDclClMin}
                    step={0.1}
                    onChange={(e) => set((p) => ({ ...p, dcmDclClMin: Number(e.target.value) }))}
                  />
                </label>
                <label>
                  Cl max
                  <input
                    type="number"
                    value={s.dcmDclClMax}
                    step={0.1}
                    onChange={(e) => set((p) => ({ ...p, dcmDclClMax: Number(e.target.value) }))}
                  />
                </label>
              </div>
            )}
          </>
        )}
      </details>

      <details>
        <summary>Stiffness (optional)</summary>
        <label className="field row">
          <input
            type="checkbox"
            checked={s.stiffnessEnabled}
            onChange={(e) => set((p) => ({ ...p, stiffnessEnabled: e.target.checked }))}
          />
          <span>Enable</span>
        </label>
        {s.stiffnessEnabled && (
          <>
            <label className="field">
              <span>Section</span>
              <select
                value={s.stiffnessSection}
                onChange={(e) =>
                  set((p) => ({
                    ...p,
                    stiffnessSection: e.target.value as 'Solid' | 'Hollow',
                  }))
                }
              >
                <option>Solid</option>
                <option>Hollow</option>
              </select>
            </label>
            {s.stiffnessSection === 'Hollow' && (
              <label className="field">
                <span>Wall thickness (mm)</span>
                <input
                  type="number"
                  value={s.wallThicknessMm}
                  step={0.5}
                  onChange={(e) => set((p) => ({ ...p, wallThicknessMm: Number(e.target.value) }))}
                />
              </label>
            )}
            <label className="field">
              <span>Tolerance (%)</span>
              <input
                type="number"
                value={s.stiffnessTolPct}
                onChange={(e) => set((p) => ({ ...p, stiffnessTolPct: Number(e.target.value) }))}
              />
            </label>
            <label className="field row">
              <input
                type="checkbox"
                checked={s.stiffnessOneSided}
                onChange={(e) => set((p) => ({ ...p, stiffnessOneSided: e.target.checked }))}
              />
              <span>One-sided</span>
            </label>
            <div className="row2">
              <label>
                Bending w
                <input
                  type="number"
                  value={s.wBending}
                  step={0.1}
                  onChange={(e) => set((p) => ({ ...p, wBending: Number(e.target.value) }))}
                />
              </label>
              <label>
                Torsion w
                <input
                  type="number"
                  value={s.wTorsion}
                  step={0.1}
                  onChange={(e) => set((p) => ({ ...p, wTorsion: Number(e.target.value) }))}
                />
              </label>
            </div>
          </>
        )}
      </details>

      <details>
        <summary>Shape quality</summary>
        <label className="field">
          <span>Smoothness penalty</span>
          <input
            type="number"
            value={s.wSmoothness}
            step={0.05}
            min={0}
            max={1}
            onChange={(e) => set((p) => ({ ...p, wSmoothness: Number(e.target.value) }))}
          />
        </label>
        <label className="field">
          <span>Pressure recovery penalty</span>
          <input
            type="number"
            value={s.wPressureRecovery}
            step={0.05}
            min={0}
            max={1}
            onChange={(e) => set((p) => ({ ...p, wPressureRecovery: Number(e.target.value) }))}
          />
        </label>
        <label className="field">
          <span>CST weight range (±)</span>
          <input
            type="number"
            value={s.cstBoundRange}
            step={0.05}
            min={0.1}
            max={0.5}
            onChange={(e) => set((p) => ({ ...p, cstBoundRange: Number(e.target.value) }))}
          />
        </label>
      </details>

      <details open>
        <summary>Optimiser</summary>
        <label className="field">
          <span>Population (approx.)</span>
          <input
            type="number"
            value={s.popSize}
            step={8}
            min={16}
            max={400}
            onChange={(e) => set((p) => ({ ...p, popSize: Number(e.target.value) }))}
          />
        </label>
        <label className="field">
          <span>Max iterations</span>
          <input
            type="number"
            value={s.maxIter}
            step={50}
            min={50}
            max={2000}
            onChange={(e) => set((p) => ({ ...p, maxIter: Number(e.target.value) }))}
          />
        </label>
        <label className="field">
          <span>Random seed</span>
          <input
            type="number"
            value={s.randomSeed}
            onChange={(e) => set((p) => ({ ...p, randomSeed: Number(e.target.value) }))}
          />
        </label>
        <label className="field">
          <span>Surrogate during optimisation</span>
          <select
            value={s.optimModelSize}
            onChange={(e) =>
              set((p) => ({
                ...p,
                optimModelSize: e.target.value as HydroFormState['optimModelSize'],
              }))
            }
          >
            <option value="tiny">tiny</option>
            <option value="small">small</option>
            <option value="medium">medium</option>
            <option value="large">large</option>
            <option value="xlarge">xlarge</option>
          </select>
        </label>
        <label className="field row">
          <input
            type="checkbox"
            checked={s.finalHighFidelity}
            onChange={(e) => set((p) => ({ ...p, finalHighFidelity: e.target.checked }))}
          />
          <span>High-fidelity reselect (xlarge)</span>
        </label>
        <label className="field">
          <span>HF candidate count</span>
          <input
            type="number"
            value={s.finalHighFidelityTopN}
            min={3}
            max={30}
            onChange={(e) => set((p) => ({ ...p, finalHighFidelityTopN: Number(e.target.value) }))}
          />
        </label>
      </details>

      </div>

      <div className="sidebar-actions">
        <button type="button" className="primary" onClick={onRunOptimization}>
          Run optimization
        </button>
        <button type="button" className="ghost" onClick={onResetResults}>
          Reset results
        </button>
      </div>
    </aside>
  )
}
