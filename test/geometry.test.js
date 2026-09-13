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
  polygonArea,
  pointInPolygon,
  polygonContains,
  inflatePolygon,
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

test('polygonArea returns the absolute area of a rectangle and a triangle', () => {
  const rectangle = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 20 },
    { x: 0, y: 20 },
  ];
  assert.equal(polygonArea(rectangle), 800);

  const triangle = [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 0, y: 10 },
  ];
  assert.equal(polygonArea(triangle), 150);
});

test('polygonArea is unaffected by winding order, rotation, or translation', () => {
  const rectangle = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 20 },
    { x: 0, y: 20 },
  ];
  const reversed = [...rectangle].reverse();
  assert.equal(polygonArea(reversed), 800);

  assert.ok(Math.abs(polygonArea(rotatePolygon(rectangle, 37)) - 800) < 1e-9);
  assert.equal(polygonArea(translatePolygon(rectangle, -500, 250)), 800);
});

const RECT = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 60 },
  { x: 0, y: 60 },
];

// A C-shape: 100x60 with a notch bitten out of the middle of the top edge.
const C_SHAPE = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 60 },
  { x: 70, y: 60 },
  { x: 70, y: 25 },
  { x: 30, y: 25 },
  { x: 30, y: 60 },
  { x: 0, y: 60 },
];

test('pointInPolygon treats every boundary point as inside, on all four edges', () => {
  assert.equal(pointInPolygon({ x: 50, y: 30 }, RECT), true, 'interior');
  assert.equal(pointInPolygon({ x: 0, y: 30 }, RECT), true, 'left edge');
  assert.equal(pointInPolygon({ x: 100, y: 30 }, RECT), true, 'right edge');
  assert.equal(pointInPolygon({ x: 50, y: 0 }, RECT), true, 'bottom edge');
  assert.equal(pointInPolygon({ x: 50, y: 60 }, RECT), true, 'top edge');
  assert.equal(pointInPolygon({ x: 0, y: 0 }, RECT), true, 'corner');
  assert.equal(pointInPolygon({ x: 101, y: 30 }, RECT), false, 'just outside');
});

test('polygonContains accepts a part flush against each edge of a rectangle', () => {
  const part = (x, y) => [
    { x, y },
    { x: x + 10, y },
    { x: x + 10, y: y + 10 },
    { x, y: y + 10 },
  ];
  assert.equal(polygonContains(RECT, part(0, 0)), true, 'flush bottom-left');
  assert.equal(polygonContains(RECT, part(90, 0)), true, 'flush bottom-right');
  assert.equal(polygonContains(RECT, part(0, 50)), true, 'flush top-left');
  assert.equal(polygonContains(RECT, part(90, 50)), true, 'flush top-right');
  assert.equal(polygonContains(RECT, part(95, 0)), false, 'hanging off the right');
});

test('polygonContains rejects a part spanning a concavity even when every vertex is inside', () => {
  // Both ends sit on the arms of the C; the middle crosses the notch.
  const spanner = [
    { x: 20, y: 40 },
    { x: 80, y: 40 },
    { x: 80, y: 50 },
    { x: 20, y: 50 },
  ];
  for (const pt of spanner) {
    assert.equal(pointInPolygon(pt, C_SHAPE), true, `vertex ${pt.x},${pt.y} is inside`);
  }
  assert.equal(polygonContains(C_SHAPE, spanner), false);
});

test('polygonContains accepts a part that fits inside one arm of the concavity', () => {
  const inArm = [
    { x: 5, y: 30 },
    { x: 25, y: 30 },
    { x: 25, y: 55 },
    { x: 5, y: 55 },
  ];
  assert.equal(polygonContains(C_SHAPE, inArm), true);
});

test('polygonContains returns false for degenerate input rather than throwing', () => {
  assert.equal(polygonContains(RECT, [{ x: 1, y: 1 }, { x: 2, y: 2 }]), false);
  assert.equal(polygonContains([{ x: 0, y: 0 }], RECT), false);
});

test('inflatePolygon grows a rectangle by the given mm on every side', () => {
  const grown = inflatePolygon(
    [
      { x: 0, y: 0 },
      { x: 35, y: 0 },
      { x: 35, y: 12 },
      { x: 0, y: 12 },
    ],
    0.6
  );
  const b = boundingBox(grown);
  assert.ok(Math.abs(b.maxX - b.minX - 36.2) < 1e-6, `width ${b.maxX - b.minX}`);
  assert.ok(Math.abs(b.maxY - b.minY - 13.2) < 1e-6, `height ${b.maxY - b.minY}`);
});

test('polygonContains rejects a part whose edges are exactly collinear with a notch, spanning air (collinear-edge false-accept)', () => {
  // The part's vertical edges exactly coincide with the C_SHAPE notch walls
  // (x=30 and x=70). Every vertex reads "inside" via the boundary-inclusive
  // rule and no edge *properly* crosses (collinear, d=0), so the cheap
  // vertex+crossing tests alone false-accept this even though 200mm^2 of
  // the part (x 30..70, y 25..30) sits over the notch, which is air.
  const part = [
    { x: 30, y: 20 },
    { x: 70, y: 20 },
    { x: 70, y: 30 },
    { x: 30, y: 30 },
  ];
  assert.equal(polygonContains(C_SHAPE, part), false);
});

test('inflatePolygon returns the polygon unchanged for zero, negative, or non-finite mm', () => {
  for (const mm of [0, -3, NaN, undefined]) {
    assert.deepEqual(inflatePolygon(RECT, mm), RECT, `mm=${mm}`);
  }
});
