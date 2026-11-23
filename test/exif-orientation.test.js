// test/exif-orientation.test.js
//
// Every coordinate these scripts receive is computed in the browser from
// img.naturalWidth/naturalHeight, which is the EXIF-corrected frame. These
// tests pin the scripts to that same frame.
//
// test-exif-rotated.jpg stores a 400x300 landscape photo holding a 200x100
// rectangle, and carries EXIF Orientation=6. Read upright — the way a browser
// renders it — it is a 300x400 portrait photo holding a 100x200 rectangle.
// Those two readings are a quarter turn apart, so any script that reads the
// stored pixels instead of the displayed ones fails these outright rather
// than drifting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundingBox } from '../src/nesting/geometry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON = path.join(__dirname, '..', 'venv', 'bin', 'python3');
const scriptPath = (name) => path.join(__dirname, '..', 'scripts', name);
const ROTATED = path.join(__dirname, 'fixtures', 'test-exif-rotated.jpg');

// 100 px declared as 100 mm, so one pixel is one millimetre and the numbers
// below can be read as pixels.
const CALIB = ['0', '0', '100', '0', '100'];

test('digitize.py reads a rotated photo in the frame the browser displayed', () => {
  const stdout = execFileSync(PYTHON, [scriptPath('digitize.py'), ROTATED, ...CALIB]);
  const { polygon } = JSON.parse(stdout.toString());
  const bounds = boundingBox(polygon);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  // Upright, the rectangle is 100 wide and 200 tall. Reading the stored
  // pixels instead would swap these.
  assert.ok(Math.abs(width - 100) < 5, `expected ~100mm width, got ${width.toFixed(1)}`);
  assert.ok(Math.abs(height - 200) < 5, `expected ~200mm height, got ${height.toFixed(1)}`);
  assert.ok(height > width, 'the piece is taller than it is wide once the photo is upright');
});

// The region an operator drags is in the displayed frame. This one is tall and
// narrow: it fits inside the 300x400 upright photo and runs off the bottom of
// the 400x300 stored one, so a script reading stored pixels refuses a region
// the operator just successfully dragged.
const TALL_REGION = ['20', '40', '260', '340'];

test('digitize.py accepts a region that is only valid in the displayed frame', () => {
  const stdout = execFileSync(PYTHON, [scriptPath('digitize.py'), ROTATED, ...CALIB, ...TALL_REGION]);
  const { polygon } = JSON.parse(stdout.toString());
  const bounds = boundingBox(polygon);
  const height = bounds.maxY - bounds.minY;
  assert.ok(height > bounds.maxX - bounds.minX, 'piece should still read as taller than wide');
});

test('colour_sample.py accepts a region that is only valid in the displayed frame', () => {
  const stdout = execFileSync(PYTHON, [scriptPath('colour_sample.py'), ROTATED, ...TALL_REGION]);
  const result = JSON.parse(stdout.toString());
  assert.ok(Number.isFinite(result.l), 'expected a lightness value back');
});

// skin_signature.py and blotch_match.py both refuse this fixture on their own
// merits — it is a flat rectangle with no periodic scale pattern and nothing
// to match against, which is correct behaviour and not what is under test.
// What IS under test is the frame: they must not reject the region for being
// out of bounds, because it is in bounds in the picture the operator saw.
const refusalOf = (args, input) => {
  try {
    execFileSync(PYTHON, args, input === undefined ? { stdio: 'pipe' } : { input, stdio: 'pipe' });
    return '';
  } catch (err) {
    return err.stderr.toString();
  }
};

// A refusal that happened before the script ever looked at the photo tells us
// nothing about which frame it read, and would let these tests pass for the
// wrong reason. Fail loudly on those instead.
const assertReachedTheImage = (stderr) => {
  assert.doesNotMatch(
    stderr,
    /parse JSON|Missing required field|Usage:|must have at least|must be distinct|positive width/,
    `script refused before reading the photo, so this test proves nothing: ${stderr.trim()}`,
  );
};

test('skin_signature.py does not reject a displayed-frame region as out of bounds', () => {
  const stderr = refusalOf([scriptPath('skin_signature.py'), ROTATED, ...TALL_REGION, ...CALIB]);
  assertReachedTheImage(stderr);
  assert.doesNotMatch(stderr, /falls outside the photo bounds/);
});

test('blotch_match.py does not reject a displayed-frame region as out of bounds', () => {
  // This one takes a JSON payload on stdin, not arguments. Getting that wrong
  // made an earlier version of this test pass against the bug it was meant to
  // catch, because the script died on the payload long before it opened the
  // photo — hence assertReachedTheImage.
  const payload = JSON.stringify({
    imagePath: ROTATED,
    calibration: { p1x: 0, p1y: 0, p2x: 100, p2y: 0, realDistanceMm: 100 },
    searchRegion: { roiX: 20, roiY: 40, roiWidth: 260, roiHeight: 340 },
    partPolygon: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }],
    referencePlacement: { x: 0, y: 0, rotation: 0 },
  });
  const stderr = refusalOf([scriptPath('blotch_match.py')], payload);
  assertReachedTheImage(stderr);
  assert.doesNotMatch(stderr, /falls outside the photo bounds/);
});
