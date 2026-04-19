/**
 * Clamped cubic uniform B-spline.
 *
 * Why B-splines (not Bezier, NURBS, or Catmull-Rom)?
 *
 * - **Local control**: moving a single control point only affects a few
 *   neighbouring curve segments, which matches what you want from an
 *   interactive airfoil editor (nudge the middle, don't wobble the tails).
 *   A global Bezier of equivalent order changes everywhere when you move
 *   one point.
 * - **Clamped endpoints**: with multiplicity-(p+1) knots at each end, the
 *   curve is guaranteed to pass exactly through the first and last control
 *   points. That gives us the fixed leading-edge and trailing-edge points
 *   for free, with zero special-case code.
 * - **C2 continuity** everywhere for degree 3, so the surface looks smooth
 *   regardless of how you drag. NURBS would add weights we don't need; a
 *   Catmull-Rom interpolates every control point (including ones you'd
 *   rather treat as handles) and can overshoot.
 * - **Standard** and easy to hand off to any downstream solver / NeuralFoil
 *   later: we just sample points along the curve.
 *
 * This is a *clean-room* implementation written from the de Boor textbook
 * recurrence; XFLR5 is only a behavioural reference.
 */

export type Vec2 = { x: number; y: number };

/**
 * Build a clamped uniform knot vector for n+1 control points of degree p.
 * Length = n + p + 2. First p+1 knots are 0, last p+1 are 1, the middle
 * knots are evenly spaced.
 */
export function clampedUniformKnots(nControlPoints: number, degree: number): number[] {
  return clampedKnots(nControlPoints, degree, 1);
}

/**
 * Build a clamped knot vector whose interior knots are stretched toward
 * t = 0 by raising the uniform position to a power < 1. `stretchPower`
 * of 1 gives the standard uniform spacing; 0.5 puts interior knots at
 * t = sqrt(i/(N+1)), clustering them near t = 0. This gives a B-spline
 * more resolution near the leading edge, which matters for an airfoil
 * whose curvature changes fastest there.
 */
export function clampedKnots(
  nControlPoints: number,
  degree: number,
  stretchPower: number,
): number[] {
  const p = degree;
  const n = nControlPoints - 1;
  const m = n + p + 1;
  const knots: number[] = new Array(m + 1);

  for (let i = 0; i <= p; i++) knots[i] = 0;
  for (let i = m - p; i <= m; i++) knots[i] = 1;

  const interior = m - 2 * p - 1;
  for (let i = 1; i <= interior; i++) {
    const u = i / (interior + 1);
    knots[p + i] = Math.pow(u, stretchPower);
  }
  return knots;
}

/**
 * Find the knot span index such that knots[k] <= t < knots[k+1],
 * clamped for the right endpoint.
 */
export function findSpan(knots: number[], degree: number, t: number): number {
  const n = knots.length - degree - 2;
  if (t >= knots[n + 1]) return n;
  if (t <= knots[degree]) return degree;
  let lo = degree;
  let hi = n + 1;
  let mid = (lo + hi) >> 1;
  while (t < knots[mid] || t >= knots[mid + 1]) {
    if (t < knots[mid]) hi = mid;
    else lo = mid;
    mid = (lo + hi) >> 1;
  }
  return mid;
}

/**
 * Evaluate a clamped B-spline at parameter t in [0,1] using de Boor's
 * algorithm. Numerically stable and works for any degree p >= 1.
 */
export function evaluateBSpline(
  controlPoints: Vec2[],
  knots: number[],
  degree: number,
  t: number,
): Vec2 {
  const p = degree;
  const k = findSpan(knots, p, t);

  // de Boor's algorithm: working copy of the p+1 relevant control points
  const dx: number[] = new Array(p + 1);
  const dy: number[] = new Array(p + 1);
  for (let j = 0; j <= p; j++) {
    dx[j] = controlPoints[k - p + j].x;
    dy[j] = controlPoints[k - p + j].y;
  }

  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = k - p + j;
      const denom = knots[i + p - r + 1] - knots[i];
      const alpha = denom === 0 ? 0 : (t - knots[i]) / denom;
      dx[j] = (1 - alpha) * dx[j - 1] + alpha * dx[j];
      dy[j] = (1 - alpha) * dy[j - 1] + alpha * dy[j];
    }
  }
  return { x: dx[p], y: dy[p] };
}

/**
 * Evaluate the p+1 non-zero B-spline basis functions at parameter t.
 * Returns the values and the knot span so the caller can place them at
 * the correct control-point indices (indices span-p .. span).
 *
 * Uses the standard Cox-de Boor recurrence, numerically stable form.
 */
export function basisFunctions(
  knots: number[],
  degree: number,
  t: number,
): { values: number[]; span: number } {
  const p = degree;
  const span = findSpan(knots, p, t);

  const N: number[] = new Array(p + 1).fill(0);
  const left: number[] = new Array(p + 1).fill(0);
  const right: number[] = new Array(p + 1).fill(0);
  N[0] = 1;

  for (let j = 1; j <= p; j++) {
    left[j] = t - knots[span + 1 - j];
    right[j] = knots[span + j] - t;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const denom = right[r + 1] + left[j - r];
      const temp = denom === 0 ? 0 : N[r] / denom;
      N[r] = saved + right[r + 1] * temp;
      saved = left[j - r] * temp;
    }
    N[j] = saved;
  }
  return { values: N, span };
}

/**
 * Sample the spline uniformly in parameter space.
 */
export function sampleUniform(
  controlPoints: Vec2[],
  degree: number,
  nSamples: number,
  knotStretch: number = 1,
): Vec2[] {
  const knots = clampedKnots(controlPoints.length, degree, knotStretch);
  const out: Vec2[] = new Array(nSamples);
  for (let i = 0; i < nSamples; i++) {
    const t = i / (nSamples - 1);
    out[i] = evaluateBSpline(controlPoints, knots, degree, t);
  }
  return out;
}

/**
 * Sample the spline at cosine-spaced parameter values. This clusters
 * samples near both endpoints, which is what solvers like XFOIL and
 * NeuralFoil expect for leading- and trailing-edge resolution.
 *
 * Note: this is cosine spacing in *parameter* space, not in x. For a
 * typical airfoil shape x(t) is close to monotonic, so the resulting x
 * distribution is close to a true cosine-x distribution. If perfect
 * cosine-x is needed later we can add a 1-D root-find on t(x).
 */
export function sampleCosine(
  controlPoints: Vec2[],
  degree: number,
  nSamples: number,
  knotStretch: number = 1,
): Vec2[] {
  const knots = clampedKnots(controlPoints.length, degree, knotStretch);
  const out: Vec2[] = new Array(nSamples);
  for (let i = 0; i < nSamples; i++) {
    const beta = (i * Math.PI) / (nSamples - 1);
    const t = 0.5 * (1 - Math.cos(beta));
    out[i] = evaluateBSpline(controlPoints, knots, degree, t);
  }
  return out;
}
