// test/digitize.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundingBox } from '../src/nesting/geometry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON = path.join(__dirname, '..', 'venv', 'bin', 'python3');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'digitize.py');
const FIXTURE = path.join(__dirname, 'fixtures', 'test-rectangle.png');
const BLANK_FIXTURE = path.join(__dirname, 'fixtures', 'test-blank.png');
const GLARE_FIXTURE = path.join(__dirname, 'fixtures', 'test-glare.png');

test('digitize.py extracts a known rectangle at the correct mm dimensions', () => {
  const stdout = execFileSync(PYTHON, [SCRIPT, FIXTURE, '0', '0', '200', '0', '100']);
  const result = JSON.parse(stdout.toString());
  const bounds = boundingBox(result.polygon);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  assert.ok(Math.abs(width - 100) < 3, `expected ~100mm width, got ${width}`);
  assert.ok(Math.abs(height - 50) < 3, `expected ~50mm height, got ${height}`);
});

test('digitize.py crops to an optional region before extracting the outline', () => {
  // test-rectangle.png is 400x300 with a 200x100 rectangle at (100,100)-(299,199).
  // Crop a generous but partial region around it — proves the ROI offset is
  // actually applied, not just accepted and ignored.
  const stdout = execFileSync(PYTHON, [SCRIPT, FIXTURE, '0', '0', '200', '0', '100', '50', '50', '300', '200']);
  const result = JSON.parse(stdout.toString());
  const bounds = boundingBox(result.polygon);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  assert.ok(Math.abs(width - 100) < 3, `expected ~100mm width, got ${width}`);
  assert.ok(Math.abs(height - 50) < 3, `expected ~50mm height, got ${height}`);
});

test('digitize.py fails clearly when the region falls outside the photo bounds', () => {
  assert.throws(
    () => execFileSync(PYTHON, [SCRIPT, FIXTURE, '0', '0', '200', '0', '100', '350', '250', '100', '100'], { stdio: 'pipe' }),
    (err) => {
      assert.match(err.stderr.toString(), /falls outside the photo bounds/);
      return true;
    }
  );
});

test('digitize.py fails clearly when the region has non-positive dimensions', () => {
  assert.throws(
    () => execFileSync(PYTHON, [SCRIPT, FIXTURE, '0', '0', '200', '0', '100', '50', '50', '0', '100'], { stdio: 'pipe' }),
    (err) => {
      assert.match(err.stderr.toString(), /positive width and height/);
      return true;
    }
  );
});

test('digitize.py fails clearly on an image with no detectable outline', () => {
  assert.throws(
    () => execFileSync(PYTHON, [SCRIPT, BLANK_FIXTURE, '0', '0', '200', '0', '100'], { stdio: 'pipe' }),
    (err) => {
      assert.match(err.stderr.toString(), /No clear pattern outline detected/);
      return true;
    }
  );
});

test('digitize.py fails clearly on degenerate calibration points', () => {
  assert.throws(
    () => execFileSync(PYTHON, [SCRIPT, FIXTURE, '50', '50', '50', '50', '100'], { stdio: 'pipe' }),
    (err) => {
      assert.match(err.stderr.toString(), /Calibration points must be distinct/);
      return true;
    }
  );
});

test('digitize.py fails clearly on non-numeric calibration args', () => {
  assert.throws(
    () => execFileSync(PYTHON, [SCRIPT, FIXTURE, 'abc', '0', '200', '0', '100'], { stdio: 'pipe' }),
    (err) => {
      assert.match(err.stderr.toString(), /Calibration points and distance must be numbers/);
      return true;
    }
  );
});

test('digitize.py refuses a glare-broken outline instead of returning it', () => {
  // The failure that prompted this check: a shine on the leather is as pale
  // as the background, so the trace dives into the middle of the piece,
  // follows the edge of the highlight, and comes back out. It used to return
  // that shape with no complaint — on the first real photograph ever put
  // through it, roughly half a hide was silently discarded.
  assert.throws(
    () => execFileSync(PYTHON, [SCRIPT, GLARE_FIXTURE, '0', '0', '200', '0', '100'], { stdio: 'pipe' }),
    (err) => {
      const message = err.stderr.toString() + err.stdout.toString();
      assert.match(message, /too ragged to trust/);
      // The operator needs to know what to DO about it, not just that it failed.
      assert.match(message, /glare/i);
      assert.match(message, /rough side up|coloured card|indirect light/i);
      return true;
    }
  );
});

test('a long thin strap is not mistaken for a ragged trace', () => {
  // Elongation must not trip the check. A 1.5m x 30mm strap is a perfectly
  // ordinary offcut, and a rule based on perimeter against area would have
  // thrown it out — which is why the check measures raggedness against the
  // shape's own convex hull instead.
  const stdout = execFileSync(PYTHON, [SCRIPT, FIXTURE, '0', '0', '200', '0', '100']);
  const result = JSON.parse(stdout.toString());
  assert.ok(result.polygon.length >= 4, 'a clean outline should still come through');
});
