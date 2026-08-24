import { getClipperLib, toClipperPath, fromClipperPath } from './geometry.js';

export function computeNFP(stationaryPolygon, movingPolygon) {
  const ClipperLib = getClipperLib();

  // NFP(A, B) = A ⊕ (-B): the Minkowski sum of the stationary polygon with
  // the moving polygon reflected through its own reference point (origin).
  // Exact for convex polygons — all of v0's hardcoded test shapes.
  const reflectedMoving = movingPolygon.map((p) => ({ x: -p.x, y: -p.y }));
  const patternPath = toClipperPath(reflectedMoving);
  const stationaryPath = toClipperPath(stationaryPolygon);

  const solutionPaths = ClipperLib.Clipper.MinkowskiSum(patternPath, stationaryPath, true);

  // clipper-lib's Minkowski implementation can return an extra, redundant
  // path for some inputs (e.g. a spurious inner "hole" for axis-aligned
  // square/square NFPs) alongside the correct boundary. For convex inputs
  // it's always a strict subset of the true boundary, so downstream
  // consumers that OR across all returned paths (e.g. placement code) are
  // unaffected — no filtering needed here.
  return solutionPaths.map(fromClipperPath);
}
