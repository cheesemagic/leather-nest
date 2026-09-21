// test/decompose.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';

globalThis.ClipperLib = ClipperLib;

import { convexDecompose, isConvex } from '../src/nesting/decompose.js';
import { computeNFP } from '../src/nesting/nfp.js';
import { polygonArea, rotatePolygon, normalizeToOrigin } from '../src/nesting/geometry.js';

const SQUARE = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
const L = [
  { x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 20 },
  { x: 20, y: 20 }, { x: 20, y: 60 }, { x: 0, y: 60 },
];
const PLUS = [
  { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 30, y: 10 },
  { x: 30, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 30 }, { x: 10, y: 30 },
  { x: 10, y: 20 }, { x: 0, y: 20 }, { x: 0, y: 10 }, { x: 10, y: 10 },
];

test('a convex shape is left alone', () => {
  assert.deepEqual(convexDecompose(SQUARE), [SQUARE]);
  assert.equal(isConvex(SQUARE), true);
});

test('every piece of a decomposition is convex', () => {
  for (const [name, shape] of [['L', L], ['plus', PLUS]]) {
    const pieces = convexDecompose(shape);
    assert.ok(pieces.length > 1, `${name} should have been split`);
    for (const piece of pieces) {
      assert.ok(isConvex(piece), `${name} produced a piece that is not convex`);
    }
  }
});

test('decomposition neither loses nor duplicates area', () => {
  for (const shape of [L, PLUS]) {
    const total = convexDecompose(shape).reduce((sum, p) => sum + polygonArea(p), 0);
    assert.ok(Math.abs(total - polygonArea(shape)) < 0.001, `${total} vs ${polygonArea(shape)}`);
  }
});

test('an L-shape splits in two, not three', () => {
  // Piece count is the entire cost of this: an NFP is one Minkowski sum per
  // PAIR of pieces, so three pieces against three is nine sums where two
  // against two is four.
  assert.equal(convexDecompose(L).length, 2);
});

test('winding order does not change the result', () => {
  assert.equal(convexDecompose([...L].reverse()).length, convexDecompose(L).length);
});

// --- what the decomposition is for --------------------------------------

const hullOf = (points) => {
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const lower = [];
  const upper = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (const p of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
};
const nfpArea = (a, b) => computeNFP(a, b).reduce((sum, r) => sum + polygonArea(r), 0);

test('two shapes that can interlock are allowed to', () => {
  // The whole point. An L and an upside-down L nest into each other; a
  // convex-only NFP forbids exactly those positions. Measured against the
  // same pair treated as their convex hulls.
  const flipped = normalizeToOrigin(rotatePolygon(L, 180));
  const exact = nfpArea(L, flipped);
  const viaHull = nfpArea(hullOf(L), hullOf(flipped));

  assert.ok(exact < viaHull, 'the exact NFP should forbid less than the hull approximation');
  assert.ok((viaHull - exact) / viaHull > 0.05, `only ${(((viaHull - exact) / viaHull) * 100).toFixed(1)}% tighter`);
});

test('two convex shapes give the same answer as before', () => {
  // Decomposition must not disturb the case that already worked. The NFP of
  // a 10x10 with a 6x6 is a 16x16 square.
  //
  // Checked on the largest region, not the sum: clipper's Minkowski returns
  // a spurious inner path alongside the real boundary for axis-aligned
  // square-on-square, which the original code documented and lived with. It
  // is a subset of the true boundary, so callers testing a point against
  // every region are unaffected.
  const moving = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 6 }, { x: 0, y: 6 }];
  const biggest = Math.max(...computeNFP(SQUARE, moving).map(polygonArea));
  assert.ok(Math.abs(biggest - 256) < 1, `expected 256mm2, got ${biggest}`);
});

test('the forbidden region comes back as one piece, not hundreds', () => {
  // Unmerged, a decomposed NFP is one region per pair of convex pieces, and
  // the placement scan tests every candidate position against every region
  // of every part already placed. On a real job that was ~400 regions per
  // placed part and the run never finished.
  assert.ok(computeNFP(PLUS, PLUS).length <= 4, `${computeNFP(PLUS, PLUS).length} regions`);
});
