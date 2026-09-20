// test/kerf.test.js
// Kerf: the width of material the beam destroys. Cutting exactly on the drawn
// line returns a piece half a kerf undersize all the way round, so the cut
// moves outward by that much and the piece left behind is the size drawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';

globalThis.ClipperLib = ClipperLib;

import {
  kerfAllowanceMm,
  clearanceFor,
  resolveClearances,
  DEFAULT_KERF_MM,
  DEFAULT_LASER_CLEARANCE_MM,
} from '../src/nesting/clearance.js';
import { exportToSVG } from '../src/svg/export.js';
import { boundingBox } from '../src/nesting/geometry.js';

const rect = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const PART = { id: 'p', polygon: rect(50, 50), allowedRotations: [0], dieClearanceMm: 2.5 };

test('kerf defaults to zero, because nobody has measured it', () => {
  // Not a placeholder for a small number. A guessed kerf resizes every piece
  // the program ever cuts, in a direction nobody notices until something
  // does not fit.
  assert.equal(DEFAULT_KERF_MM, 0);
  assert.equal(kerfAllowanceMm({ method: 'laser' }), 0);
});

test('the allowance is half the kerf, since the beam eats both sides', () => {
  assert.equal(kerfAllowanceMm({ method: 'laser', kerfMm: 0.2 }), 0.1);
  assert.equal(kerfAllowanceMm({ method: 'laser', kerfMm: 0.35 }), 0.175);
});

test('die cutting has no kerf — a steel rule shears, it does not burn', () => {
  assert.equal(kerfAllowanceMm({ method: 'die', kerfMm: 0.2 }), 0);
  assert.equal(clearanceFor(PART, { method: 'die', kerfMm: 0.2 }), 2.5);
});

test('a kerf-compensated piece reserves more room on the hide', () => {
  const without = clearanceFor(PART, { method: 'laser' });
  const with02 = clearanceFor(PART, { method: 'laser', kerfMm: 0.2 });
  assert.equal(without, DEFAULT_LASER_CLEARANCE_MM);
  assert.equal(with02, DEFAULT_LASER_CLEARANCE_MM + 0.1);
});

test('two adjacent pieces end up a full kerf further apart, not half', () => {
  // Clearances are not shared: each part reserves its own margin, so half a
  // kerf each is exactly one kerf between their cut lines — which is the
  // material the two cuts actually remove between them.
  const { parts } = resolveClearances([PART, { ...PART, id: 'q' }], {
    method: 'laser',
    laserClearanceMm: 1.0,
    kerfMm: 0.3,
  });
  for (const part of parts) assert.equal(part.clearanceMm, 1.15);
  const between = parts[0].clearanceMm + parts[1].clearanceMm;
  assert.equal(between, 2.0 + 0.3, 'the extra gap should be one whole kerf');
});

test('resolveClearances and clearanceFor agree, so the estimate cannot drift', () => {
  for (const method of ['laser', 'die']) {
    const options = { method, laserClearanceMm: 1.0, kerfMm: 0.25 };
    const { parts } = resolveClearances([PART], options);
    assert.equal(parts[0].clearanceMm, clearanceFor(PART, options));
  }
});

test('an unmeasured or nonsense kerf is treated as none, not as a crash', () => {
  for (const kerfMm of [undefined, null, 0, -1, NaN, Infinity, 'wide']) {
    assert.equal(kerfAllowanceMm({ method: 'laser', kerfMm }), 0, `kerf ${kerfMm}`);
  }
});

// --- the exported cut path ----------------------------------------------

const SHEET = rect(200, 200);
const PLACEMENTS = [{ id: 'p', x: 10, y: 10, rotation: 0 }];
const cutBounds = (svg) => {
  // The first red polygon is the piece; the blue one is the hide outline.
  const match = /<polygon points="([^"]+)" stroke="#FF0000"/.exec(svg);
  assert.ok(match, 'no cut path in the export');
  const points = match[1].split(' ').map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    return { x, y };
  });
  return boundingBox(points);
};

test('with no kerf the cut path is exactly the drawn piece', () => {
  const svg = exportToSVG(SHEET, PLACEMENTS, [PART]);
  const b = cutBounds(svg);
  assert.equal(b.maxX - b.minX, 50);
  assert.equal(b.maxY - b.minY, 50);
});

test('with a kerf the cut path grows by half of it on every side', () => {
  // 0.4mm kerf: the line moves out 0.2mm each way, so a 50mm piece is cut at
  // 50.4mm and the beam takes it back to 50mm.
  const svg = exportToSVG(SHEET, PLACEMENTS, [PART], { method: 'laser', kerfMm: 0.4 });
  const b = cutBounds(svg);
  assert.ok(Math.abs(b.maxX - b.minX - 50.4) < 0.01, `width was ${b.maxX - b.minX}`);
  assert.ok(Math.abs(b.maxY - b.minY - 50.4) < 0.01, `height was ${b.maxY - b.minY}`);
});

test('a die-cut job exports on the line, kerf setting or not', () => {
  const svg = exportToSVG(SHEET, PLACEMENTS, [PART], { method: 'die', kerfMm: 0.4 });
  const b = cutBounds(svg);
  assert.equal(b.maxX - b.minX, 50);
});

test('the export says so when it has compensated', () => {
  const plain = exportToSVG(SHEET, PLACEMENTS, [PART]);
  const compensated = exportToSVG(SHEET, PLACEMENTS, [PART], { method: 'laser', kerfMm: 0.4 });
  assert.ok(!/kerf/i.test(plain), 'should not mention kerf when none was applied');
  assert.match(compensated, /offset 0\.200mm outward/);
});

test('the hide outline is never kerf-compensated — it is not a cut', () => {
  const svg = exportToSVG(SHEET, PLACEMENTS, [PART], { method: 'laser', kerfMm: 2 });
  const match = /<polygon points="([^"]+)" stroke="#0000FF"/.exec(svg);
  assert.ok(match);
  const points = match[1].split(' ').map((p) => {
    const [x, y] = p.split(',').map(Number);
    return { x, y };
  });
  const b = boundingBox(points);
  assert.equal(b.maxX - b.minX, 200, 'the registration outline must stay true to the hide');
});
