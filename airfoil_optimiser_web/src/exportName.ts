import { waterKinematicViscosity } from './fluid'
import { linspace, type HydroFormState } from './hydroState'

function mastReValues(s: HydroFormState): number[] {
  const chordM = s.chordMm / 1000
  const nu = waterKinematicViscosity(s.waterTempC)
  const speeds = linspace(s.speedMin, s.speedMax, Math.max(s.nSpeeds, 2))
  return speeds.map((sp) => (sp * chordM) / Math.max(nu, 1e-12))
}

/** Filename stem aligned with Streamlit ``_build_export_name`` logic. */
export function buildExportStem(s: HydroFormState): string {
  const parts: string[] = []
  const short =
    s.seedSource === 'library'
      ? s.seedLibraryName.replace(/NACA /g, 'N').replace(/-/g, '').replace(/ /g, '')
      : (s.foilSectionOptions.find((o) => o.id === s.seedSectionId)?.name ?? 'section')
          .replace(/NACA /g, 'N')
          .replace(/-/g, '')
          .replace(/ /g, '')
          .replace(/[^\w.-]+/g, '_') || 'custom'
  parts.push(short)

  if (s.componentType === 'mast') {
    const Re_values = mastReValues(s)
    const reLo = Math.round(Math.min(...Re_values) / 1e3)
    const reHi = Math.round(Math.max(...Re_values) / 1e3)
    parts.push(`Re${reLo}k-${reHi}k`)
    parts.push(`AoA${s.maxAoa.toFixed(1)}`)
  } else {
    parts.push(`Op${s.nOpPoints}`)
  }

  const nc = s.multiNcrit ? s.nNcrit : 1
  parts.push(`Nc${nc}`)
  parts.push(`tc${Math.round(s.minTcPct)}-${Math.round(s.maxTcPct)}`)
  if (s.componentType === 'mast' && s.enableCpmin) parts.push(`Cp${s.cpminLimit.toFixed(1)}`)
  if (s.componentType === 'mast' && s.wCm > 0) parts.push(`Cm${s.wCm.toFixed(1)}`)
  if (s.wSmoothness > 0) parts.push(`Sm${s.wSmoothness}`)
  parts.push(`P${s.popSize}i${s.maxIter}`)
  return parts.join('_')
}
