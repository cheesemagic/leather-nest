import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { placedPolygon } from '../src/nesting/geometry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON = path.join(__dirname, '..', 'venv', 'bin', 'python3');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'blotch_match.py');
const CANVAS = path.join(__dirname, 'fixtures', 'test-blotch-canvas.png');
const TRIANGLE_CANVAS = path.join(__dirname, 'fixtures', 'test-blotch-triangle-canvas.png');

// mm_per_px = 1: (0,0)-(100,0) over 100mm.
const CALIBRATION = { p1x: 0, p1y: 0, p2x: 100, p2y: 0, realDistanceMm: 100 };
const PART_POLYGON = [
  { x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }, { x: 0, y: 40 },
];
const FULL_REGION = { roiX: 0, roiY: 0, roiWidth: 500, roiHeight: 500 };

function runMatch(payload) {
  const stdout = execFileSync(PYTHON, [SCRIPT], { input: JSON.stringify(payload) });
  return JSON.parse(stdout.toString());
}

test('blotch_match.py finds the true rotated match, translation and rotation', () => {
  const result = runMatch({
    imagePath: CANVAS,
    calibration: CALIBRATION,
    searchRegion: FULL_REGION,
    partPolygon: PART_POLYGON,
    referencePlacement: { x: 100, y: 100, rotation: 0 },
    occupied: [],
  });

  assert.ok(result.match, `expected a match, got ${JSON.stringify(result)}`);
  assert.ok(Math.abs(result.match.x - 300) <= 2, `expected x~300, got ${result.match.x}`);
  assert.ok(Math.abs(result.match.y - 250) <= 2, `expected y~250, got ${result.match.y}`);
  assert.equal(result.match.rotation, 45);
  assert.ok(result.match.score < 0.1, `expected a low score, got ${result.match.score}`);
});

test('blotch_match.py finds the true rotated match for a non-rectangular (triangular) part', () => {
  // Regression coverage for the rotate_template_normalized() bug: for a
  // non-rectangular part, the part's own rotated-normalized origin does not
  // coincide with its bounding-rectangle crop's rotated-normalized origin.
  // This part's rotated-vs-rectangle offset at 120 degrees is a non-zero
  // (30, 0) -- see test/fixtures/generate-blotch-triangle-fixture.py --
  // so a match report that ignores the offset would be off by 30px.
  const TRIANGLE_PART_POLYGON = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 0, y: 40 }];

  const result = runMatch({
    imagePath: TRIANGLE_CANVAS,
    calibration: CALIBRATION,
    searchRegion: FULL_REGION,
    partPolygon: TRIANGLE_PART_POLYGON,
    referencePlacement: { x: 50, y: 50, rotation: 0 },
    occupied: [],
  });

  assert.ok(result.match, `expected a match, got ${JSON.stringify(result)}`);
  assert.equal(result.match.rotation, 120);
  assert.ok(Math.abs(result.match.x - 300) <= 2, `expected x~300, got ${result.match.x}`);
  assert.ok(Math.abs(result.match.y - 250) <= 2, `expected y~250, got ${result.match.y}`);
  assert.ok(result.match.score < 0.1, `expected a low score, got ${result.match.score}`);

  // Precise check per the review's exact acceptance criterion: feeding
  // match.x/y/rotation into the same rotate -> normalize -> translate
  // transform the browser uses (placedPolygon) must reproduce the polygon
  // at the exact position the fixture placed it -- not just "a match was
  // found somewhere nearby".
  const expected = placedPolygon({ polygon: TRIANGLE_PART_POLYGON }, { x: 300, y: 250, rotation: 120 });
  const actual = placedPolygon({ polygon: TRIANGLE_PART_POLYGON }, result.match);
  for (let i = 0; i < expected.length; i++) {
    assert.ok(
      Math.abs(actual[i].x - expected[i].x) <= 2,
      `vertex ${i} x mismatch: ${actual[i].x} vs expected ${expected[i].x}`
    );
    assert.ok(
      Math.abs(actual[i].y - expected[i].y) <= 2,
      `vertex ${i} y mismatch: ${actual[i].y} vs expected ${expected[i].y}`
    );
  }
});

test('blotch_match.py returns no match when the only good spot is already occupied', () => {
  const result = runMatch({
    imagePath: CANVAS,
    calibration: CALIBRATION,
    searchRegion: FULL_REGION,
    partPolygon: PART_POLYGON,
    referencePlacement: { x: 100, y: 100, rotation: 0 },
    occupied: [
      { polygon: PART_POLYGON, x: 300, y: 250, rotation: 45 },
    ],
  });

  assert.equal(result.match, null);
  assert.match(result.reason, /No sufficiently similar/);
});

test('blotch_match.py returns no match when the search region has no free room', () => {
  const result = runMatch({
    imagePath: CANVAS,
    calibration: CALIBRATION,
    searchRegion: { roiX: 90, roiY: 90, roiWidth: 70, roiHeight: 50 },
    partPolygon: PART_POLYGON,
    referencePlacement: { x: 100, y: 100, rotation: 0 },
    occupied: [],
  });

  assert.equal(result.match, null);
});

test('blotch_match.py fails clearly on a malformed payload', () => {
  assert.throws(() => runMatch({ imagePath: CANVAS }), /Missing required field/);
});

test('blotch_match.py fails clearly when the reference placement is out of bounds', () => {
  assert.throws(
    () =>
      runMatch({
        imagePath: CANVAS,
        calibration: CALIBRATION,
        searchRegion: FULL_REGION,
        partPolygon: PART_POLYGON,
        referencePlacement: { x: 480, y: 480, rotation: 0 },
        occupied: [],
      }),
    /falls outside the photo bounds/
  );
});
