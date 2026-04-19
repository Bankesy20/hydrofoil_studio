import { waterKinematicViscosity } from './fluid'

export type ComponentType = 'mast' | 'front_wing'

export type LeLockMode = 'Off' | 'Absolute (± % chord)' | 'Relative (± % of seed)'

export interface OperatingPoint {
  Re: number
  target_cl: number
  objective: 'min_cd' | 'max_cl_cd' | 'max_cl'
  weight: number
}

export interface HydroFormState {
  componentType: ComponentType
  presetKey: string
  seedSource: 'library' | 'section'
  seedLibraryName: string
  /** Optimisation / API seed when ``seedSource === 'section'`` (Selig N×2). Synced from Foil workshop. */
  seedUploadCoords: number[][] | null
  /** Which foil section row supplies ``seedUploadCoords`` when using sections. */
  seedSectionId: string | null
  /** Section id + name list from the foil workshop (sidebar picker). */
  foilSectionOptions: { id: string; name: string }[]
  compareEnabled: boolean
  compareSource: 'library' | 'upload'
  compareLibraryName: string
  compareUploadCoords: number[][] | null
  compareLegend: string
  chordMm: number
  lockTc: boolean
  minTcPct: number
  maxTcPct: number
  tcPosLoPct: number
  tcPosHiPct: number
  leLockMode: LeLockMode
  leTolPct: number
  leTolRelPct: number
  teTolPct: number
  maxCamberPct: number
  camberPosLoPct: number
  camberPosHiPct: number
  teThicknessPct: number
  minTePct: number
  maxTePct: number
  waterTempC: number
  speedMin: number
  speedMax: number
  nSpeeds: number
  maxAoa: number
  nAoa: number
  multiNcrit: boolean
  ncritMin: number
  ncritMax: number
  nNcrit: number
  ncritSingle: number
  nOpPoints: number
  operatingPoints: OperatingPoint[]
  enableCpmin: boolean
  cpminLimit: number
  wCm: number
  cdRegressionPct: number
  cmRegressionAbs: number
  enableCmLimit: boolean
  cmLimit: number
  cmLimitAlpha: number
  enableDcmDcl: boolean
  dcmDclTolPct: number
  dcmDclClMin: number
  dcmDclClMax: number
  stiffnessEnabled: boolean
  stiffnessSection: 'Solid' | 'Hollow'
  wallThicknessMm: number
  stiffnessTolPct: number
  stiffnessOneSided: boolean
  wBending: number
  wTorsion: number
  wSmoothness: number
  wPressureRecovery: number
  cstBoundRange: number
  popSize: number
  maxIter: number
  randomSeed: number
  finalHighFidelity: boolean
  finalHighFidelityTopN: number
  optimModelSize: 'tiny' | 'small' | 'medium' | 'large' | 'xlarge'
}

export function defaultOperatingPoints(): OperatingPoint[] {
  return [
    { Re: 800000, target_cl: 0.6, objective: 'max_cl_cd', weight: 0.5 },
    { Re: 1200000, target_cl: 0.3, objective: 'min_cd', weight: 0.3 },
    { Re: 400000, target_cl: 0.9, objective: 'min_cd', weight: 0.2 },
  ]
}

export function initialHydroForm(): HydroFormState {
  return {
    componentType: 'mast',
    presetKey: 'Custom',
    seedSource: 'library',
    seedLibraryName: 'NACA 0012',
    seedUploadCoords: null,
    seedSectionId: null,
    foilSectionOptions: [],
    compareEnabled: false,
    compareSource: 'library',
    compareLibraryName: 'NACA 0010',
    compareUploadCoords: null,
    compareLegend: '',
    chordMm: 124,
    lockTc: false,
    minTcPct: 10,
    maxTcPct: 16,
    tcPosLoPct: 0,
    tcPosHiPct: 0,
    leLockMode: 'Off',
    leTolPct: 0,
    leTolRelPct: 25,
    teTolPct: 0,
    maxCamberPct: 0,
    camberPosLoPct: 0,
    camberPosHiPct: 0,
    teThicknessPct: 0.5,
    minTePct: 0.3,
    maxTePct: 1.0,
    waterTempC: 20,
    speedMin: 4,
    speedMax: 10,
    nSpeeds: 4,
    maxAoa: 3,
    nAoa: 5,
    multiNcrit: true,
    ncritMin: 0.5,
    ncritMax: 2,
    nNcrit: 4,
    ncritSingle: 7,
    nOpPoints: 3,
    operatingPoints: defaultOperatingPoints(),
    enableCpmin: false,
    cpminLimit: -0.5,
    wCm: 0.1,
    cdRegressionPct: 5,
    cmRegressionAbs: 0.001,
    enableCmLimit: false,
    cmLimit: 0.1,
    cmLimitAlpha: 0,
    enableDcmDcl: false,
    dcmDclTolPct: 10,
    dcmDclClMin: -1,
    dcmDclClMax: 1,
    stiffnessEnabled: false,
    stiffnessSection: 'Solid',
    wallThicknessMm: 3,
    stiffnessTolPct: 10,
    stiffnessOneSided: true,
    wBending: 0.5,
    wTorsion: 0.5,
    wSmoothness: 0.2,
    wPressureRecovery: 0,
    cstBoundRange: 0.25,
    popSize: 96,
    maxIter: 300,
    randomSeed: 42,
    finalHighFidelity: true,
    finalHighFidelityTopN: 10,
    optimModelSize: 'medium',
  }
}

export function applyPreset(
  s: HydroFormState,
  key: string,
  presets: Record<string, Record<string, unknown>>,
): HydroFormState {
  if (key === 'Custom') return { ...s, presetKey: 'Custom' }
  const p = presets[key]
  if (!p) return { ...s, presetKey: key }
  const next = { ...s, presetKey: key }
  if (p.component_type === 'mast') next.componentType = 'mast'
  if (p.component_type === 'front_wing') next.componentType = 'front_wing'
  const n = (x: unknown) => Number(x)
  const b = (x: unknown) => Boolean(x)
  if (p.chord_mm !== undefined) next.chordMm = n(p.chord_mm)
  if (p.min_tc_pct !== undefined) next.minTcPct = n(p.min_tc_pct)
  if (p.max_tc_pct !== undefined) next.maxTcPct = n(p.max_tc_pct)
  if (p.te_thickness_pct !== undefined) next.teThicknessPct = n(p.te_thickness_pct)
  if (p.speed_min !== undefined) next.speedMin = n(p.speed_min)
  if (p.speed_max !== undefined) next.speedMax = n(p.speed_max)
  if (p.n_speeds !== undefined) next.nSpeeds = n(p.n_speeds)
  if (p.max_aoa !== undefined) next.maxAoa = n(p.max_aoa)
  if (p.n_aoa !== undefined) next.nAoa = n(p.n_aoa)
  if (p.n_crit !== undefined) next.ncritSingle = n(p.n_crit)
  if (p.cpmin_limit !== undefined && p.cpmin_limit !== null) {
    next.enableCpmin = true
    next.cpminLimit = n(p.cpmin_limit)
  }
  if (p.w_cm !== undefined) next.wCm = n(p.w_cm)
  if (p.pop_size !== undefined) next.popSize = n(p.pop_size)
  if (p.max_iter !== undefined) next.maxIter = n(p.max_iter)
  if (p.final_high_fidelity !== undefined) next.finalHighFidelity = b(p.final_high_fidelity)
  if (p.final_high_fidelity_top_n !== undefined) next.finalHighFidelityTopN = n(p.final_high_fidelity_top_n)
  if (p.w_smoothness !== undefined) next.wSmoothness = n(p.w_smoothness)
  if (p.w_pressure_recovery !== undefined) next.wPressureRecovery = n(p.w_pressure_recovery)
  if (p.cst_bound_range !== undefined) next.cstBoundRange = n(p.cst_bound_range)
  if (Array.isArray(p.operating_points)) {
    next.operatingPoints = (p.operating_points as OperatingPoint[]).map((o) => ({ ...o }))
    next.nOpPoints = next.operatingPoints.length
  }
  if (p.cm_limit !== undefined && p.cm_limit !== null) {
    next.enableCmLimit = true
    next.cmLimit = n(p.cm_limit)
  }
  return next
}

export function linspace(lo: number, hi: number, n: number): number[] {
  if (n < 2) return [lo]
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(lo + ((hi - lo) * i) / (n - 1))
  return out
}

export function buildNcritList(s: HydroFormState): number[] | number {
  if (s.multiNcrit) return linspace(s.ncritMin, s.ncritMax, s.nNcrit)
  return s.ncritSingle
}

export function mastReAndSpeeds(s: HydroFormState): { speeds: number[]; Re_values: number[] } {
  const chordM = s.chordMm / 1000
  let nu = waterKinematicViscosity(s.waterTempC)
  nu *= 1.0
  const speeds = linspace(s.speedMin, s.speedMax, s.nSpeeds)
  const Re_values = speeds.map((sp) => (sp * chordM) / Math.max(nu, 1e-12))
  return { speeds, Re_values }
}
