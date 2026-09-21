import { getClipperLib, toClipperPath, fromClipperPath } from './geometry.js';

// Where the moving polygon may NOT sit, relative to the stationary one.
//
// NFP(A, B) = A ⊕ (-B): the Minkowski sum of A with B reflected through its
// own reference point.
//
// This file used to carry a comment saying the result was "exact for convex
// polygons only", and a convex decomposition was built on the strength of it
// — split both shapes into convex pieces, take an elementary sum per pair,
// union the lot. It was then measured against plain whole-shape calls:
//
//     L against its 180-degree rotation     identical
//     crescent (a genuine socket)           identical
//     the real card-wallet back             identical
//
// to 0.000% of forbidden area, every time. clipper-lib's MinkowskiSum is
// already exact for concave input. The decomposition was deleted; the
// comment that prompted it was simply wrong, and it had been believed
// without being checked.
//
// The real reason concave parts do not interlock is not here. It is that
// placement takes the first position where a part fits, scanning from the
// bottom left, and that position is almost never a nested one. See
// docs/superpowers/specs/2026-09-21-packing-density-design.md.
export function computeNFP(stationaryPolygon, movingPolygon) {
  const ClipperLib = getClipperLib();

  const reflectedMoving = movingPolygon.map((p) => ({ x: -p.x, y: -p.y }));
  const patternPath = toClipperPath(reflectedMoving);
  const stationaryPath = toClipperPath(stationaryPolygon);

  const solutionPaths = ClipperLib.Clipper.MinkowskiSum(patternPath, stationaryPath, true);

  // clipper-lib can return an extra, redundant path for some inputs (a
  // spurious inner "hole" for axis-aligned square/square NFPs) alongside the
  // correct boundary. It is a strict subset of the true boundary, so callers
  // that test a point against every returned path are unaffected.
  return solutionPaths.map(fromClipperPath);
}
