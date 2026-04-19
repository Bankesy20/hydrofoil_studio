/**
 * Least-squares fit of a clamped B-spline's control points to a set of
 * target (x, y) samples, with per-coordinate "fixed value" constraints on
 * individual control points.
 *
 * The x and y coordinates are fit independently, which lets us impose
 * different constraints on each (e.g. "CP 1's x is pinned to 0 but its y
 * is free" for the LE-radius handle).
 *
 * Small dense normal equations are solved with Gauss elimination + partial
 * pivoting. Systems here are at most ~10x10 so we don't need anything
 * fancier.
 */

import type { Vec2 } from "./bspline";
import { basisFunctions, clampedKnots } from "./bspline";

function solveLinear(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M: number[][] = A.map((row, i) => [...row, b[i]]);

  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > Math.abs(M[pivot][i])) pivot = k;
    }
    [M[i], M[pivot]] = [M[pivot], M[i]];
    const piv = M[i][i];
    if (Math.abs(piv) < 1e-14) throw new Error("singular system in B-spline fit");
    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / piv;
      for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
    }
  }

  const x = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

export interface FitConstraints {
  /** Number of control points. */
  nCP: number;
  /** Spline degree. */
  degree: number;
  /** Map of control-point index -> fixed x value. Others are fit. */
  fixedX: Record<number, number>;
  /** Map of control-point index -> fixed y value. Others are fit. */
  fixedY: Record<number, number>;
  /**
   * Interior knots raised to this power. 1 = uniform (default).
   * Use < 1 to cluster knots near t = 0 (e.g. leading edge of an airfoil).
   */
  knotStretch?: number;
  /** Per-sample weights for the LSQ residuals (defaults to all 1). */
  weights?: number[];
}

/**
 * Fit control points so that the B-spline evaluated at `params[j]`
 * approximates `targets[j]` in least-squares sense, honouring the fixed
 * constraints.
 */
export function fitBSpline(
  targets: Vec2[],
  params: number[],
  c: FitConstraints,
): Vec2[] {
  const { nCP, degree, fixedX, fixedY, knotStretch = 1, weights } = c;
  if (targets.length !== params.length) {
    throw new Error("targets and params must have the same length");
  }
  const knots = clampedKnots(nCP, degree, knotStretch);
  const M = targets.length;
  const w = weights ?? new Array(M).fill(1);

  // Precompute the full (M x nCP) basis matrix.
  const B: number[][] = new Array(M);
  for (let j = 0; j < M; j++) {
    const row = new Array<number>(nCP).fill(0);
    const { values, span } = basisFunctions(knots, degree, params[j]);
    for (let r = 0; r <= degree; r++) row[span - degree + r] = values[r];
    B[j] = row;
  }

  const freeIndices = (fixed: Record<number, number>): number[] => {
    const out: number[] = [];
    for (let i = 0; i < nCP; i++) if (!(i in fixed)) out.push(i);
    return out;
  };

  const solveCoord = (
    fixed: Record<number, number>,
    targetVals: number[],
  ): number[] => {
    const free = freeIndices(fixed);
    const nFree = free.length;

    // Build residual-adjusted RHS: subtract the fixed CPs' contributions.
    const A: number[][] = new Array(M);
    const rhs: number[] = new Array(M);
    for (let j = 0; j < M; j++) {
      const row = new Array<number>(nFree);
      for (let i = 0; i < nFree; i++) row[i] = B[j][free[i]];
      A[j] = row;
      let r = targetVals[j];
      for (const key of Object.keys(fixed)) {
        const idx = Number(key);
        r -= B[j][idx] * fixed[idx];
      }
      rhs[j] = r;
    }

    // Weighted normal equations: (A^T W A) x = A^T W b.
    const AtA: number[][] = new Array(nFree);
    const Atb: number[] = new Array(nFree).fill(0);
    for (let i = 0; i < nFree; i++) {
      AtA[i] = new Array(nFree).fill(0);
      for (let k = 0; k < nFree; k++) {
        let s = 0;
        for (let j = 0; j < M; j++) s += w[j] * A[j][i] * A[j][k];
        AtA[i][k] = s;
      }
      let s = 0;
      for (let j = 0; j < M; j++) s += w[j] * A[j][i] * rhs[j];
      Atb[i] = s;
    }
    const solved = solveLinear(AtA, Atb);

    const full = new Array<number>(nCP);
    for (let i = 0; i < nCP; i++) {
      if (i in fixed) full[i] = fixed[i];
      else full[i] = solved[free.indexOf(i)];
    }
    return full;
  };

  const xs = solveCoord(
    fixedX,
    targets.map((t) => t.x),
  );
  const ys = solveCoord(
    fixedY,
    targets.map((t) => t.y),
  );

  const cps: Vec2[] = new Array(nCP);
  for (let i = 0; i < nCP; i++) cps[i] = { x: xs[i], y: ys[i] };
  return cps;
}

/** Chord-length parameterization of a sequence of target points, in [0,1]. */
export function chordLengthParams(points: Vec2[]): number[] {
  const n = points.length;
  const params = new Array<number>(n);
  params[0] = 0;
  let total = 0;
  for (let i = 1; i < n; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    total += Math.sqrt(dx * dx + dy * dy);
    params[i] = total;
  }
  for (let i = 0; i < n; i++) params[i] /= total || 1;
  return params;
}
