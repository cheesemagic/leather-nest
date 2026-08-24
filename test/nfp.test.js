import test from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';

globalThis.ClipperLib = ClipperLib;

import { computeNFP } from '../src/nesting/nfp.js';
import { boundingBox, toClipperPath, SCALE } from '../src/nesting/geometry.js';

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
