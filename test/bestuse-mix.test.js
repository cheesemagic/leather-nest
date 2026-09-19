// test/bestuse-mix.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCandidates } from '../src/bestuse/candidates.js';
import { mixCandidates, MIX_EFFICIENCIES } from '../src/bestuse/mix.js';
import { footprintArea } from '../src/bestuse/estimate.js';
import { polygonArea } from '../src/nesting/geometry.js';

const OUTLINE = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 400 }, { x: 0, y: 400 }];
const HIDE = { id: 'h1', species: 'python', thicknessMm: 1.8, outlinePolygon: OUTLINE, remainingAreaPct: 100 };

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

const quantitiesOf = (candidate) =>
  Object.fromEntries(candidate.items.map((i) => [i.component.id, i.quantity]));

test('mix refuses every strategy but demand', () => {
  const eligible = [elig(comp('a', 100, 100, { demand: 3 }))];
  for (const strategy of ['value', 'utilization', undefined, null, 'mix']) {
    assert.throws(
      () => generateCandidates('mix', eligible, { hide: HIDE, strategy }),
      /only the "demand" strategy/,
      `strategy ${JSON.stringify(strategy)} should have been refused`
    );
  }
});

test('mix never proposes more of a component than its demand', () => {
  // A tiny part with a small order: area would allow hundreds, demand allows 4.
  const eligible = [
    elig(comp('tiny', 20, 20, { demand: 4 })),
    elig(comp('small', 40, 30, { demand: 7 })),
  ];

  const candidates = generateCandidates('mix', eligible, { hide: HIDE, strategy: 'demand' });

  assert.ok(candidates.length > 0);
  for (const candidate of candidates) {
    for (const item of candidate.items) {
      assert.ok(
        item.quantity <= item.component.demand,
        `${item.component.id}: asked ${item.quantity} against demand ${item.component.demand}`
      );
    }
  }
});

test('a component nobody ordered is excluded at any size', () => {
  const eligible = [
    elig(comp('ordered', 50, 50, { demand: 2 })),
    elig(comp('unordered', 30, 30, { demand: 0 })),
  ];

  const candidates = generateCandidates('mix', eligible, { hide: HIDE, strategy: 'demand' });

  for (const candidate of candidates) {
    assert.ok(!candidate.items.some((i) => i.component.id === 'unordered'));
  }
});

test('mix genuinely mixes: it fills orders across several component types', () => {
  // This is the property the whole mode exists for. Three modest orders that
  // all fit together; a single-type candidate could fill only one of them.
  const eligible = [
    elig(comp('strap', 200, 38, { demand: 4 })),
    elig(comp('pocket', 90, 70, { demand: 6 })),
    elig(comp('keeper', 35, 12, { demand: 20 })),
  ];

  const [best] = generateCandidates('mix', eligible, { hide: HIDE, strategy: 'demand' });

  assert.ok(best.items.length > 1, 'expected more than one component type');
  // Every order is small enough to fit on a 600x400 hide, so all are filled.
  assert.deepEqual(quantitiesOf(best), { strap: 4, pocket: 6, keeper: 20 });
});

test('the smallest footprints are taken first when area runs short', () => {
  // A hide too small for everything. Maximum cardinality means the small part
  // wins the room, because under demand every piece is worth exactly one
  // order — which is what lets a sort stand in for a knapsack.
  const small = { ...HIDE, outlinePolygon: rect(200, 100) };
  const eligible = [
    elig(comp('big', 150, 90, { demand: 5 })),
    elig(comp('little', 30, 20, { demand: 5 })),
  ];

  const candidates = generateCandidates('mix', eligible, { hide: small, strategy: 'demand' });
  assert.ok(candidates.length > 0);

  // EVERY proposal, not just the first: at the lowest efficiency the big part
  // is unaffordable anyway, so both sort orders agree there and checking only
  // candidates[0] would pass against a largest-first sort.
  for (const candidate of candidates) {
    const q = quantitiesOf(candidate);
    assert.equal(
      q.little,
      5,
      `${candidate.candidateId} left the small order short at ${q.little}`
    );
  }
  assert.ok(
    candidates.every((c) => (quantitiesOf(c).big ?? 0) < 5),
    'the big component cannot also be fully satisfied'
  );
});

test('no proposal claims more area than its efficiency allows', () => {
  const eligible = [
    elig(comp('a', 120, 80, { demand: 30 })),
    elig(comp('b', 60, 40, { demand: 30 })),
  ];
  const hideArea = polygonArea(OUTLINE);

  for (const candidate of generateCandidates('mix', eligible, { hide: HIDE, strategy: 'demand' })) {
    const claimed = candidate.items.reduce(
      (sum, item) => sum + footprintArea(item.component) * item.quantity,
      0
    );
    const ceiling = hideArea * Math.max(...MIX_EFFICIENCIES);
    assert.ok(claimed <= ceiling, `claimed ${claimed.toFixed(0)} over ceiling ${ceiling.toFixed(0)}`);
  }
});

test('proposals are deduplicated and deterministic', () => {
  // Small orders are satisfied at every efficiency, so all three assumptions
  // produce the identical mix — which must collapse to one candidate.
  const eligible = [elig(comp('a', 40, 40, { demand: 2 }))];

  const once = generateCandidates('mix', eligible, { hide: HIDE, strategy: 'demand' });
  const twice = generateCandidates('mix', eligible, { hide: HIDE, strategy: 'demand' });

  assert.equal(once.length, 1, 'identical proposals should not repeat');
  assert.deepEqual(once, twice);
});

test('output does not depend on the order eligible arrives in', () => {
  const a = elig(comp('a', 50, 50, { demand: 3 }));
  const b = elig(comp('b', 50, 50, { demand: 3, valuePerPiece: 99 }));

  const forward = generateCandidates('mix', [a, b], { hide: HIDE, strategy: 'demand' });
  const reversed = generateCandidates('mix', [b, a], { hide: HIDE, strategy: 'demand' });

  assert.deepEqual(quantitiesOf(forward[0]), quantitiesOf(reversed[0]));
  // Same footprint, so value breaks the tie and the valuable one leads.
  assert.equal(forward[0].items[0].component.id, 'b');
  assert.equal(reversed[0].items[0].component.id, 'b');
});

test('a hide with no usable area yields nothing rather than throwing', () => {
  const degenerate = { ...HIDE, outlinePolygon: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }] };
  assert.deepEqual(
    mixCandidates([elig(comp('a', 50, 50, { demand: 2 }))], { hide: degenerate, strategy: 'demand' }),
    []
  );
});

test('candidates carry the unverified constraints of their components', () => {
  const eligible = [
    { component: comp('a', 50, 50, { demand: 2 }), unverified: ['thicknessMm'] },
    { component: comp('b', 60, 60, { demand: 2 }), unverified: [] },
  ];

  const [best] = generateCandidates('mix', eligible, { hide: HIDE, strategy: 'demand' });
  const a = best.items.find((i) => i.component.id === 'a');

  assert.deepEqual(a.unverified, ['thicknessMm']);
});
