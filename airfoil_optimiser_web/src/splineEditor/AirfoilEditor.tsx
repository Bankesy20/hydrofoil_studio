/**
 * Interactive SVG airfoil editor (from airfoil_analyser).
 * See airfoil_analyser for full documentation.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import type {
  PointerEvent as ReactPointerEvent,
  ReactElement,
  WheelEvent as ReactWheelEvent,
} from 'react'
import type { Airfoil, ConstraintKind, Surface } from './spline/airfoil'
import {
  addControlPoint,
  constraintFor,
  moveControlPoint,
  nacaReference,
  removeControlPoint,
  sampleAirfoil,
} from './spline/airfoil'

/** Other foils in the list: rendered behind the active spline (read-only, no handles). */
export type PeerVisual = {
  key: string
  name: string
  colorUpper: string
  colorLower: string
}

export interface AirfoilEditorProps {
  airfoil: Airfoil
  onChange: (next: Airfoil) => void
  zoom: number
  onZoomChange: (z: number) => void
  showReference: boolean
  previewSamples?: number
  /** Sampled (uniform) world-space curves; typically other foils in the list that are `visible` but not `active` */
  peerOverlays?: { meta: PeerVisual; upper: { x: number; y: number }[]; lower: { x: number; y: number }[] }[]
}

const PADDING = { left: 40, right: 40, top: 40, bottom: 40 }
const DEFAULT_WORLD_WIDTH = 1.1
const ZOOM_MIN = 0.5
const ZOOM_MAX = 40

type Interaction =
  | { kind: 'idle' }
  | { kind: 'drag-cp'; surface: Surface; index: number }
  | {
      kind: 'pan'
      startScreenX: number
      startScreenY: number
      startCenterX: number
      startCenterY: number
    }

export function AirfoilEditor({
  airfoil,
  onChange,
  zoom,
  onZoomChange,
  showReference,
  previewSamples = 240,
  peerOverlays = [],
}: AirfoilEditorProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [interaction, setInteraction] = useState<Interaction>({ kind: 'idle' })
  const [size, setSize] = useState({ w: 1000, h: 400 })
  const [center, setCenter] = useState({ x: 0.5, y: 0 })

  const setSvgRef = useCallback((el: SVGSVGElement | null) => {
    svgRef.current = el
    if (!el) return
    const rect = el.getBoundingClientRect()
    setSize({ w: rect.width, h: rect.height })
    const obs = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setSize({ w: r.width, h: r.height })
    })
    obs.observe(el)
  }, [])

  const plotW = Math.max(1, size.w - PADDING.left - PADDING.right)
  const plotH = Math.max(1, size.h - PADDING.top - PADDING.bottom)
  const plotCenterX = PADDING.left + plotW / 2
  const plotCenterY = PADDING.top + plotH / 2

  const baseScaleX = plotW / DEFAULT_WORLD_WIDTH
  const basePixelsPerUnit = Math.min(baseScaleX, plotH / 0.5)
  const pixelsPerUnit = basePixelsPerUnit * zoom

  const toScreenX = useCallback(
    (x: number) => plotCenterX + (x - center.x) * pixelsPerUnit,
    [plotCenterX, center.x, pixelsPerUnit],
  )
  const toScreenY = useCallback(
    (y: number) => plotCenterY - (y - center.y) * pixelsPerUnit,
    [plotCenterY, center.y, pixelsPerUnit],
  )
  const fromScreenX = useCallback(
    (px: number) => (px - plotCenterX) / pixelsPerUnit + center.x,
    [plotCenterX, center.x, pixelsPerUnit],
  )
  const fromScreenY = useCallback(
    (py: number) => -(py - plotCenterY) / pixelsPerUnit + center.y,
    [plotCenterY, center.y, pixelsPerUnit],
  )

  const sampled = useMemo(
    () => sampleAirfoil(airfoil, previewSamples, 'uniform'),
    [airfoil, previewSamples],
  )

  const reference = useMemo(() => nacaReference(0.12, 200), [])

  const upperPath = useMemo(
    () => pathFrom(sampled.upper, toScreenX, toScreenY),
    [sampled, toScreenX, toScreenY],
  )
  const lowerPath = useMemo(
    () => pathFrom(sampled.lower, toScreenX, toScreenY),
    [sampled, toScreenX, toScreenY],
  )
  const upperPoly = useMemo(
    () => pathFrom(airfoil.upper, toScreenX, toScreenY),
    [airfoil, toScreenX, toScreenY],
  )
  const lowerPoly = useMemo(
    () => pathFrom(airfoil.lower, toScreenX, toScreenY),
    [airfoil, toScreenX, toScreenY],
  )
  const refUpperPath = useMemo(
    () => (showReference ? pathFrom(reference.upper, toScreenX, toScreenY) : ''),
    [reference, showReference, toScreenX, toScreenY],
  )
  const refLowerPath = useMemo(
    () => (showReference ? pathFrom(reference.lower, toScreenX, toScreenY) : ''),
    [reference, showReference, toScreenX, toScreenY],
  )

  const peerPathPairs = useMemo(
    () =>
      peerOverlays.map((o) => ({
        key: o.meta.key,
        name: o.meta.name,
        upper: pathFrom(o.upper, toScreenX, toScreenY),
        lower: pathFrom(o.lower, toScreenX, toScreenY),
        cU: o.meta.colorUpper,
        cL: o.meta.colorLower,
      })),
    [peerOverlays, toScreenX, toScreenY],
  )

  const onHandlePointerDown =
    (surface: Surface, index: number) => (ev: ReactPointerEvent<SVGCircleElement>) => {
      const kind = constraintFor(surface, index, airfoil[surface].length)
      if (kind === 'fixed') return
      if (ev.shiftKey && kind === 'free') {
        onChange(removeControlPoint(airfoil, surface, index))
        return
      }
      ev.stopPropagation()
      svgRef.current?.setPointerCapture(ev.pointerId)
      setInteraction({ kind: 'drag-cp', surface, index })
    }

  const onSvgPointerDown = (ev: ReactPointerEvent<SVGSVGElement>) => {
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const px = ev.clientX - rect.left
    const py = ev.clientY - rect.top
    svgRef.current.setPointerCapture(ev.pointerId)
    setInteraction({
      kind: 'pan',
      startScreenX: px,
      startScreenY: py,
      startCenterX: center.x,
      startCenterY: center.y,
    })
  }

  const onPointerMove = (ev: ReactPointerEvent<SVGSVGElement>) => {
    if (interaction.kind === 'idle' || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const px = ev.clientX - rect.left
    const py = ev.clientY - rect.top

    if (interaction.kind === 'drag-cp') {
      const x = fromScreenX(px)
      const y = fromScreenY(py)
      onChange(moveControlPoint(airfoil, interaction.surface, interaction.index, { x, y }))
    } else if (interaction.kind === 'pan') {
      const dxPx = px - interaction.startScreenX
      const dyPx = py - interaction.startScreenY
      setCenter({
        x: interaction.startCenterX - dxPx / pixelsPerUnit,
        y: interaction.startCenterY + dyPx / pixelsPerUnit,
      })
    }
  }

  const endInteraction = (ev: ReactPointerEvent<SVGSVGElement>) => {
    if (interaction.kind === 'idle') return
    try {
      svgRef.current?.releasePointerCapture?.(ev.pointerId)
    } catch {
      /* ignore */
    }
    setInteraction({ kind: 'idle' })
  }

  const onWheel = (ev: ReactWheelEvent<SVGSVGElement>) => {
    if (!svgRef.current) return
    ev.preventDefault()
    const rect = svgRef.current.getBoundingClientRect()
    const px = ev.clientX - rect.left
    const py = ev.clientY - rect.top
    const worldXBefore = fromScreenX(px)
    const worldYBefore = fromScreenY(py)

    const factor = Math.exp(-ev.deltaY * 0.0015)
    const newZoom = clamp(zoom * factor, ZOOM_MIN, ZOOM_MAX)

    const newPixelsPerUnit = basePixelsPerUnit * newZoom
    const newCenterX = worldXBefore - (px - plotCenterX) / newPixelsPerUnit
    const newCenterY = worldYBefore + (py - plotCenterY) / newPixelsPerUnit

    onZoomChange(newZoom)
    setCenter({ x: newCenterX, y: newCenterY })
  }

  const onSegmentPointerDown = (ev: ReactPointerEvent<SVGLineElement>) => {
    ev.stopPropagation()
  }

  const onSegmentDoubleClick = (surface: Surface, segmentIndex: number) => () => {
    onChange(addControlPoint(airfoil, surface, segmentIndex + 1))
  }

  const panningCursor = interaction.kind === 'pan' ? 'grabbing' : 'grab'

  return (
    <svg
      ref={setSvgRef}
      className="spline-editor-svg"
      style={{ cursor: panningCursor }}
      onPointerDown={onSvgPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endInteraction}
      onPointerCancel={endInteraction}
      onWheel={onWheel}
    >
      <line
        x1={0}
        y1={toScreenY(0)}
        x2={size.w}
        y2={toScreenY(0)}
        stroke="#2a2a2a"
        strokeDasharray="4 4"
      />
      <line x1={toScreenX(0)} y1={0} x2={toScreenX(0)} y2={size.h} stroke="#2a2a2a" />
      <line
        x1={toScreenX(1)}
        y1={0}
        x2={toScreenX(1)}
        y2={size.h}
        stroke="#2a2a2a"
        strokeDasharray="4 4"
      />
      <text x={toScreenX(0) + 4} y={size.h - 12} fill="#888" fontSize="11">
        x = 0
      </text>
      <text x={toScreenX(1) + 4} y={size.h - 12} fill="#888" fontSize="11">
        x = 1
      </text>

      {showReference && (
        <>
          <path
            d={refUpperPath}
            stroke="#ffd166"
            strokeWidth={1.5}
            fill="none"
            strokeDasharray="6 4"
            opacity={0.75}
          />
          <path
            d={refLowerPath}
            stroke="#ffd166"
            strokeWidth={1.5}
            fill="none"
            strokeDasharray="6 4"
            opacity={0.75}
          />
        </>
      )}

      {peerPathPairs.map((p) => (
        <g key={p.key} opacity={0.85}>
          <title>{p.name}</title>
          <path d={p.upper} stroke={p.cU} strokeWidth={1.4} fill="none" />
          <path d={p.lower} stroke={p.cL} strokeWidth={1.4} fill="none" />
        </g>
      ))}

      <path
        d={upperPoly}
        stroke="#6a82ff"
        strokeWidth={1}
        fill="none"
        strokeDasharray="3 4"
        opacity={0.3}
      />
      <path
        d={lowerPoly}
        stroke="#ff7a7a"
        strokeWidth={1}
        fill="none"
        strokeDasharray="3 4"
        opacity={0.3}
      />

      <path d={upperPath} stroke="#3b6dff" strokeWidth={2} fill="none" />
      <path d={lowerPath} stroke="#ff4747" strokeWidth={2} fill="none" />

      {renderSegmentHitTargets(
        'upper',
        airfoil.upper,
        toScreenX,
        toScreenY,
        onSegmentPointerDown,
        onSegmentDoubleClick,
      )}
      {renderSegmentHitTargets(
        'lower',
        airfoil.lower,
        toScreenX,
        toScreenY,
        onSegmentPointerDown,
        onSegmentDoubleClick,
      )}

      {airfoil.upper.length >= 2 && airfoil.lower.length >= 2 && (
        <line
          x1={toScreenX(0)}
          y1={toScreenY(airfoil.upper[1].y)}
          x2={toScreenX(0)}
          y2={toScreenY(airfoil.lower[1].y)}
          stroke="#3dd6b5"
          strokeWidth={1}
          strokeDasharray="2 3"
          opacity={0.6}
        />
      )}

      {airfoil.upper.map((p, i) => (
        <Handle
          key={`u-${i}`}
          cx={toScreenX(p.x)}
          cy={toScreenY(p.y)}
          surface="upper"
          kind={constraintFor('upper', i, airfoil.upper.length)}
          onPointerDown={onHandlePointerDown('upper', i)}
        />
      ))}
      {airfoil.lower.map((p, i) => (
        <Handle
          key={`l-${i}`}
          cx={toScreenX(p.x)}
          cy={toScreenY(p.y)}
          surface="lower"
          kind={constraintFor('lower', i, airfoil.lower.length)}
          onPointerDown={onHandlePointerDown('lower', i)}
        />
      ))}
    </svg>
  )
}

interface HandleProps {
  cx: number
  cy: number
  surface: Surface
  kind: ConstraintKind
  onPointerDown: (ev: ReactPointerEvent<SVGCircleElement>) => void
}

function Handle({ cx, cy, surface, kind, onPointerDown }: HandleProps) {
  const surfaceColor = surface === 'upper' ? '#3b6dff' : '#ff4747'
  let color: string
  let fill: string
  let r: number
  let cursor: string
  switch (kind) {
    case 'fixed':
      color = '#bbb'
      fill = '#fff'
      r = 5
      cursor = 'not-allowed'
      break
    case 'verticalOnly':
      color = '#3dd6b5'
      fill = '#3dd6b5'
      r = 6
      cursor = 'ns-resize'
      break
    default:
      color = surfaceColor
      fill = surfaceColor
      r = 6
      cursor = 'grab'
      break
  }
  return (
    <circle
      cx={cx}
      cy={cy}
      r={r}
      fill={fill}
      stroke={color}
      strokeWidth={kind === 'fixed' ? 2 : 1.5}
      style={{ cursor }}
      onPointerDown={onPointerDown}
    />
  )
}

function pathFrom(
  points: { x: number; y: number }[],
  sx: (x: number) => number,
  sy: (y: number) => number,
): string {
  if (points.length === 0) return ''
  const parts: string[] = [`M ${sx(points[0].x).toFixed(2)} ${sy(points[0].y).toFixed(2)}`]
  for (let i = 1; i < points.length; i++) {
    parts.push(`L ${sx(points[i].x).toFixed(2)} ${sy(points[i].y).toFixed(2)}`)
  }
  return parts.join(' ')
}

function renderSegmentHitTargets(
  surface: Surface,
  pts: { x: number; y: number }[],
  sx: (x: number) => number,
  sy: (y: number) => number,
  onPointerDown: (ev: ReactPointerEvent<SVGLineElement>) => void,
  onDoubleClick: (surface: Surface, segmentIndex: number) => () => void,
) {
  const out: ReactElement[] = []
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    out.push(
      <line
        key={`${surface}-seg-${i}`}
        x1={sx(a.x)}
        y1={sy(a.y)}
        x2={sx(b.x)}
        y2={sy(b.y)}
        stroke="transparent"
        strokeWidth={10}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick(surface, i)}
        style={{ cursor: 'copy' }}
      />,
    )
  }
  return out
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
