import test from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';

globalThis.ClipperLib = ClipperLib;

import { computeNFP } from '../src/nesting/nfp.js';
import { boundingBox, toClipperPath, SCALE } from '../src/nesting/geometry.js';

test('computeNFP of two axis-aligned squares matches the expected Minkowski sum bounds', () => {
  const stationary = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const moving = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];

  const nfpPolygons = computeNFP(stationary, moving);

  assert.ok(nfpPolygons.length >= 1);
  const bounds = boundingBox(nfpPolygons[0]);
  assert.ok(Math.abs(bounds.minX - -4) < 1e-3, `minX was ${bounds.minX}`);
  assert.ok(Math.abs(bounds.minY - -4) < 1e-3, `minY was ${bounds.minY}`);
  assert.ok(Math.abs(bounds.maxX - 10) < 1e-3, `maxX was ${bounds.maxX}`);
  assert.ok(Math.abs(bounds.maxY - 10) < 1e-3, `maxY was ${bounds.maxY}`);
});

test('a clearly overlapping reference point falls inside the NFP, a clear one falls outside', () => {
  const stationary = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const moving = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
  const nfpPolygons = computeNFP(stationary, moving);
  const nfpPath = toClipperPath(nfpPolygons[0]);

  const overlappingPoint = new ClipperLib.IntPoint2(0, 0);
  const clearPoint = new ClipperLib.IntPoint2(20 * SCALE, 20 * SCALE);

  assert.equal(ClipperLib.Clipper.PointInPolygon(overlappingPoint, nfpPath), 1);
  assert.equal(ClipperLib.Clipper.PointInPolygon(clearPoint, nfpPath), 0);
});
