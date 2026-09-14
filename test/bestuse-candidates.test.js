// test/bestuse-candidates.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateCapacity, PACKING_EFFICIENCY, ESTIMATE_SCORERS } from '../src/bestuse/estimate.js';
import { generateCandidates, SHORTLIST_SIZE } from '../src/bestuse/candidates.js';
import { RANKING_STRATEGIES } from '../src/bestuse/ranking.js';

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
  // If shortlisting ignored the strategy, the utilization winner would be
  // dropped before it was ever nested — and every result that DID appear
  // would look perfectly reasonable, so nobody would notice.
  //
  // This needs SEVEN components to discriminate. An earlier six-component
  // version was vacuous: `tiny` scored 450 by value, second behind `dear`
  // at 500, so it survived the top five under BOTH strategies and the
  // assertion could not fail. Mutation testing caught that — hardcoding the
  // scorer to `value` left the whole suite green.
  //
  // With five fillers at 540 by value, `tiny` (450) is pushed out under
  // value but stays in under utilization (450 pieces x 400mm^2 = 180,000,
  // tying the fillers and beating `dear` at 120,000).
  const eligible = [
    elig(comp('tiny', 20, 20, { valuePerPiece: 1 })),
    elig(comp('dear', 300, 400, { valuePerPiece: 500 })),
    elig(comp('f1', 100, 100, { valuePerPiece: 30 })),
    elig(comp('f2', 100, 100, { valuePerPiece: 30 })),
    elig(comp('f3', 100, 100, { valuePerPiece: 30 })),
    elig(comp('f4', 100, 100, { valuePerPiece: 30 })),
    elig(comp('f5', 100, 100, { valuePerPiece: 30 })),
  ];
  const shortlistFor = (strategy) =>
    generateCandidates('singles', eligible, { hide: HIDE, strategy })
      .map((c) => c.items[0].component.id);

  const byValue = shortlistFor('value');
  const byUtil = shortlistFor('utilization');

  assert.ok(!byValue.includes('tiny'), 'tiny is not worth enough to make the value shortlist');
  assert.ok(byUtil.includes('tiny'), 'but it fills the most area, so utilization must keep it');
});

test('the demand shortlist favours what was ordered, not what fits most', () => {
  // Without this, demand mode shortlists by raw capacity: 450 keepers nobody
  // ordered would crowd out the strap with twelve orders against it — for
  // the one question the mode exists to answer.
  const eligible = [
    elig(comp('keeper', 20, 20, { valuePerPiece: 1, demand: 0 })),
    elig(comp('strap', 38, 400, { valuePerPiece: 60, demand: 12 })),
  ];

  const byDemand = generateCandidates('singles', eligible, { hide: HIDE, strategy: 'demand' })
    .map((c) => c.items[0].component.id);

  assert.equal(byDemand[0], 'strap', 'the ordered component must come first under demand');
});

test('the utilization scorer weighs area, not piece count', () => {
  // Tested against the scorer directly rather than through a shortlist,
  // because a real estimate cannot separate these: `pieces` is itself
  // floor(hideArea * efficiency / partArea), so pieces x partArea comes back
  // to roughly hideArea * efficiency for EVERY component. Two components
  // chosen at random tie almost exactly (measured: 450 x 400 and 15 x 12,000
  // both give 180,000), which is why a shortlist-based version of this test
  // failed to discriminate.
  //
  // With the piece counts fixed, the two rankings disagree outright: by
  // count the small component wins 10 to 2; by area the large one wins
  // 240,000 to 4,000.
  const small = comp('small', 20, 20); // 400mm^2
  const large = comp('large', 300, 400); // 120,000mm^2

  const smallScore = ESTIMATE_SCORERS.utilization({ pieces: 10, estimatedValue: 0 }, small);
  const largeScore = ESTIMATE_SCORERS.utilization({ pieces: 2, estimatedValue: 0 }, large);

  assert.equal(smallScore, 4000);
  assert.equal(largeScore, 240000);
  assert.ok(largeScore > smallScore, 'area used must beat piece count');
});

test('the estimate scorers and the ranking strategies offer the same questions', () => {
  // If one gained a key the other lacked, the shortlist would score by a
  // different question than the ranking asks. Key drift is loud (both throw
  // on an unknown strategy), but this pins it rather than relying on that.
  assert.deepEqual(
    Object.keys(ESTIMATE_SCORERS).sort(),
    Object.keys(RANKING_STRATEGIES).sort()
  );
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
