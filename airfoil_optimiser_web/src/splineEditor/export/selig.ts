/**
 * Export sampled airfoil coordinates in Selig format:
 *
 *   AirfoilName
 *   1.000000  0.001250
 *   ...       ...       <- upper surface from TE to LE
 *   0.000000  0.000000
 *   ...       ...       <- lower surface from LE to TE
 *   1.000000 -0.001250
 *
 * This is the format NeuralFoil, XFOIL and most airfoil databases accept.
 */

import type { Airfoil } from '../spline/airfoil'
import { sampleAirfoil } from '../spline/airfoil'

export interface ExportOptions {
  /** Samples per surface. Total points = 2*nPerSurface - 1 (LE shared). */
  nPerSurface?: number;
  spacing?: 'cosine' | 'uniform'
}

export interface AirfoilCoords {
  name: string;
  points: [number, number][];
}

export function exportSeligCoords(
  airfoil: Airfoil,
  opts: ExportOptions = {},
): AirfoilCoords {
  const n = opts.nPerSurface ?? 80
  const spacing = opts.spacing ?? 'cosine'
  const sampled = sampleAirfoil(airfoil, n, spacing);

  const upperReversed = [...sampled.upper].reverse();
  const lower = sampled.lower.slice(1);

  const points: [number, number][] = [
    ...upperReversed.map<[number, number]>((p) => [p.x, p.y]),
    ...lower.map<[number, number]>((p) => [p.x, p.y]),
  ];

  // Snap the LE and both TE points to the exact fixed-CP values. The
  // B-spline evaluator hits the clamped endpoints only to within
  // floating-point, so without this snap the exported .dat would carry
  // a ~1e-5 cosmetic offset at the LE. Replaces that with a hard zero.
  const upperTE = airfoil.upper[airfoil.upper.length - 1];
  const lowerTE = airfoil.lower[airfoil.lower.length - 1];
  if (points.length > 0) {
    points[0] = [upperTE.x, upperTE.y];
    points[n - 1] = [0, 0];
    points[points.length - 1] = [lowerTE.x, lowerTE.y];
  }

  return { name: airfoil.name, points };
}

export function formatSelig(coords: AirfoilCoords): string {
  const lines: string[] = [coords.name];
  for (const [x, y] of coords.points) {
    const xs = x.toFixed(6).padStart(10, " ");
    const ys = (y >= 0 ? " " : "") + y.toFixed(6);
    lines.push(`${xs}  ${ys}`);
  }
  return lines.join("\n");
}
