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
const RAGGED_FIXTURE = path.join(__dirname, 'fixtures', 'test-ragged.png');
const EDGE_FIXTURE = path.join(__dirname, 'fixtures', 'test-edge-piece.png');
const SPECKLED_FIXTURE = path.join(__dirname, 'fixtures', 'test-speckled.png');

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

test('a highlight across the piece no longer breaks the outline', () => {
  // A real photograph failed exactly this way: the shine on the leather was
  // as pale as the bench, so a brightness threshold dived into the middle of
  // the piece and traced the edge of the highlight instead. Working on the
  // colour axes as well recovers it, because a highlight changes how bright
  // something is far more than it changes its hue.
  const stdout = execFileSync(PYTHON, [SCRIPT, GLARE_FIXTURE, '0', '0', '200', '0', '100']);
  const polygon = JSON.parse(stdout.toString()).polygon;
  const bounds = boundingBox(polygon);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  // The fixture's dark block is 280x180px against a 200px = 100mm baseline.
  assert.ok(Math.abs(width - 140) < 8, `expected ~140mm across, got ${width.toFixed(1)}`);
  assert.ok(Math.abs(height - 90) < 8, `expected ~90mm tall, got ${height.toFixed(1)}`);
});

test('an outline too ragged to be a real edge is still refused', () => {
  // The guard behind the recovery above. When no channel can produce a sane
  // outline, returning the best of a bad set would hand the operator a shape
  // that is not their leather — which is how half a hide got silently
  // discarded before any of this existed.
  assert.throws(
    () => execFileSync(PYTHON, [SCRIPT, RAGGED_FIXTURE, '0', '0', '200', '0', '100'], { stdio: 'pipe' }),
    (err) => {
      const message = err.stderr.toString() + err.stdout.toString();
      assert.match(message, /too ragged to trust/);
      // It has to say what to DO, not just that it failed.
      assert.match(message, /rough side up|coloured card|indirect light/i);
      return true;
    }
  );
});

test('the bench is not mistaken for the piece when the piece runs off an edge', () => {
  // Otsu returns the bench as readily as the piece. Normally the bench wraps
  // right around and its outline IS the frame, which the area cap already
  // rejects. But when the piece runs off one edge the bench becomes a
  // C-shape — smaller than the frame, larger than the piece — and picking
  // the largest candidate chooses it. A real photograph did exactly this,
  // with the leather lying against the tape measure, and reported a 43-inch
  // hide. The bench is ruled out by reaching three or more sides of the
  // frame; a piece against one edge reaches one, or two in a corner.
  const stdout = execFileSync(PYTHON, [SCRIPT, EDGE_FIXTURE, '0', '0', '200', '0', '100']);
  const bounds = boundingBox(JSON.parse(stdout.toString()).polygon);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  // The piece is 250x220px against a 200px = 100mm baseline: 125 x 110mm.
  // The bench would come back around 200mm wide.
  assert.ok(width < 150, `traced ${width.toFixed(0)}mm wide — that is the bench, not the piece`);
  assert.ok(Math.abs(height - 110) < 8, `expected ~110mm tall, got ${height.toFixed(1)}`);
});

test('a speckled edge is cleaned up rather than traced bead by bead', () => {
  // Real edges come back beaded, and every bead is a vertex that gets paid
  // for again in the nester, where cost between two placed parts scales with
  // the product of their vertex counts. On the real photograph, cleaning the
  // edge first took the same outline from 1,865 points down to 513.
  //
  // Without that cleanup this fixture is not merely noisier — it is refused
  // outright as too ragged to trust.
  const stdout = execFileSync(PYTHON, [SCRIPT, SPECKLED_FIXTURE, '0', '0', '200', '0', '100']);
  const polygon = JSON.parse(stdout.toString()).polygon;
  const bounds = boundingBox(polygon);

  // The block is 280x180px against a 200px = 100mm baseline — 140 x 90mm —
  // and the beads straddle the edge by up to 5mm, so the traced shape lands
  // slightly proud of that. What matters is that it is the block's shape and
  // not something the noise invented.
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  assert.ok(width > 135 && width < 158, `width ${width.toFixed(1)}mm`);
  assert.ok(height > 85 && height < 108, `height ${height.toFixed(1)}mm`);
  assert.ok(polygon.length < 900, `${polygon.length} points for a rectangle`);
});
