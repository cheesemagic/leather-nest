import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON = path.join(__dirname, '..', 'venv', 'bin', 'python3');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'colour_sample.py');
const BROWN = path.join(__dirname, 'fixtures', 'test-colour-brown.png');
const BLUE = path.join(__dirname, 'fixtures', 'test-colour-blue.png');
const FULL_ROI = ['0', '0', '100', '100'];

function sample(imagePath) {
  const stdout = execFileSync(PYTHON, [SCRIPT, imagePath, ...FULL_ROI]);
  return JSON.parse(stdout.toString());
}

function deltaE76(a, b) {
  return Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b);
}

test('colour_sample.py reports the same colour twice as near-zero delta', () => {
  const first = sample(BROWN);
  const second = sample(BROWN);
  assert.ok(deltaE76(first, second) < 0.5, `expected ~0 delta, got ${deltaE76(first, second)}`);
});

test('colour_sample.py tells a clearly different colour apart', () => {
  const brown = sample(BROWN);
  const blue = sample(BLUE);
  assert.ok(deltaE76(brown, blue) > 20, `expected a large delta, got ${deltaE76(brown, blue)}`);
});

test('colour_sample.py fails clearly on a region outside the photo bounds', () => {
  assert.throws(
    () => execFileSync(PYTHON, [SCRIPT, BROWN, '0', '0', '9999', '9999'], { stdio: 'pipe' }),
    (err) => {
      assert.match(err.stderr.toString(), /outside the photo bounds/);
      return true;
    }
  );
});
