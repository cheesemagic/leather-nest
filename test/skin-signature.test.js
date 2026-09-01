import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON = path.join(__dirname, '..', 'venv', 'bin', 'python3');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'skin_signature.py');
const GRID_10 = path.join(__dirname, 'fixtures', 'test-grid-10px.png');
const GRID_20 = path.join(__dirname, 'fixtures', 'test-grid-20px.png');
const GRID_COARSE = path.join(__dirname, 'fixtures', 'test-grid-80px.png');
const GRID_10_ROTATED = path.join(__dirname, 'fixtures', 'test-grid-10px-rotated.png');
const BLANK_FIXTURE = path.join(__dirname, 'fixtures', 'test-blank.png');

// Full-image ROI, calibration chosen so mm_per_px = 1 (0,0)-(100,0) over
// 100mm — so dominantWavelengthMm should equal the grid's pixel spacing.
const ARGS_1MM_PER_PX = ['0', '0', '256', '256', '0', '0', '100', '0', '100'];

function runSignature(imagePath, args) {
  const stdout = execFileSync(PYTHON, [SCRIPT, imagePath, ...args]);
  return JSON.parse(stdout.toString());
}

test('skin_signature.py measures a known 10px grid spacing within tolerance', () => {
  const result = runSignature(GRID_10, ARGS_1MM_PER_PX);
  assert.ok(Math.abs(result.dominantWavelengthMm - 10) < 2, `expected ~10mm, got ${result.dominantWavelengthMm}`);
  assert.equal(result.radialSpectrum.length, 40);
});

test('skin_signature.py measures a known 20px grid spacing within tolerance', () => {
  const result = runSignature(GRID_20, ARGS_1MM_PER_PX);
  assert.ok(Math.abs(result.dominantWavelengthMm - 20) < 3, `expected ~20mm, got ${result.dominantWavelengthMm}`);
});

test('skin_signature.py discriminates a 10px grid from a 20px grid', () => {
  const result10 = runSignature(GRID_10, ARGS_1MM_PER_PX);
  const result20 = runSignature(GRID_20, ARGS_1MM_PER_PX);
  assert.ok(Math.abs(result10.dominantWavelengthMm - result20.dominantWavelengthMm) > 5);
});

test('skin_signature.py is rotation-invariant for the same grid spacing', () => {
  const result = runSignature(GRID_10, ARGS_1MM_PER_PX);
  const resultRotated = runSignature(GRID_10_ROTATED, ARGS_1MM_PER_PX);
  assert.ok(
    Math.abs(result.dominantWavelengthMm - resultRotated.dominantWavelengthMm) < 2,
    `expected close match, got ${result.dominantWavelengthMm} vs ${resultRotated.dominantWavelengthMm}`
  );
});

test('skin_signature.py fails clearly on a low-contrast (blank) region', () => {
  assert.throws(
    () => execFileSync(PYTHON, [SCRIPT, BLANK_FIXTURE, ...ARGS_1MM_PER_PX], { stdio: 'pipe' }),
    (err) => {
      assert.match(err.stderr.toString(), /too little contrast/);
      return true;
    }
  );
});

test('skin_signature.py fails clearly on a too-small region', () => {
  assert.throws(
    () => execFileSync(PYTHON, [SCRIPT, GRID_10, '0', '0', '10', '10', '0', '0', '100', '0', '100'], { stdio: 'pipe' }),
    (err) => {
      assert.match(err.stderr.toString(), /too small/);
      return true;
    }
  );
});

test('skin_signature.py fails clearly when the pattern is too coarse to resolve in the window', () => {
  // test-grid-80px.png fits only ~3.2 periods in its 256px window — a
  // genuine periodic pattern, but too coarse for this analysis window,
  // deterministically reproducing the near-DC floor-clamping found
  // against real crocodile photos (see skin_signature.py's MIN_R comment).
  assert.throws(
    () => execFileSync(PYTHON, [SCRIPT, GRID_COARSE, ...ARGS_1MM_PER_PX], { stdio: 'pipe' }),
    (err) => {
      assert.match(err.stderr.toString(), /doesn't show a clear enough periodic pattern/);
      return true;
    }
  );
});

test('skin_signature.py fails clearly on degenerate calibration points', () => {
  assert.throws(
    () => execFileSync(PYTHON, [SCRIPT, GRID_10, '0', '0', '256', '256', '50', '50', '50', '50', '100'], { stdio: 'pipe' }),
    (err) => {
      assert.match(err.stderr.toString(), /Calibration points must be distinct/);
      return true;
    }
  );
});

test('skin_signature.py fails clearly on non-numeric arguments', () => {
  assert.throws(
    () => execFileSync(PYTHON, [SCRIPT, GRID_10, '0', '0', '256', '256', '0', '0', 'abc', '0', '100'], { stdio: 'pipe' }),
    (err) => {
      assert.match(err.stderr.toString(), /must be numbers/);
      return true;
    }
  );
});
