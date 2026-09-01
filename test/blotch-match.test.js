import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON = path.join(__dirname, '..', 'venv', 'bin', 'python3');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'blotch_match.py');
const CANVAS = path.join(__dirname, 'fixtures', 'test-blotch-canvas.png');

// mm_per_px = 1: (0,0)-(100,0) over 100mm.
const CALIBRATION = { p1x: 0, p1y: 0, p2x: 100, p2y: 0, realDistanceMm: 100 };
const DIE_POLYGON = [
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
    diePolygon: DIE_POLYGON,
    referencePlacement: { x: 100, y: 100, rotation: 0 },
    occupied: [],
  });

  assert.ok(result.match, `expected a match, got ${JSON.stringify(result)}`);
  assert.ok(Math.abs(result.match.x - 300) <= 2, `expected x~300, got ${result.match.x}`);
  assert.ok(Math.abs(result.match.y - 250) <= 2, `expected y~250, got ${result.match.y}`);
  assert.equal(result.match.rotation, 45);
  assert.ok(result.match.score < 0.1, `expected a low score, got ${result.match.score}`);
});

test('blotch_match.py returns no match when the only good spot is already occupied', () => {
  const result = runMatch({
    imagePath: CANVAS,
    calibration: CALIBRATION,
    searchRegion: FULL_REGION,
    diePolygon: DIE_POLYGON,
    referencePlacement: { x: 100, y: 100, rotation: 0 },
    occupied: [
      { polygon: DIE_POLYGON, x: 300, y: 250, rotation: 45 },
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
    diePolygon: DIE_POLYGON,
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
        diePolygon: DIE_POLYGON,
        referencePlacement: { x: 480, y: 480, rotation: 0 },
        occupied: [],
      }),
    /falls outside the photo bounds/
  );
});
