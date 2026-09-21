import { polygonArea } from './geometry.js';

// Splits a polygon into convex pieces.
//
// The no-fit polygon — where one part may sit relative to another — is a
// Minkowski sum, and that is exact only for convex shapes. Given a concave
// one it returns a region at least as large as the truth, forbidding exactly
// the positions where two pieces would settle into each other. Measured on a
// real job: nesting a concave wallet back and nesting its convex hull placed
// the SAME 54 pieces. The concavities were doing nothing at all.
//
// NFP(A, B) is the union of NFP(Ai, Bj) over every convex piece of each, so
// decomposing first makes the result exact.

const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

// Counter-clockwise, so "reflex" has one meaning rather than two.
function counterClockwise(polygon) {
  let twiceArea = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    twiceArea += a.x * b.y - b.x * a.y;
  }
  return twiceArea < 0 ? [...polygon].reverse() : polygon;
}

const isReflex = (polygon, i) =>
  cross(
    polygon[(i - 1 + polygon.length) % polygon.length],
    polygon[i],
    polygon[(i + 1) % polygon.length]
  ) < 0;

function segmentsProperlyCross(p1, p2, p3, p4) {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

// Is the line from vertex i to vertex j a legal cut — inside the shape and
// crossing no edge?
function isDiagonal(polygon, i, j) {
  const n = polygon.length;
  if (i === j || (i + 1) % n === j || (j + 1) % n === i) return false;

  const a = polygon[i];
  const b = polygon[j];
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    if (k === i || k === j || k2 === i || k2 === j) continue;
    if (segmentsProperlyCross(a, b, polygon[k], polygon[k2])) return false;
  }

  // Not crossing an edge is not enough — the line could run outside a
  // concavity entirely. Check its midpoint is within the shape.
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  let inside = false;
  for (let k = 0, m = n - 1; k < n; m = k++) {
    const p = polygon[k];
    const q = polygon[m];
    if ((p.y > mid.y) !== (q.y > mid.y) &&
        mid.x < ((q.x - p.x) * (mid.y - p.y)) / (q.y - p.y) + p.x) {
      inside = !inside;
    }
  }
  return inside;
}

// Cut at the first reflex vertex and recurse. Not the minimum number of
// pieces — that is a much harder problem — but few enough, and every piece
// is genuinely convex, which is the only thing the NFP needs.
//
// Piece count is what this costs: an NFP between two parts becomes one
// Minkowski sum per pair of pieces, so a 4-piece shape against a 4-piece
// shape is 16 sums instead of 1. Callers cache.
export function convexDecompose(polygon, depth = 0) {
  if (!Array.isArray(polygon) || polygon.length < 4) return [polygon];
  // A shape this tangled is not a real part; returning it whole keeps the
  // old conservative behaviour rather than recursing forever.
  if (depth > 24) return [polygon];

  const poly = depth === 0 ? counterClockwise(polygon) : polygon;
  const n = poly.length;

  for (let i = 0; i < n; i++) {
    if (!isReflex(poly, i)) continue;

    // Prefer cutting to ANOTHER reflex vertex: one cut then removes two
    // dents instead of one, and piece count is the whole cost here. On an
    // L-shape it is the difference between 2 pieces and 3 — and since an NFP
    // costs one Minkowski sum per PAIR of pieces, that is 4 sums against 9.
    const order = [];
    for (let step = 2; step < n - 1; step++) order.push((i + step) % n);
    order.sort((a, b) => (isReflex(poly, b) ? 1 : 0) - (isReflex(poly, a) ? 1 : 0));

    // Two passes. The first takes only a cut that finishes the job — both
    // halves already convex, so nothing recurses. An L-shape has a single
    // dent and should become 2 pieces; taking the first merely-legal cut
    // makes it 3, which is 9 Minkowski sums instead of 4.
    let fallback = null;
    for (const j of order) {
      if (!isDiagonal(poly, i, j)) continue;

      const first = [];
      for (let k = i; k !== j; k = (k + 1) % n) first.push(poly[k]);
      first.push(poly[j]);

      const second = [];
      for (let k = j; k !== i; k = (k + 1) % n) second.push(poly[k]);
      second.push(poly[i]);

      if (first.length < 3 || second.length < 3) continue;
      // A cut that leaves a zero-area sliver has not split anything.
      if (polygonArea(first) < 1e-9 || polygonArea(second) < 1e-9) continue;

      if (isConvex(first) && isConvex(second)) return [first, second];
      if (!fallback) fallback = [first, second];
    }

    if (fallback) {
      return [
        ...convexDecompose(fallback[0], depth + 1),
        ...convexDecompose(fallback[1], depth + 1),
      ];
    }
  }

  return [poly];
}

export function isConvex(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 4) return true;
  const poly = counterClockwise(polygon);
  for (let i = 0; i < poly.length; i++) {
    if (isReflex(poly, i)) return false;
  }
  return true;
}
