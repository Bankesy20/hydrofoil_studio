import {
  buildNcritList,
  mastReAndSpeeds,
  type HydroFormState,
} from './hydroState'
import { waterKinematicViscosity } from './fluid'
import * as api from './api'

function seedPayload(s: HydroFormState) {
  if (s.seedSource === 'upload' && s.seedUploadCoords?.length) {
    return { kind: 'coordinates', coordinates: s.seedUploadCoords }
  }
  return { kind: 'library', library_name: s.seedLibraryName }
}

export async function buildOptimizePayload(s: HydroFormState): Promise<Record<string, unknown>> {
  let nu = waterKinematicViscosity(s.waterTempC)
  nu *= 1.0

  let minTc = s.minTcPct / 100
  let maxTc = s.maxTcPct / 100
  if (s.lockTc) {
    const geo = (await api.postSeedAnalyze({
      component_type: s.componentType,
      chord_mm: s.chordMm,
      te_thickness: s.componentType === 'mast' ? s.teThicknessPct / 100 : null,
      seed_airfoil: seedPayload(s),
      compute_polars: false,
    })) as { geometry?: { tc?: number } }
    const tcPct = (geo.geometry?.tc ?? 0.12) * 100
    const tol = 0.15
    minTc = Math.max(tcPct - tol, 5.0) / 100
    maxTc = Math.min(tcPct + tol, 25.0) / 100
  }

  let maxTcPosBounds: [number, number] | null = null
  if (s.tcPosLoPct > 0 || s.tcPosHiPct > 0) {
    maxTcPosBounds = [
      s.tcPosLoPct > 0 ? s.tcPosLoPct / 100 : 0,
      s.tcPosHiPct > 0 ? s.tcPosHiPct / 100 : 1,
    ]
  }

  let maxCamberBounds: [number, number] | null = null
  if (s.componentType === 'front_wing' && s.maxCamberPct > 0) {
    maxCamberBounds = [0, s.maxCamberPct / 100]
  }

  let maxCamberPosBounds: [number, number] | null = null
  if (s.componentType === 'front_wing' && (s.camberPosLoPct > 0 || s.camberPosHiPct > 0)) {
    maxCamberPosBounds = [
      s.camberPosLoPct > 0 ? s.camberPosLoPct / 100 : 0,
      s.camberPosHiPct > 0 ? s.camberPosHiPct / 100 : 1,
    ]
  }

  let le_thickness_lock: Record<string, number[]> | null = null
  let te_thickness_lock: Record<string, number[]> | null = null
  if (
    (s.leLockMode !== 'Off' && (s.leTolPct > 0 || s.leTolRelPct > 0)) ||
    s.teTolPct > 0
  ) {
    const locks = await api.postEdgeLocks({
      seed_airfoil: seedPayload(s),
      le_mode: s.leLockMode,
      le_tol_pct: s.leTolPct,
      le_tol_rel_pct: s.leTolRelPct,
      te_tol_pct: s.teTolPct,
    })
    le_thickness_lock = locks.le_thickness_lock
    te_thickness_lock = locks.te_thickness_lock
  }

  const nCrit = buildNcritList(s)

  const base: Record<string, unknown> = {
    component_type: s.componentType,
    seed_airfoil: seedPayload(s),
    chord_mm: s.chordMm,
    min_tc: minTc,
    max_tc: maxTc,
    max_tc_pos_bounds: maxTcPosBounds,
    max_camber_bounds: maxCamberBounds,
    max_camber_pos_bounds: maxCamberPosBounds,
    le_thickness_lock,
    te_thickness_lock,
    n_crit: nCrit,
    nu,
    w_smoothness: s.wSmoothness,
    w_pressure_recovery: s.wPressureRecovery,
    cst_bound_range: s.cstBoundRange,
    pop_size: s.popSize,
    max_iter: s.maxIter,
    random_seed: s.randomSeed,
    final_high_fidelity: s.finalHighFidelity,
    final_high_fidelity_top_n: s.finalHighFidelityTopN,
    optim_model_size: s.optimModelSize,
  }

  if (s.stiffnessEnabled) {
    base.stiffness = {
      section_type: s.stiffnessSection.toLowerCase(),
      wall_thickness_m:
        s.stiffnessSection === 'Hollow' ? s.wallThicknessMm / 1000 : null,
      tolerance_pct: s.stiffnessTolPct,
      one_sided: s.stiffnessOneSided,
      w_bending: s.wBending,
      w_torsion: s.wTorsion,
    }
  }

  if (s.componentType === 'mast') {
    const { speeds, Re_values } = mastReAndSpeeds(s)
    Object.assign(base, {
      speeds,
      Re_values,
      max_aoa: s.maxAoa,
      n_aoa: s.nAoa,
      cpmin_limit: s.enableCpmin ? s.cpminLimit : null,
      w_cm: s.wCm,
      cd_regression_pct: s.cdRegressionPct,
      cm_regression_abs: s.cmRegressionAbs,
      te_thickness: s.teThicknessPct / 100,
    })
  } else {
    const pts = s.operatingPoints.slice(0, s.nOpPoints)
    Object.assign(base, {
      operating_points: pts,
      cm_limit: s.enableCmLimit ? s.cmLimit : null,
      cm_limit_alpha: s.cmLimitAlpha,
      dcm_dcl_limit: s.enableDcmDcl ? s.dcmDclTolPct / 100 : null,
      dcm_dcl_cl_range: [s.dcmDclClMin, s.dcmDclClMax],
      min_te_thickness: s.minTePct / 100,
      max_te_thickness: s.maxTePct / 100,
    })
  }

  return base
}
