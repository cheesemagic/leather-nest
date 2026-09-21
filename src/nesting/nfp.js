import { getClipperLib, toClipperPath, fromClipperPath } from './geometry.js';
import { convexDecompose } from './decompose.js';

// Decomposition is pure and the placement code holds onto the same polygon
// objects for every part already placed, so keying on the array itself turns
// a repeated cost into a single one. A WeakMap, so nothing is retained past
// the nesting run that created it.
const decompositionCache = new WeakMap();

function convexPieces(polygon) {
  const cached = decompositionCache.get(polygon);
  if (cached) return cached;
  const pieces = convexDecompose(polygon);
  decompositionCache.set(polygon, pieces);
  return pieces;
}

// Where the moving polygon may NOT sit, relative to the stationary one.
//
// NFP(A, B) = A ⊕ (-B), the Minkowski sum of A with B reflected through its
// own origin. That identity is exact for CONVEX polygons only. Fed a concave
// part it returns a region at least as large as the truth, which forbids
// precisely the positions where two pieces would settle into one another.
//
// The cost of that was measured on a real job before this was written:
// nesting a concave wallet back and nesting its own convex hull placed the
// SAME 54 pieces. Every concavity was being ignored. Since the parts filled
// 90-92% of their hulls, that is the 8-10% of each piece that was going to
// waste — and it is why nothing ever overlapped: the error was always in the
// conservative direction.
//
// NFP(A, B) is the union of NFP(Ai, Bj) across the convex pieces of each, and
// each of those IS an exact Minkowski sum.
//
// They ARE unioned, and that is not tidying. An early version returned the
// sub-regions unmerged, reasoning that callers already test a point against
// every returned region so merging would only cost clipper time. That was
// wrong by a wide margin: a part with a deep curved concavity decomposes
// into about twenty convex pieces, so an unmerged NFP is ~400 regions, and
// the placement scan tests EVERY candidate position against every region of
// every part already placed. Fifty parts down that is twenty thousand
// point-in-polygon tests per position, and the run never finished.
// Unioning is one clipper call per shape pair, cached, and collapses those
// 400 regions to one or two.
export function computeNFP(stationaryPolygon, movingPolygon) {
  const ClipperLib = getClipperLib();

  const stationaryPieces = convexPieces(stationaryPolygon);
  const movingPieces = convexPieces(movingPolygon);

  const subPaths = [];
  for (const stationary of stationaryPieces) {
    const stationaryPath = toClipperPath(stationary);
    for (const moving of movingPieces) {
      const reflected = moving.map((p) => ({ x: -p.x, y: -p.y }));
      // clipper-lib's Minkowski can return an extra redundant path for some
      // inputs (a spurious inner "hole" for axis-aligned square/square NFPs).
      // For convex inputs it is always a subset of the true boundary, so the
      // union below absorbs it harmlessly.
      for (const path of ClipperLib.Clipper.MinkowskiSum(
        toClipperPath(reflected),
        stationaryPath,
        true
      )) {
        subPaths.push(path);
      }
    }
  }

  if (subPaths.length <= 1) return subPaths.map(fromClipperPath);

  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(subPaths, ClipperLib.PolyType.ptSubject, true);
  const merged = new ClipperLib.Paths();
  // NonZero, not EvenOdd: overlapping sub-regions must add up, not cancel
  // out and punch holes in the forbidden area.
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    merged,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero
  );
  return (merged.length ? merged : subPaths).map(fromClipperPath);
}
