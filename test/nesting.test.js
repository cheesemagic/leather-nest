// test/nesting.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';

globalThis.ClipperLib = ClipperLib;

import { nest } from '../src/nesting/index.js';
import { boundingBox, placedPolygon } from '../src/nesting/geometry.js';

function intersectionArea(polyA, polyB) {
  const SCALE = 1000;
  const toClipper = (poly) =>
    poly.map((p) => new ClipperLib.IntPoint2(Math.round(p.x * SCALE), Math.round(p.y * SCALE)));
  const clipper = new ClipperLib.Clipper();
  clipper.AddPath(toClipper(polyA), ClipperLib.PolyType.ptSubject, true);
  clipper.AddPath(toClipper(polyB), ClipperLib.PolyType.ptClip, true);
  const solution = new ClipperLib.Paths();
  clipper.Execute(
    ClipperLib.ClipType.ctIntersection,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero
  );
  let area = 0;
  for (const path of solution) {
    area += Math.abs(ClipperLib.Clipper.Area(path));
  }
  return area / (SCALE * SCALE);
}

test('two known rectangles nest onto a sheet without overlapping and within bounds', () => {
  const sheet = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
  const partA = {
    id: 'A',
    polygon: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }],
    allowedRotations: [0, 180],
  };
  const partB = {
    id: 'B',
    polygon: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 50 }, { x: 0, y: 50 }],
    allowedRotations: [0, 180],
  };

  const result = nest(sheet, [partA, partB]);

  assert.equal(result.noFit.length, 0);
  assert.equal(result.placements.length, 2);

  const sheetBounds = boundingBox(sheet);
  const partsById = new Map([partA, partB].map((p) => [p.id, p]));
  const absolutePolygons = result.placements.map((placement) =>
    placedPolygon(partsById.get(placement.id), placement)
  );

  for (const poly of absolutePolygons) {
    const bounds = boundingBox(poly);
    assert.ok(bounds.minX >= sheetBounds.minX - 1e-6);
    assert.ok(bounds.minY >= sheetBounds.minY - 1e-6);
    assert.ok(bounds.maxX <= sheetBounds.maxX + 1e-6);
    assert.ok(bounds.maxY <= sheetBounds.maxY + 1e-6);
  }

  const overlap = intersectionArea(absolutePolygons[0], absolutePolygons[1]);
  assert.ok(overlap < 1e-3, `expected no overlap, got area ${overlap}`);
});

test('an oversized part produces noFit instead of throwing', () => {
  const sheet = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
  const partC = {
    id: 'C',
    polygon: [{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 150 }, { x: 0, y: 150 }],
    allowedRotations: [0],
  };

  const result = nest(sheet, [partC]);

  assert.deepEqual(result.noFit, ['C']);
  assert.equal(result.placements.length, 0);
});

test('a part with no allowedRotations (legacy record) still places instead of throwing', () => {
  const sheet = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
  const legacyPart = {
    id: 'D',
    polygon: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }],
    // no allowedRotations key, as on records predating the metadata feature
  };

  const result = nest(sheet, [legacyPart]);

  assert.equal(result.noFit.length, 0);
  assert.equal(result.placements.length, 1);
});

test('a part that fits the bounding box but not the real outline is reported noFit', () => {
  // A triangle occupying the lower-left half of a 100x100 bounding box.
  const triangleSheet = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
  ];
  // 60x60 fits the 100x100 bounding box easily, but cannot fit inside the
  // triangle at any position.
  const part = {
    id: 'big-square',
    polygon: [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 60 },
      { x: 0, y: 60 },
    ],
    allowedRotations: [0],
  };

  const result = nest(triangleSheet, [part]);

  assert.equal(result.placements.length, 0);
  assert.deepEqual(result.noFit, ['big-square']);
});

test('a part small enough for the real outline still places inside an irregular sheet', () => {
  const triangleSheet = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
  ];
  const part = {
    id: 'small',
    polygon: [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ],
    allowedRotations: [0],
  };

  const result = nest(triangleSheet, [part]);

  assert.equal(result.noFit.length, 0);
  assert.equal(result.placements.length, 1);
});
