// test/bestuse-eligibility.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { filterEligible } from '../src/bestuse/eligibility.js';

const OUTLINE = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 400 }, { x: 0, y: 400 }];

function makeHide(overrides = {}) {
  return {
    id: 'h1', species: 'alligator', thicknessMm: 1.8,
    outlinePolygon: OUTLINE, remainingAreaPct: 100, ...overrides,
  };
}
function makeComponent(overrides = {}) {
  return {
    id: 'c1', name: 'Strap', polygon: [{ x: 0, y: 0 }, { x: 38, y: 0 }, { x: 38, y: 400 }],
    allowedSpecies: null, thicknessMinMm: null, thicknessMaxMm: null,
    valuePerPiece: 60, demand: 0, allowedRotations: [0, 90], dieClearanceMm: null,
    ...overrides,
  };
}

test('a component with no constraints is eligible with nothing unverified', () => {
  const { eligible, excluded, hideRejection } = filterEligible(makeHide(), [makeComponent()]);

  assert.equal(hideRejection, null);
  assert.deepEqual(excluded, []);
  assert.equal(eligible.length, 1);
  assert.equal(eligible[0].component.id, 'c1');
  assert.deepEqual(eligible[0].unverified, []);
});

test('allowedSpecies null means any species; a list must contain the hide species', () => {
  const hide = makeHide({ species: 'alligator' });

  const anySpecies = filterEligible(hide, [makeComponent({ allowedSpecies: null })]);
  assert.equal(anySpecies.eligible.length, 1);

  const matching = filterEligible(hide, [makeComponent({ allowedSpecies: ['calf', 'alligator'] })]);
  assert.equal(matching.eligible.length, 1);

  const wrong = filterEligible(hide, [makeComponent({ allowedSpecies: ['calf'] })]);
  assert.equal(wrong.eligible.length, 0);
  assert.deepEqual(wrong.excluded, [{ componentId: 'c1', reason: 'species' }]);
});

test('thickness bounds are checked, each side independently optional', () => {
  const hide = makeHide({ thicknessMm: 1.8 });

  const inRange = filterEligible(hide, [makeComponent({ thicknessMinMm: 1.5, thicknessMaxMm: 2.0 })]);
  assert.equal(inRange.eligible.length, 1);
  assert.deepEqual(inRange.eligible[0].unverified, []);

  const tooThin = filterEligible(hide, [makeComponent({ thicknessMinMm: 2.0 })]);
  assert.deepEqual(tooThin.excluded, [{ componentId: 'c1', reason: 'thickness' }]);

  const tooThick = filterEligible(hide, [makeComponent({ thicknessMaxMm: 1.5 })]);
  assert.deepEqual(tooThick.excluded, [{ componentId: 'c1', reason: 'thickness' }]);

  const onlyMin = filterEligible(hide, [makeComponent({ thicknessMinMm: 1.0 })]);
  assert.equal(onlyMin.eligible.length, 1);
});

test('an unmeasured hide keeps the component eligible but records what was not checked', () => {
  // The common case: a scrap gets photographed long before anyone measures
  // it. Blocking here would make the tool useless on real inventory; the
  // gate belongs at the point of commitment instead.
  const hide = makeHide({ thicknessMm: null });

  const { eligible } = filterEligible(hide, [makeComponent({ thicknessMinMm: 1.5, thicknessMaxMm: 2.0 })]);

  assert.equal(eligible.length, 1);
  assert.deepEqual(eligible[0].unverified, ['thicknessMm']);
});

test('an unmeasured hide leaves an unconstrained component fully verified', () => {
  const hide = makeHide({ thicknessMm: null });

  const { eligible } = filterEligible(hide, [makeComponent()]);

  assert.deepEqual(eligible[0].unverified, [], 'nothing was assumed for this component');
});

test('a partially-cut hide is rejected outright, with a reason', () => {
  // remainingAreaPct says material is gone, but outlinePolygon is still the
  // original shape — nothing records WHERE the cuts went, so any layout
  // would place parts over leather that no longer exists.
  const hide = makeHide({ remainingAreaPct: 60 });

  const { eligible, excluded, hideRejection } = filterEligible(hide, [makeComponent()]);

  assert.equal(hideRejection, 'partially-cut');
  assert.deepEqual(eligible, []);
  assert.deepEqual(excluded, []);
});

test('a hide with no outline is rejected outright', () => {
  const hide = makeHide({ outlinePolygon: null });

  const { hideRejection, eligible } = filterEligible(hide, [makeComponent()]);

  assert.equal(hideRejection, 'no-outline');
  assert.deepEqual(eligible, []);
});

test('a legacy hide with no remainingAreaPct key counts as uncut', () => {
  const hide = makeHide({ remainingAreaPct: undefined });

  const { hideRejection, eligible } = filterEligible(hide, [makeComponent()]);

  assert.equal(hideRejection, null);
  assert.equal(eligible.length, 1);
});
