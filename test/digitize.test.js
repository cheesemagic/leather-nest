// test/digitize.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON = path.join(__dirname, '..', 'venv', 'bin', 'python3');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'digitize.py');
const FIXTURE = path.join(__dirname, 'fixtures', 'test-rectangle.png');
const BLANK_FIXTURE = path.join(__dirname, 'fixtures', 'test-blank.png');

function boundingBox(polygon) {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

test('digitize.py extracts a known rectangle at the correct mm dimensions', () => {
  const stdout = execFileSync(PYTHON, [SCRIPT, FIXTURE, '0', '0', '200', '0', '100']);
  const result = JSON.parse(stdout.toString());
  const bounds = boundingBox(result.polygon);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  assert.ok(Math.abs(width - 100) < 3, `expected ~100mm width, got ${width}`);
  assert.ok(Math.abs(height - 50) < 3, `expected ~50mm height, got ${height}`);
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
