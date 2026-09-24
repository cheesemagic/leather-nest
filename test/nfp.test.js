import test from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';

globalThis.ClipperLib = ClipperLib;

import { computeNFP } from '../src/nesting/nfp.js';
import { boundingBox, toClipperPath, polygonArea, SCALE } from '../src/nesting/geometry.js';

// clipper-lib's Minkowski implementation can return an extra, redundant path
// alongside the true NFP boundary (see comment in src/nesting/nfp.js) — its
// position in the returned array isn't guaranteed, but the true boundary is
// always the outer/largest one, so pick it by bounding-box area rather than
// assuming index 0.
function largestByBoundingBoxArea(polygons) {
  return polygons.reduce((largest, poly) => {
    const area = (b) => (b.maxX - b.minX) * (b.maxY - b.minY);
    return area(boundingBox(poly)) > area(boundingBox(largest)) ? poly : largest;
  });
}

test('computeNFP of two axis-aligned squares matches the expected Minkowski sum bounds', () => {
  const stationary = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const moving = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];

  const nfpPolygons = computeNFP(stationary, moving);

  assert.ok(nfpPolygons.length >= 1);
  const matchesExpectedBounds = nfpPolygons.some((poly) => {
    const bounds = boundingBox(poly);
    return (
      Math.abs(bounds.minX - -4) < 1e-3 &&
      Math.abs(bounds.minY - -4) < 1e-3 &&
      Math.abs(bounds.maxX - 10) < 1e-3 &&
      Math.abs(bounds.maxY - 10) < 1e-3
    );
  });
  assert.ok(matchesExpectedBounds, 'expected at least one NFP path to match bounds (-4,-4)-(10,10)');
});

// An L with a deep reflex corner, and its convex hull. The hull is NOT the
// bounding box -- the (40,15)->(15,40) chord cuts the corner off. The L fills
// 75.7% of that hull, a far deeper concavity than the real card-wallet back's
// 90-92%, so this is a stress case rather than a token one.
const CONCAVE_L = [
  { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 15 },
  { x: 15, y: 15 }, { x: 15, y: 40 }, { x: 0, y: 40 },
];
const CONCAVE_L_HULL = [
  { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 15 },
  { x: 15, y: 40 }, { x: 0, y: 40 },
];

test('computeNFP respects a concave shape instead of silently hulling it', () => {
  // This repo asserted for months, in CLAUDE.md and in place.js, that the
  // Minkowski sum was "exact for convex polygons only". A convex
  // decomposition was built on the strength of that, measured, found to
  // change nothing, and deleted (see the packing-density spec). The claim was
  // never true. This is the test that should have been run first.
  //
  // An L and its 180-degree rotation interlock, so an exact NFP must be
  // strictly smaller than the hull's -- if clipper were hulling the input
  // internally the two would come out identical. Measured: 4525 vs 5150.
  const rot180 = (poly) => poly.map((p) => ({ x: -p.x, y: -p.y }));
  const exact = polygonArea(largestByBoundingBoxArea(computeNFP(CONCAVE_L, rot180(CONCAVE_L))));
  const hulled = polygonArea(
    largestByBoundingBoxArea(computeNFP(CONCAVE_L_HULL, rot180(CONCAVE_L_HULL)))
  );

  assert.ok(
    exact < hulled * 0.95,
    `expected the concave NFP to be clearly tighter than its hull's, got ${exact} vs ${hulled}`
  );
});

test('a clearly overlapping reference point falls inside the NFP, a clear one falls outside', () => {
  const stationary = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const moving = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
  const nfpPolygons = computeNFP(stationary, moving);
  const nfpPath = toClipperPath(largestByBoundingBoxArea(nfpPolygons));

  const overlappingPoint = new ClipperLib.IntPoint2(0, 0);
  const clearPoint = new ClipperLib.IntPoint2(20 * SCALE, 20 * SCALE);

  assert.equal(ClipperLib.Clipper.PointInPolygon(overlappingPoint, nfpPath), 1);
  assert.equal(ClipperLib.Clipper.PointInPolygon(clearPoint, nfpPath), 0);
});
