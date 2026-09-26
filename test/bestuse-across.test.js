import test from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';

globalThis.ClipperLib = ClipperLib;

import { runAcrossHides } from '../src/bestuse/across.js';

const rect = (w, h) => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];

const hide = (id, w, h, extra = {}) => ({
  id,
  outlinePolygon: rect(w, h),
  remainingAreaPct: 100,
  ...extra,
});

const component = (id, w, h, extra = {}) => ({
  id,
  name: id,
  polygon: rect(w, h),
  allowedRotations: [0],
  ...extra,
});

const opts = { method: 'laser', laserClearanceMm: 0, gridStepMm: 5, orientations: 1 };

test('an order is filled off one hide when it fits', () => {
  const result = runAcrossHides({
    hides: [hide('h1', 200, 200)],
    components: [component('strap', 40, 20)],
    quantities: { strap: 3 },
    ...opts,
  });

  assert.equal(result.error, null);
  assert.equal(result.layouts.length, 1);
  assert.equal(result.placed.strap, 3);
  assert.deepEqual(result.shortfall, {}, 'a satisfied order reports no shortfall');
  assert.ok(result.layouts[0].utilization > 0);
});

test('an order too big for one hide spills onto the next', () => {
  const result = runAcrossHides({
    hides: [hide('small', 50, 50), hide('big', 300, 300)],
    components: [component('panel', 45, 45)],
    quantities: { panel: 4 },
    ...opts,
  });

  assert.deepEqual(result.shortfall, {});
  assert.equal(result.layouts.length, 2);
  assert.equal(result.placed.panel, 4);
  // Smallest first, so the offcut is consumed before the whole skin.
  assert.equal(result.layouts[0].hideId, 'small');
});

test('what could not be cut is reported per component, as a shortfall', () => {
  const result = runAcrossHides({
    hides: [hide('h1', 100, 100)],
    components: [component('panel', 90, 90)],
    quantities: { panel: 3 },
    ...opts,
  });

  assert.equal(result.placed.panel, 1);
  assert.equal(result.shortfall.panel, 2, 'asked for three, got one, two short');
});

test('a hide with no outline is skipped and said to be skipped', () => {
  const result = runAcrossHides({
    hides: [{ id: 'unmeasured', outlinePolygon: null }, hide('good', 200, 200)],
    components: [component('strap', 40, 20)],
    quantities: { strap: 2 },
    ...opts,
  });

  assert.equal(result.placed.strap, 2);
  assert.deepEqual(result.skipped, [{ hideId: 'unmeasured', reason: 'no-outline' }]);
});

test('a part-cut hide is skipped, because its outline no longer describes it', () => {
  // It still carries its ORIGINAL outline, so a layout would place parts over
  // leather that has already been cut away.
  const result = runAcrossHides({
    hides: [hide('part-cut', 300, 300, { remainingAreaPct: 40 }), hide('whole', 200, 200)],
    components: [component('strap', 40, 20)],
    quantities: { strap: 1 },
    ...opts,
  });

  assert.equal(result.layouts[0].hideId, 'whole');
  assert.deepEqual(result.skipped, [{ hideId: 'part-cut', reason: 'partially-cut' }]);
});

test('a component is only cut from hides it is allowed on', () => {
  const result = runAcrossHides({
    hides: [
      hide('python', 200, 200, { species: 'python' }),
      hide('caiman', 200, 200, { species: 'caiman' }),
    ],
    components: [component('caiman-only', 40, 20, { allowedSpecies: ['caiman'] })],
    quantities: { 'caiman-only': 2 },
    ...opts,
  });

  assert.deepEqual(result.shortfall, {});
  assert.equal(result.layouts.length, 1);
  assert.equal(result.layouts[0].hideId, 'caiman');
});

test('under die cutting, a component with no die is reported separately from a bad fit', () => {
  // "Buy a die" and "find a bigger hide" are different problems.
  const result = runAcrossHides({
    hides: [hide('h1', 300, 300)],
    components: [component('untooled', 40, 20)],
    quantities: { untooled: 2 },
    method: 'die',
    gridStepMm: 5,
    orientations: 1,
  });

  assert.deepEqual(result.noDie, ['untooled']);
  assert.equal(result.layouts.length, 0);
  assert.equal(result.shortfall.untooled, 2);
});

test('counts are keyed by component, not by part id', () => {
  const result = runAcrossHides({
    hides: [hide('h1', 300, 300)],
    components: [component('a', 40, 20), component('b', 30, 30)],
    quantities: { a: 2, b: 3 },
    ...opts,
  });

  const counts = result.layouts[0].counts;
  assert.deepEqual(Object.keys(counts).sort(), ['a', 'b']);
  assert.equal(counts.a, 2);
  assert.equal(counts.b, 3);
});

test('naming no quantities is an error, not an empty run', () => {
  const result = runAcrossHides({
    hides: [hide('h1', 200, 200)],
    components: [component('strap', 40, 20)],
    quantities: {},
    ...opts,
  });
  assert.match(result.error, /how many/i);
  assert.deepEqual(result.layouts, []);
});

test('a library with nothing nestable in it says so', () => {
  const result = runAcrossHides({
    hides: [{ id: 'unmeasured', outlinePolygon: null }],
    components: [component('strap', 40, 20)],
    quantities: { strap: 1 },
    ...opts,
  });
  assert.match(result.error, /no hide/i);
  assert.equal(result.skipped.length, 1);
});
