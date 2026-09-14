// test/bestuse-candidates.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateCapacity, PACKING_EFFICIENCY } from '../src/bestuse/estimate.js';
import { generateCandidates, SHORTLIST_SIZE } from '../src/bestuse/candidates.js';

const OUTLINE = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 400 }, { x: 0, y: 400 }];
const HIDE = { id: 'h1', species: 'alligator', thicknessMm: 1.8, outlinePolygon: OUTLINE, remainingAreaPct: 100 };

function rect(w, h) {
  return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
}
function comp(id, w, h, overrides = {}) {
  return {
    id, name: id, polygon: rect(w, h), allowedSpecies: null,
    thicknessMinMm: null, thicknessMaxMm: null, valuePerPiece: 10,
    demand: 0, allowedRotations: [0, 90], dieClearanceMm: null, ...overrides,
  };
}
const elig = (component) => ({ component, unverified: [] });

test('estimateCapacity is hide area times efficiency, over part area', () => {
  // 600x400 = 240000mm^2; at 0.75 that is 180000 usable; a 100x100 part is
  // 10000, so 18 pieces.
  const { pieces, estimatedValue } = estimateCapacity(HIDE, comp('a', 100, 100));

  assert.equal(PACKING_EFFICIENCY, 0.75);
  assert.equal(pieces, 18);
  assert.equal(estimatedValue, 180);
});

test('estimateCapacity returns 0 for a part larger than the usable area', () => {
  const { pieces, estimatedValue } = estimateCapacity(HIDE, comp('huge', 600, 400));

  assert.equal(pieces, 0);
  assert.equal(estimatedValue, 0);
});

test('estimateCapacity treats an unpriced component as worth 0, not as free', () => {
  const { pieces, estimatedValue } = estimateCapacity(HIDE, comp('x', 100, 100, { valuePerPiece: null }));

  assert.equal(pieces, 18);
  assert.equal(estimatedValue, 0);
});

test('estimateCapacity never returns placements', () => {
  // The whole point of the two-stage design: an estimate must never be
  // mistakable for a layout.
  const estimate = estimateCapacity(HIDE, comp('a', 100, 100));

  assert.deepEqual(Object.keys(estimate).sort(), ['estimatedValue', 'pieces']);
});

test('explicit mode produces one candidate from the chosen quantities', () => {
  const eligible = [elig(comp('a', 50, 50)), elig(comp('b', 60, 60))];

  const candidates = generateCandidates('explicit', eligible, {
    hide: HIDE,
    quantities: { a: 3, b: 2 },
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].mode, 'explicit');
  assert.deepEqual(
    candidates[0].items.map((i) => [i.component.id, i.quantity]),
    [['a', 3], ['b', 2]]
  );
});

test('explicit mode omits components with no quantity, and returns nothing if none', () => {
  const eligible = [elig(comp('a', 50, 50)), elig(comp('b', 60, 60))];

  const partial = generateCandidates('explicit', eligible, { hide: HIDE, quantities: { a: 2 } });
  assert.deepEqual(partial[0].items.map((i) => i.component.id), ['a']);

  const none = generateCandidates('explicit', eligible, { hide: HIDE, quantities: {} });
  assert.deepEqual(none, []);
});

test('singles mode produces one candidate per component, each a single type', () => {
  const eligible = [elig(comp('a', 100, 100)), elig(comp('b', 120, 120))];

  const candidates = generateCandidates('singles', eligible, { hide: HIDE, strategy: 'value' });

  assert.equal(candidates.length, 2);
  for (const c of candidates) {
    assert.equal(c.items.length, 1, 'singles mode never mixes component types');
    assert.ok(c.items[0].quantity > 0);
  }
});

test('singles mode shortlists to SHORTLIST_SIZE, keeping the best by strategy', () => {
  // Eight components; only the top five by estimated value survive.
  const eligible = [
    elig(comp('cheap', 100, 100, { valuePerPiece: 1 })),
    elig(comp('mid1', 100, 100, { valuePerPiece: 5 })),
    elig(comp('mid2', 100, 100, { valuePerPiece: 6 })),
    elig(comp('mid3', 100, 100, { valuePerPiece: 7 })),
    elig(comp('mid4', 100, 100, { valuePerPiece: 8 })),
    elig(comp('rich', 100, 100, { valuePerPiece: 100 })),
    elig(comp('poor', 100, 100, { valuePerPiece: 2 })),
    elig(comp('free', 100, 100, { valuePerPiece: null })),
  ];

  const candidates = generateCandidates('singles', eligible, { hide: HIDE, strategy: 'value' });

  assert.equal(SHORTLIST_SIZE, 5);
  assert.equal(candidates.length, 5);
  const ids = candidates.map((c) => c.items[0].component.id);
  assert.ok(ids.includes('rich'), 'the highest-value component must survive');
  assert.ok(!ids.includes('free'), 'an unpriced component scores 0 under value');
});

test('the shortlist depends on the strategy, not a fixed value ordering', () => {
  // A cheap component that fits many times beats a dear one under
  // utilization and loses under value. If shortlisting ignored the strategy,
  // the utilization winner would be dropped before it was ever nested — a
  // bug invisible in the final output.
  const eligible = [
    elig(comp('tiny', 20, 20, { valuePerPiece: 1 })),
    elig(comp('dear', 300, 400, { valuePerPiece: 500 })),
    elig(comp('f1', 100, 100, { valuePerPiece: 9 })),
    elig(comp('f2', 100, 100, { valuePerPiece: 9 })),
    elig(comp('f3', 100, 100, { valuePerPiece: 9 })),
    elig(comp('f4', 100, 100, { valuePerPiece: 9 })),
  ];

  const byUtil = generateCandidates('singles', eligible, { hide: HIDE, strategy: 'utilization' })
    .map((c) => c.items[0].component.id);

  assert.ok(byUtil.includes('tiny'), 'tiny fills the most area and must be shortlisted');
});

test('singles mode drops components that cannot fit even once', () => {
  const eligible = [elig(comp('huge', 600, 400)), elig(comp('ok', 100, 100))];

  const candidates = generateCandidates('singles', eligible, { hide: HIDE, strategy: 'value' });

  assert.deepEqual(candidates.map((c) => c.items[0].component.id), ['ok']);
});

test('candidates carry the unverified constraints of their components', () => {
  const eligible = [{ component: comp('a', 100, 100), unverified: ['thicknessMm'] }];

  const candidates = generateCandidates('singles', eligible, { hide: HIDE, strategy: 'value' });

  assert.deepEqual(candidates[0].items[0].unverified, ['thicknessMm']);
});

test('an unrecognised mode throws rather than guessing', () => {
  assert.throws(
    () => generateCandidates('telepathy', [], { hide: HIDE }),
    /telepathy/
  );
});
