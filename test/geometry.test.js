// test/geometry.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';

globalThis.ClipperLib = ClipperLib;

import {
  rotatePolygon,
  translatePolygon,
  boundingBox,
  normalizeToOrigin,
  polygonToSVGPoints,
  toClipperPath,
  fromClipperPath,
  getClipperLib,
} from '../src/nesting/geometry.js';

test('rotatePolygon rotates a point 90 degrees around the origin', () => {
  const square = [{ x: 1, y: 0 }];
  const rotated = rotatePolygon(square, 90);
  assert.ok(Math.abs(rotated[0].x - 0) < 1e-9);
  assert.ok(Math.abs(rotated[0].y - 1) < 1e-9);
});

test('translatePolygon shifts every point by dx, dy', () => {
  const polygon = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  const translated = translatePolygon(polygon, 5, -2);
  assert.deepEqual(translated, [{ x: 5, y: -2 }, { x: 6, y: -1 }]);
});

test('boundingBox finds min/max x and y', () => {
  const polygon = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }];
  assert.deepEqual(boundingBox(polygon), { minX: 0, minY: 0, maxX: 40, maxY: 20 });
});

test('normalizeToOrigin shifts a polygon so its min corner is (0, 0)', () => {
  const polygon = [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 30 }, { x: 10, y: 30 }];
  const normalized = normalizeToOrigin(polygon);
  assert.deepEqual(boundingBox(normalized), { minX: 0, minY: 0, maxX: 40, maxY: 20 });
});

test('polygonToSVGPoints formats a polygon as an SVG points attribute value', () => {
  const polygon = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }];
  assert.equal(polygonToSVGPoints(polygon), '0,0 40,0 40,20');
});

test('toClipperPath and fromClipperPath round-trip a polygon', () => {
  const polygon = [{ x: 1.5, y: 2.25 }, { x: 10, y: 0 }];
  const roundTripped = fromClipperPath(toClipperPath(polygon));
  assert.ok(Math.abs(roundTripped[0].x - 1.5) < 1e-6);
  assert.ok(Math.abs(roundTripped[0].y - 2.25) < 1e-6);
  assert.ok(Math.abs(roundTripped[1].x - 10) < 1e-6);
  assert.ok(Math.abs(roundTripped[1].y - 0) < 1e-6);
});

test('getClipperLib throws a clear error when the global is missing', () => {
  const original = globalThis.ClipperLib;
  delete globalThis.ClipperLib;
  assert.throws(() => getClipperLib(), /ClipperLib global not found/);
  globalThis.ClipperLib = original;
});
