import * as api from './api'
import type { ByReBlock } from './polarFlexPlot'
import type { HydroFormState } from './hydroState'

type PolarBody = {
  re_list: number[]
  ncrit: number
  model_size: string
  alpha_start: number
  alpha_end: number
  alpha_step: number
}

function seedFromCoords(coordinates: number[][]) {
  return { kind: 'coordinates' as const, coordinates }
}

export type MergedPolars = {
  byRe: ByReBlock
  byReB: ByReBlock | null
  extraByReList: { byRe: ByReBlock; label: string }[]
  primaryLabel: string
  compareLabel: string
  signature: string
}

function tePayload(form: HydroFormState) {
  return form.componentType === 'mast' ? form.teThicknessPct / 100 : null
}

/**
 * 1 airfoil: single request. 2: seed + compare in one. 3+: one batch for first+second, then
 * parallel single-foil sweeps; merged for charts.
 */
export async function runMergedSeedPolars(
  form: HydroFormState,
  polar: PolarBody,
  included: { name: string; coordinates: number[][] }[],
): Promise<MergedPolars> {
  if (included.length === 0) {
    throw new Error('No airfoils selected for polars (check “Plr” on a foil in the list).')
  }
  for (const row of included) {
    if (!row.coordinates || row.coordinates.length < 10) {
      throw new Error(`Not enough points for “${row.name}” (need a valid sampled Selig set). Edit or reset the foil.`)
    }
  }
  const te = tePayload(form)
  const base = {
    component_type: form.componentType,
    chord_mm: form.chordMm,
    te_thickness: te,
    compute_polars: true,
    polar,
  } as const
  if (included.length === 1) {
    const r = await api.postSeedAnalyze({
      ...base,
      seed_airfoil: seedFromCoords(included[0]!.coordinates),
    } as Record<string, unknown>)
    const pol = r.polars as Record<string, unknown> | undefined
    if (!pol?.by_re) throw new Error('No polars in response')
    return {
      byRe: pol.by_re as ByReBlock,
      byReB: null,
      extraByReList: [],
      primaryLabel: included[0]!.name,
      compareLabel: '',
      signature: `${included[0]!.name}|${(pol.alphas as number[] | undefined)?.join?.(',') ?? ''}`,
    }
  }
  if (included.length === 2) {
    const r = await api.postSeedAnalyze({
      ...base,
      seed_airfoil: seedFromCoords(included[0]!.coordinates),
      compare: {
        kind: 'coordinates' as const,
        coordinates: included[1]!.coordinates,
        legend: included[1]!.name,
      },
    } as Record<string, unknown>)
    const pol = r.polars as Record<string, unknown> | undefined
    if (!pol?.by_re) throw new Error('No polars in response')
    return {
      byRe: pol.by_re as ByReBlock,
      byReB: (pol.by_re_b as ByReBlock | null) ?? null,
      extraByReList: [],
      primaryLabel: included[0]!.name,
      compareLabel: included[1]!.name,
      signature: `${included[0]!.name}|${included[1]!.name}|${(pol.alphas as number[] | undefined)?.join?.(',') ?? ''}`,
    }
  }

  const a = included[0]!
  const b = included[1]!
  const r12 = await api.postSeedAnalyze({
    ...base,
    seed_airfoil: seedFromCoords(a.coordinates),
    compare: { kind: 'coordinates' as const, coordinates: b.coordinates, legend: b.name },
  } as Record<string, unknown>)
  const pol12 = r12.polars as Record<string, unknown> | undefined
  if (!pol12?.by_re) throw new Error('No polars in two-foil batch')
  const rest = included.slice(2)
  const rN = await Promise.all(
    rest.map((f) =>
      api.postSeedAnalyze({
        ...base,
        seed_airfoil: seedFromCoords(f.coordinates),
      } as Record<string, unknown>),
    ),
  )
  const extra: { byRe: ByReBlock; label: string }[] = []
  for (let i = 0; i < rN.length; i += 1) {
    const p = rN[i]!.polars as Record<string, unknown> | undefined
    const by = p?.by_re as ByReBlock | undefined
    if (by) extra.push({ byRe: by, label: rest[i]!.name })
  }
  return {
    byRe: pol12.by_re as ByReBlock,
    byReB: (pol12.by_re_b as ByReBlock | null) ?? null,
    extraByReList: extra,
    primaryLabel: a.name,
    compareLabel: b.name,
    signature: [
      rest.map((x) => x.name).join('-'),
      (pol12.alphas as number[] | undefined)?.join?.(',') ?? '',
    ].join('|'),
  }
}
