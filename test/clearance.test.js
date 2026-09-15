// test/clearance.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveClearances,
  DEFAULT_LASER_CLEARANCE_MM,
  DEFAULT_DIE_CLEARANCE_MM,
} from '../src/nesting/clearance.js';

// Three components: two tooled, one not.
const PARTS = [
  { id: 'strap', dieClearanceMm: 8 },
  { id: 'keeper', dieClearanceMm: 6 },
  { id: 'pocket', dieClearanceMm: null },
];

test('laser gives every part the same clearance and ignores dies', () => {
  const { parts, noDie } = resolveClearances(PARTS, {
    method: 'laser',
    laserClearanceMm: 1.5,
  });

  assert.deepEqual(parts.map((p) => p.clearanceMm), [1.5, 1.5, 1.5]);
  assert.deepEqual(parts.map((p) => p.id), ['strap', 'keeper', 'pocket']);
  assert.deepEqual(noDie, [], 'a laser job needs no dies, so nothing is untooled');
});

test('laser falls back to DEFAULT_LASER_CLEARANCE_MM', () => {
  const { parts } = resolveClearances(PARTS, { method: 'laser' });
  assert.equal(parts[0].clearanceMm, DEFAULT_LASER_CLEARANCE_MM);
});

test('omitting options entirely defaults to a laser job', () => {
  const { parts, noDie } = resolveClearances(PARTS);
  assert.equal(parts.length, 3);
  assert.equal(parts[0].clearanceMm, DEFAULT_LASER_CLEARANCE_MM);
  assert.deepEqual(noDie, []);
});

test('die gives each component its own die clearance', () => {
  const { parts } = resolveClearances(PARTS, { method: 'die' });

  assert.deepEqual(parts.map((p) => p.id), ['strap', 'keeper']);
  assert.deepEqual(parts.map((p) => p.clearanceMm), [8, 6]);
});

test('die excludes an untooled component and reports it in noDie', () => {
  const { parts, noDie } = resolveClearances(PARTS, { method: 'die' });

  assert.deepEqual(noDie, ['pocket']);
  assert.ok(!parts.some((p) => p.id === 'pocket'), 'excluded from the layout');
});

test('a component missing the field entirely counts as untooled', () => {
  // Records predating this feature have no dieClearanceMm key at all.
  const { parts, noDie } = resolveClearances([{ id: 'legacy' }], { method: 'die' });

  assert.deepEqual(noDie, ['legacy']);
  assert.equal(parts.length, 0);
});

test('a dieClearanceMm of 0 is a real die, not a missing one', () => {
  // A die needing no margin beyond its cut line. A falsy check here would
  // wrongly report this component as untooled and drop it from every job.
  const { parts, noDie } = resolveClearances([{ id: 'flush', dieClearanceMm: 0 }], {
    method: 'die',
  });

  assert.deepEqual(noDie, []);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].clearanceMm, 0);
});

test('an unrecognised method throws rather than guessing', () => {
  // Silently defaulting a typo to laser would cut a die job with laser
  // spacing, on material that cannot be un-cut.
  assert.throws(() => resolveClearances(PARTS, { method: 'waterjet' }), /waterjet/);
});

test('the input parts are not mutated', () => {
  const input = [{ id: 'a', dieClearanceMm: 8 }];
  resolveClearances(input, { method: 'die' });
  assert.equal(input[0].clearanceMm, undefined);
});

test('DEFAULT_DIE_CLEARANCE_MM is a UI prefill, never applied as a fallback', () => {
  // Half the operator's 5mm between-cuts figure, because clearances are not
  // shared — two identical dies end up 2x this far apart.
  assert.equal(DEFAULT_DIE_CLEARANCE_MM, 2.5);

  // An untooled component is excluded, NOT silently given 8mm — otherwise
  // the layout would claim tooling the shop does not own.
  const { parts, noDie } = resolveClearances([{ id: 'untooled' }], { method: 'die' });
  assert.deepEqual(noDie, ['untooled']);
  assert.equal(parts.length, 0);
});
