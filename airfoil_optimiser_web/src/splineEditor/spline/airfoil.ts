/**
 * Airfoil model.
 *
 * Topology: two independent clamped cubic B-splines, one for the upper
 * surface and one for the lower. They share a fixed leading-edge control
 * point at (0, 0) and each has its own trailing-edge point at x = 1,
 * stacked vertically with a small configurable gap.
 *
 * Control-point layout per surface (indices):
 *
 *   0               LE  (0, 0)              FIXED both axes
 *   1               nose radius handle      x = 0, y FREE (vertical only)
 *   2 .. len - 2    interior body CPs       both axes FREE
 *   len - 1         TE (1, +/- gap/2)       FIXED both axes
 *
 * Pinning CP 1 to x = 0 forces the first polygon leg to be vertical, so
 * the B-spline has a vertical tangent at the LE. That is what produces a
 * smooth rounded nose; dragging the nose handle up/down directly controls
 * the leading-edge radius.
 *
 * The initial NACA 0012 shape is produced by a least-squares fit of the
 * spline to samples of the analytic NACA 0012 thickness distribution,
 * respecting the fixed-point constraints. Just placing CPs on NACA points
 * does not work - the B-spline is approximating, not interpolating, and
 * the result is noticeably thinner than a real NACA 0012.
 */

import type { Vec2 } from "./bspline";
import { sampleCosine, sampleUniform } from "./bspline";
import { fitBSpline } from "./fit";

export const DEGREE = 3;
/**
 * Knot vector is uniform (stretch = 1). We considered clustering knots
 * toward the LE, but the sqrt(x) parameterisation used in the initial
 * NACA 0012 fit already gives dense effective resolution near the nose,
 * so uniform knots are sufficient and simpler. Changing this to < 1
 * would cluster interior knots toward t = 0 if the fit ever needed more
 * LE resolution on a very low CP count.
 */
export const KNOT_STRETCH = 1;

export type Surface = "upper" | "lower";
export type ConstraintKind = "fixed" | "verticalOnly" | "free";

export interface Airfoil {
  name: string;
  /** Gap at trailing edge, as a fraction of chord. */
  teGap: number;
  upper: Vec2[];
  lower: Vec2[];
}

/** Return the constraint class for a given control-point index. */
export function constraintFor(
  _surface: Surface,
  index: number,
  surfaceLen: number,
): ConstraintKind {
  if (index === 0 || index === surfaceLen - 1) return "fixed";
  if (index === 1) return "verticalOnly";
  return "free";
}

export function isFixedIndex(surface: Surface, index: number, len: number): boolean {
  return constraintFor(surface, index, len) === "fixed";
}

/**
 * NACA 4-digit symmetric thickness distribution, closed-TE variant
 * (coefficient -0.1036, so y(1) = 0 exactly). `t` is maximum thickness
 * as a fraction of chord; 0.12 for NACA 0012.
 */
export function nacaThickness(x: number, t: number): number {
  if (x <= 0) return 0;
  return (
    5 *
    t *
    (0.2969 * Math.sqrt(x) -
      0.126 * x -
      0.3516 * x * x +
      0.2843 * x * x * x -
      0.1036 * x * x * x * x)
  );
}

/**
 * Analytic NACA 0012 reference surfaces, sampled with cosine distribution.
 * Used for the "overlay reference" toggle and for the live max-deviation
 * readout so the fit quality is falsifiable, not vibes.
 */
export function nacaReference(
  thickness: number = 0.12,
  nPerSurface: number = 200,
): SampledAirfoil {
  const upper: Vec2[] = new Array(nPerSurface);
  const lower: Vec2[] = new Array(nPerSurface);
  for (let i = 0; i < nPerSurface; i++) {
    const beta = (i * Math.PI) / (nPerSurface - 1);
    const x = 0.5 * (1 - Math.cos(beta));
    const y = nacaThickness(x, thickness);
    upper[i] = { x, y };
    lower[i] = { x, y: -y };
  }
  return { upper, lower };
}

/** Cubic TE-gap ramp: no distortion away from TE, smooth blend in. */
function teGapRamp(x: number): number {
  return x * x * x;
}

/**
 * Build target samples of NACA 0012 for one surface, then least-squares
 * fit control points to them with the LE / nose / TE constraints applied.
 */
function fitNacaSurface(
  isUpper: boolean,
  teGap: number,
  nInterior: number,
  thickness: number,
): Vec2[] {
  // CPs per surface: LE + nose + nInterior + TE
  const nCP = nInterior + 3;
  const sign = isUpper ? 1 : -1;

  // Sample NACA 0012 uniformly in t = sqrt(x). This gives dense samples
  // near the LE, which is what the spline needs to reproduce the nose
  // radius. The TE gap is added with a cubic ramp so the deviation
  // from true NACA is concentrated in the last ~20% of chord and the
  // mid-chord shape is unaffected even at large gaps.
  const M = 120;
  const targets: Vec2[] = new Array(M);
  const params: number[] = new Array(M);
  const halfGap = (sign * teGap) / 2;
  for (let j = 0; j < M; j++) {
    const t = j / (M - 1);
    const x = t * t;
    const y = sign * nacaThickness(x, thickness) + halfGap * teGapRamp(x);
    targets[j] = { x, y };
    params[j] = t;
  }
  targets[0] = { x: 0, y: 0 };
  targets[M - 1] = { x: 1, y: halfGap };

  const teY = (sign * teGap) / 2;
  const fixedX: Record<number, number> = { 0: 0, 1: 0, [nCP - 1]: 1 };
  const fixedY: Record<number, number> = { 0: 0, [nCP - 1]: teY };

  return fitBSpline(targets, params, {
    nCP,
    degree: DEGREE,
    fixedX,
    fixedY,
    knotStretch: KNOT_STRETCH,
  });
}

export interface BuildOptions {
  nInterior?: number;
  teGap?: number;
  thickness?: number;
  name?: string;
}

export function buildNaca0012(opts: BuildOptions = {}): Airfoil {
  const nInterior = opts.nInterior ?? 5;
  const teGap = opts.teGap ?? 0.0025;
  const thickness = opts.thickness ?? 0.12;
  const name = opts.name ?? "NACA 0012";

  const upper = fitNacaSurface(true, teGap, nInterior, thickness);
  const lower = fitNacaSurface(false, teGap, nInterior, thickness);

  return { name, teGap, upper, lower };
}

/**
 * Point on a polyline with increasing x(σ) (LE → TE) at a target chordwise x in [0,1].
 * Matches how `fitNacaSurface` builds (x, y) targets before the B-spline LSQ.
 */
function interpolateByChordwiseX(poly: Vec2[], xq: number): Vec2 {
  const n = poly.length;
  if (n < 2) {
    if (n === 1) return { x: xq, y: poly[0]!.y };
    return { x: 0, y: 0 };
  }
  const a0 = poly[0]!;
  const a1 = poly[n - 1]!;
  if (xq <= a0.x) {
    if (a1.x - a0.x < 1e-12) return { x: xq, y: a0.y };
    return { x: xq, y: a0.y + ((xq - a0.x) / (a1.x - a0.x)) * (a1.y - a0.y) };
  }
  if (xq >= a1.x) {
    return { x: xq, y: a1.y };
  }
  for (let i = 0; i < n - 1; i += 1) {
    const a = poly[i]!;
    const b = poly[i + 1]!;
    if (a.x - 1e-9 <= xq && xq <= b.x + 1e-9) {
      const d = b.x - a.x;
      if (Math.abs(d) < 1e-12) {
        return { x: a.x, y: (a.y + b.y) * 0.5 };
      }
      const s = (xq - a.x) / d;
      return { x: xq, y: a.y * (1 - s) + b.y * s };
    }
  }
  // Fallback: x not strictly monotone — walk segments by closest span
  let best = a0;
  for (const p of poly) {
    if (Math.abs(p.x - xq) < Math.abs(best.x - xq)) best = p;
  }
  return { x: xq, y: best.y };
}

/**
 * Same *regression setup* as `fitNacaSurface`: M targets, uniform parameter
 * t ∈ [0,1] with x = t² and y read off the *polyline*; LE (0,0) and measured TE
 * (1, yTe) pinned. `teY` is the actual y at x=1 on the file (camber, not
 * forced ±(teGap/2) about 0, which was skewing imported shapes).
 */
function fitOneSurfaceByNacaParamStrip(
  polyLeToTe: Vec2[],
  nInterior: number,
  yTe: number,
  mSamples: number = 120,
): Vec2[] {
  if (polyLeToTe.length < 3) {
    throw new Error("Too few points on one airfoil surface to fit.");
  }
  const nCP = nInterior + 3;
  const M = Math.max(24, Math.min(180, mSamples | 0));
  const targets: Vec2[] = new Array(M);
  const params: number[] = new Array(M);
  for (let j = 0; j < M; j += 1) {
    const t = M === 1 ? 0 : j / (M - 1);
    if (j === 0) {
      targets[0] = { x: 0, y: 0 };
      params[0] = 0;
    } else if (j === M - 1) {
      targets[j] = { x: 1, y: yTe };
      params[j] = 1;
    } else {
      const x = t * t;
      const p = interpolateByChordwiseX(polyLeToTe, x);
      targets[j] = { x, y: p.y };
      params[j] = t;
    }
  }
  return fitBSpline(targets, params, {
    nCP,
    degree: DEGREE,
    fixedX: { 0: 0, 1: 0, [nCP - 1]: 1 },
    fixedY: { 0: 0, [nCP - 1]: yTe },
    knotStretch: KNOT_STRETCH,
  });
}

export type SeligImportOptions = {
  name?: string;
  nInterior?: number;
  /**
   * Count of LSQ targets per surface, same M as in `fitNacaSurface` (airfoil_analyser: M=120).
   * T uses uniform t, x = t², y = polyline (for camber, TE y is the file y, not ±(teGap/2)).
   */
  samplesPerSurface?: number;
};

/**
 * B-spline fit to Selig .dat (TE→LE upper, LE→TE lower). Fitting matches `fitNacaSurface`
 * in airfoil_analyser (M samples, t → x = t²) with y on the *parsed* polyline; `withFixedPoints`
 * is not applied, so the TE is not re-snapped to symmetric ±(teGap/2) (that had skewed cambered foils).
 */
export function buildAirfoilFromSeligPoints(
  rawPoints: number[][],
  opts: SeligImportOptions = {},
): Airfoil {
  const nInterior = opts.nInterior ?? 5;
  const M = Math.max(40, Math.min(180, opts.samplesPerSurface ?? 120));
  if (!rawPoints || rawPoints.length < 8) {
    throw new Error("Not enough coordinate pairs (expected a Selig-style .dat).");
  }
  const pts: Vec2[] = rawPoints.map((r) => {
    if (r.length < 2 || !Number.isFinite(r[0]!) || !Number.isFinite(r[1]!)) {
      throw new Error("Invalid x/y in coordinate list.");
    }
    return { x: r[0]!, y: r[1]! };
  });
  let iLe = 0;
  for (let i = 1; i < pts.length; i += 1) {
    if (pts[i]!.x < pts[iLe]!.x) {
      iLe = i;
    }
  }
  if (iLe < 1 || iLe > pts.length - 2) {
    throw new Error("Could not locate the leading edge (need points from both surfaces).");
  }
  const upFromTeToLe = pts.slice(0, iLe + 1);
  const lowerFromLe = pts.slice(iLe);
  const upperTgt: Vec2[] = upFromTeToLe.map((p) => ({ x: p.x, y: p.y })).reverse();
  const lowerTgt: Vec2[] = lowerFromLe.map((p) => ({ x: p.x, y: p.y }));
  if (upperTgt.length < 3 || lowerTgt.length < 3) {
    throw new Error("Not enough points on the upper or lower side after split.");
  }
  const yTeU = upFromTeToLe[0]!.y;
  const yTeL = pts[pts.length - 1]!.y;
  let teGap = yTeU - yTeL;
  if (!Number.isFinite(teGap) || teGap < 0) {
    teGap = 0.0025;
  } else if (teGap < 1e-8) {
    teGap = 0.0025;
  }
  const name = (opts.name && opts.name.trim()) || "uploaded";
  return {
    name,
    teGap,
    upper: fitOneSurfaceByNacaParamStrip(upperTgt, nInterior, yTeU, M),
    lower: fitOneSurfaceByNacaParamStrip(lowerTgt, nInterior, yTeL, M),
  };
}

/** Re-apply fixed constraints (useful after a TE-gap change). */
export function withFixedPoints(airfoil: Airfoil): Airfoil {
  const fix = (arr: Vec2[], isUpper: boolean): Vec2[] => {
    const teY = (isUpper ? 1 : -1) * (airfoil.teGap / 2);
    const next = arr.slice();
    next[0] = { x: 0, y: 0 };
    // Nose handle: keep x locked to 0 but preserve current y.
    if (next.length >= 2) {
      next[1] = { x: 0, y: next[1].y };
    }
    next[next.length - 1] = { x: 1, y: teY };
    return next;
  };
  return {
    ...airfoil,
    upper: fix(airfoil.upper, true),
    lower: fix(airfoil.lower, false),
  };
}

/** Move a control point, honouring its constraint class. */
export function moveControlPoint(
  airfoil: Airfoil,
  surface: Surface,
  index: number,
  newPos: Vec2,
): Airfoil {
  const arr = airfoil[surface];
  const kind = constraintFor(surface, index, arr.length);
  if (kind === "fixed") return airfoil;

  const next = arr.slice();
  if (kind === "verticalOnly") {
    // x locked to 0, y constrained to stay on correct side of the LE.
    const minMag = 1e-4;
    let y = newPos.y;
    if (surface === "upper") y = Math.max(minMag, y);
    else y = Math.min(-minMag, y);
    next[index] = { x: 0, y };
  } else {
    const x = Math.max(1e-4, Math.min(0.9999, newPos.x));
    next[index] = { x, y: newPos.y };
  }
  return { ...airfoil, [surface]: next };
}

/** Insert a new free CP between two existing interior CPs. */
export function addControlPoint(airfoil: Airfoil, surface: Surface, atIndex: number): Airfoil {
  const arr = airfoil[surface];
  // Only allow inserting *after* the nose handle (index 1) and before the TE.
  const i = Math.max(2, Math.min(arr.length - 1, atIndex));
  const a = arr[i - 1];
  const b = arr[i];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const next = [...arr.slice(0, i), mid, ...arr.slice(i)];
  return { ...airfoil, [surface]: next };
}

export function removeControlPoint(airfoil: Airfoil, surface: Surface, index: number): Airfoil {
  const arr = airfoil[surface];
  if (constraintFor(surface, index, arr.length) !== "free") return airfoil;
  // Minimum CPs to keep a valid cubic with nose handle + at least one interior: 5.
  if (arr.length <= DEGREE + 2) return airfoil;
  return { ...airfoil, [surface]: [...arr.slice(0, index), ...arr.slice(index + 1)] };
}

export interface SampledAirfoil {
  upper: Vec2[];
  lower: Vec2[];
}

export function sampleAirfoil(
  airfoil: Airfoil,
  nPerSurface: number,
  spacing: "cosine" | "uniform" = "cosine",
): SampledAirfoil {
  const sampler = spacing === "cosine" ? sampleCosine : sampleUniform;
  return {
    upper: sampler(airfoil.upper, DEGREE, nPerSurface, KNOT_STRETCH),
    lower: sampler(airfoil.lower, DEGREE, nPerSurface, KNOT_STRETCH),
  };
}

/**
 * Maximum |spline_y - naca_y| over both surfaces, as a fraction of chord.
 * Gives a single number you can watch in the UI to confirm the rendered
 * shape matches the analytic NACA 0012.
 */
export function maxDeviationFromNaca(
  sampled: SampledAirfoil,
  thickness: number = 0.12,
): number {
  let worst = 0;
  for (const p of sampled.upper) {
    const err = Math.abs(p.y - nacaThickness(p.x, thickness));
    if (err > worst) worst = err;
  }
  for (const p of sampled.lower) {
    const err = Math.abs(p.y + nacaThickness(p.x, thickness));
    if (err > worst) worst = err;
  }
  return worst;
}
