/**
 * Visual language aligned with `airfoil_analyser` (gold baseline, blue edited).
 * @see airfoil_analyser/src/components/PolarPlots.tsx
 */
import type { Config, Layout, PlotData } from 'plotly.js'

/** Toolbar only on hover so it does not cover in-plot legends. */
export const plotlyConfigHoverTools: Partial<Config> = {
  displayModeBar: 'hover',
  responsive: true,
}

export const plotlyConfigNoTools: Partial<Config> = {
  displayModeBar: false,
  responsive: true,
}

export const studio = {
  bgPlot: '#0b0d13',
  border: '#22262e',
  grid: '#2a2f3a',
  text: '#e6e6e6',
  textMuted: '#9aa0ad',
  baseline: '#ffd166',
  edited: '#3b6dff',
  accent2: '#5cadff',
} as const

const font = {
  color: studio.text,
  family: "ui-sans-serif, system-ui, 'Segoe UI', Roboto, sans-serif",
  size: 12,
}

const axisCommon = {
  gridcolor: studio.grid,
  zeroline: true,
  zerolinecolor: studio.grid,
  zerolinewidth: 1,
  linecolor: studio.border,
  tickfont: { color: studio.textMuted, size: 11 },
}

/**
 * Space between x tick labels and axis title. Keep moderate: large standoff + large
 * margin.b inside a short Plotly `height` shrinks the plot data area to a thin strip.
 */
const X_TITLE_STANDOFF = 22

function mergeXAxis(xa?: Partial<Layout['xaxis']>): Partial<Layout['xaxis']> {
  /* No automargin: in fixed-height divs it stacks with margin.b and crushes the plot. */
  const out: Record<string, unknown> = { ...axisCommon, ...(xa || {}) }
  const title = out.title
  if (title && typeof title === 'object' && title !== null && !Array.isArray(title)) {
    out.title = { standoff: X_TITLE_STANDOFF, ...(title as Record<string, unknown>) }
  }
  return out as Partial<Layout['xaxis']>
}

function mergeYAxis(ya?: Partial<Layout['yaxis']>): Partial<Layout['yaxis']> {
  const out: Record<string, unknown> = { ...axisCommon, ...(ya || {}) }
  const title = out.title
  if (title && typeof title === 'object' && title !== null && !Array.isArray(title)) {
    out.title = { standoff: 12, ...(title as Record<string, unknown>) }
  }
  return out as Partial<Layout['yaxis']>
}

/**
 * Default dark chart frame. Legend is **inside the plot** (container coordinates)
 * so it never fights the x-axis title; use smaller bottom margin.
 */
export function chartLayout(extra: Partial<Layout> = {}): Partial<Layout> {
  const { xaxis: xa, yaxis: ya, legend: leg, margin: mg, ...rest } = extra
  return {
    paper_bgcolor: studio.bgPlot,
    plot_bgcolor: studio.bgPlot,
    font,
    margin: { t: 28, r: 22, b: 64, l: 56, ...(mg || {}) },
    xaxis: mergeXAxis(xa),
    yaxis: mergeYAxis(ya),
    /* Top-center: keeps Plotly’s top-right modebar zone clear when it appears on hover */
    legend: {
      orientation: 'h' as const,
      xref: 'container',
      yref: 'container',
      x: 0.5,
      y: 0.98,
      xanchor: 'center' as const,
      yanchor: 'top' as const,
      bgcolor: 'rgba(11, 13, 19, 0.88)',
      bordercolor: studio.border,
      borderwidth: 1,
      font: { color: studio.textMuted, size: 9 },
      tracegroupgap: 10,
      ...(leg || {}),
    },
    ...rest,
  }
}

/**
 * Drag polars: when CD is on an axis, force that axis range to include 0 so the
 * origin is visible even when all CD values are small (e.g. 0.009–0.015).
 */
export function cdAxisRangemodeFragment(xKey: string, yKey: string): {
  xaxis?: { rangemode: 'tozero' }
  yaxis?: { rangemode: 'tozero' }
} {
  return {
    ...(xKey === 'CD' ? { xaxis: { rangemode: 'tozero' as const } } : {}),
    ...(yKey === 'CD' ? { yaxis: { rangemode: 'tozero' as const } } : {}),
  }
}

const CP_SURFACE_KEYS = new Set(['cp_upper', 'cp_lower'])

/** Matches `polarFlexPlot` axis ids for chordwise station grids */
function isChordwiseGridKey(k: string): boolean {
  return k === 'x_cp' || k === 'x_dcp_mid'
}

/**
 * Classic Cp presentation: suction (negative Cp) toward the top of the plot,
 * and a clear x/c = 0 (LE) line when chordwise distance is on an axis.
 */
export function cpAeroConventionFragment(xKey: string, yKey: string): {
  xaxis?: Partial<Layout['xaxis']>
  yaxis?: Partial<Layout['yaxis']>
} {
  const xCp = CP_SURFACE_KEYS.has(xKey)
  const yCp = CP_SURFACE_KEYS.has(yKey)
  const xChord = isChordwiseGridKey(xKey)
  const yChord = isChordwiseGridKey(yKey)

  const refLine = {
    zeroline: true,
    zerolinecolor: '#dde1ea',
    zerolinewidth: 1.5,
  } as const

  const cpAxis = {
    autorange: 'reversed' as const,
    ...refLine,
  }

  const xaxis: Partial<Layout['xaxis']> = {}
  const yaxis: Partial<Layout['yaxis']> = {}

  if (xCp) Object.assign(xaxis, cpAxis)
  if (yCp) Object.assign(yaxis, cpAxis)
  if (xChord && !xCp) Object.assign(xaxis, refLine)
  if (yChord && !yCp) Object.assign(yaxis, refLine)

  const out: { xaxis?: Partial<Layout['xaxis']>; yaxis?: Partial<Layout['yaxis']> } = {}
  if (Object.keys(xaxis).length) out.xaxis = xaxis
  if (Object.keys(yaxis).length) out.yaxis = yaxis
  return out
}

export function airfoilGeometryLayout(): Partial<Layout> {
  return chartLayout({
    xaxis: {
      ...axisCommon,
      title: { text: 'x/c', font: { size: 12, color: studio.textMuted } },
      scaleanchor: 'y',
      scaleratio: 1,
      constrain: 'domain',
    },
    yaxis: {
      ...axisCommon,
      title: { text: 'y/c', font: { size: 12, color: studio.textMuted } },
    },
  })
}

type ScatterLineStyle = Pick<PlotData, 'type' | 'mode' | 'line'>

export const traceSeedAirfoil: ScatterLineStyle = {
  type: 'scatter',
  mode: 'lines',
  line: { color: studio.baseline, width: 2.2 },
}

export const traceCompareAirfoil: ScatterLineStyle = {
  type: 'scatter',
  mode: 'lines',
  line: { color: studio.edited, width: 1.55 },
}

export const traceSeedLine: ScatterLineStyle = {
  type: 'scatter',
  mode: 'lines',
  line: { color: studio.baseline, width: 2 },
}

export const traceOptLine: ScatterLineStyle = {
  type: 'scatter',
  mode: 'lines',
  line: { color: studio.edited, width: 1.65 },
}
