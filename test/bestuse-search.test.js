// test/bestuse-search.test.js
// The Find Best Use page's decisions, now that they live outside the page.
// The bug that motivated this: "You Choose" passed the mode name where a
// ranking strategy belongs, so it errored on every run and shipped that way.
import test from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';

globalThis.ClipperLib = ClipperLib;

import { runSearch, canRun, strategyForMode } from '../src/bestuse/search.js';

const OUTLINE = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
const HIDE = {
  id: 'h1', label: 'Test hide', species: 'python', thicknessMm: 1.8,
  outlinePolygon: OUTLINE, remainingAreaPct: 100,
};
const rect = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
function comp(id, w, h, overrides = {}) {
  return {
    id, name: id, polygon: rect(w, h), valuePerPiece: 10, demand: 3,
    allowedSpecies: null, thicknessMinMm: null, thicknessMaxMm: null,
    allowedRotations: [0, 90], dieClearanceMm: null, ...overrides,
  };
}
const COMPONENTS = [
  comp('strap', 120, 30, { valuePerPiece: 40, demand: 2 }),
  comp('keeper', 30, 12, { valuePerPiece: 3, demand: 10 }),
  comp('pocket', 80, 60, { valuePerPiece: 18, demand: 4 }),
];
const PRODUCTS = [
  {
    id: 'belt-product',
    name: 'belt',
    parts: [
      { partId: 'strap', quantity: 1, mustMatch: true },
      { partId: 'keeper', quantity: 2, mustMatch: true },
    ],
  },
];
const opts = { method: 'laser', laserClearanceMm: 1.0, gridStepMm: 15 };
const search = (extra) =>
  runSearch({ hide: HIDE, components: COMPONENTS, ...opts, ...extra });

// --- every mode the page offers must actually produce a layout -----------

test('You Choose returns a layout, not an error', () => {
  // The regression that started this file. It names no strategy; passing the
  // mode in place of one is rejected by the ranker, which is what shipped.
  const { results, error } = search({
    mode: 'explicit',
    quantities: { strap: 2, keeper: 4 },
  });

  assert.equal(error, null, `You Choose errored: ${error}`);
  assert.equal(results.length, 1, 'chosen quantities make exactly one candidate');
  assert.ok(results[0].placements.length > 0, 'nothing was placed');
});

test('Rank Singles returns a layout for each strategy it offers', () => {
  for (const strategy of ['value', 'utilization', 'demand']) {
    const { results, error } = search({ mode: 'singles', strategy });
    assert.equal(error, null, `${strategy} errored: ${error}`);
    assert.ok(results.length > 0, `${strategy} produced nothing`);
    assert.ok(results[0].placements.length > 0, `${strategy} placed nothing`);
  }
});

test('Fill Orders returns a layout mixing more than one component', () => {
  const { results, error } = search({ mode: 'mix', strategy: 'demand' });

  assert.equal(error, null, `Fill Orders errored: ${error}`);
  assert.ok(results.length > 0);
  assert.ok(
    Object.keys(results[0].counts).length > 1,
    'Fill Orders should combine component types'
  );
});

test('every mode the page can be in is covered above', () => {
  // A new mode button with no test here should fail loudly rather than
  // quietly ship unchecked, which is how You Choose stayed broken.
  const tested = ['explicit', 'singles', 'mix', 'products'];
  for (const mode of tested) {
    const strategy = mode === 'explicit' ? null : strategyForMode(mode) ?? 'value';
    const { error } = search({ mode, strategy, quantities: { strap: 1 }, products: PRODUCTS });
    assert.equal(error, null, `mode ${mode} errored: ${error}`);
  }
});

test('Products nests only whole completed copies, never a leftover single piece', () => {
  // The belt product needs 1 strap + 2 keepers. Placing straps and keepers
  // independently (what the general nester does for every other mode) would
  // likely leave a mismatched count of one or the other; this checks the
  // set-at-a-time search replaced that with an exact, balanced ratio.
  const { results, error } = search({ mode: 'products', strategy: 'value', products: PRODUCTS });

  assert.equal(error, null, `Products errored: ${error}`);
  assert.ok(results.length > 0);
  const result = results[0];
  assert.equal(result.productName, 'belt');
  assert.ok(result.completeCount > 0, 'expected at least one complete belt');

  assert.equal(result.counts.strap, result.completeCount * 1);
  assert.equal(result.counts.keeper, result.completeCount * 2);
  assert.equal(result.value, result.completeCount * (40 * 1 + 3 * 2));
});

// --- failures are reported, not thrown ----------------------------------

test('a hide that cannot be used explains why instead of throwing', () => {
  const partlyCut = { ...HIDE, remainingAreaPct: 60 };
  const { results, error } = runSearch({
    hide: partlyCut, components: COMPONENTS, mode: 'singles', strategy: 'value', ...opts,
  });

  assert.equal(results.length, 0);
  assert.match(error, /cannot be used/i);
});

test('no hide at all is an explanation, not a crash', () => {
  const { error } = runSearch({ hide: null, components: COMPONENTS, mode: 'singles', strategy: 'value', ...opts });
  assert.match(error, /no hide/i);
});

test('an unknown strategy surfaces as a message the page can show', () => {
  const { results, error } = search({ mode: 'singles', strategy: 'cheapest' });
  assert.equal(results.length, 0);
  assert.match(error, /cheapest/);
});

test('Fill Orders with a strategy it does not support explains itself', () => {
  const { error } = search({ mode: 'mix', strategy: 'value' });
  assert.match(error, /demand/i);
});

test('choosing nothing in You Choose is an explanation, not an empty screen', () => {
  const { results, error } = search({ mode: 'explicit', quantities: {} });
  assert.equal(results.length, 0);
  assert.match(error, /no valid candidates/i);
});

// --- the run button ------------------------------------------------------

test('the Run button waits for a hide in every mode', () => {
  for (const mode of ['explicit', 'singles', 'mix', 'products']) {
    assert.equal(
      canRun({ hideId: null, mode, strategy: 'value', quantities: { strap: 1 } }),
      false,
      `${mode} should not run without a hide`
    );
  }
});

test('Rank Singles waits for a strategy; Fill Orders does not', () => {
  const base = { hideId: 'h1', quantities: {} };
  assert.equal(canRun({ ...base, mode: 'singles', strategy: null }), false);
  assert.equal(canRun({ ...base, mode: 'singles', strategy: '' }), false);
  assert.equal(canRun({ ...base, mode: 'singles', strategy: 'value' }), true);
  // Fill Orders answers one question, so there is nothing to wait for.
  assert.equal(canRun({ ...base, mode: 'mix', strategy: null }), true);
  // So does Products -- it always considers every product definition.
  assert.equal(canRun({ ...base, mode: 'products', strategy: null }), true);
});

test('You Choose waits for at least one component', () => {
  const base = { hideId: 'h1', mode: 'explicit', strategy: null };
  assert.equal(canRun({ ...base, quantities: {} }), false);
  assert.equal(canRun({ ...base, quantities: { strap: 1 } }), true);
});

test('picking Fill Orders or Products settles the strategy; the others leave it open', () => {
  assert.equal(strategyForMode('mix'), 'demand');
  assert.equal(strategyForMode('products'), 'value');
  assert.equal(strategyForMode('singles'), null);
  assert.equal(strategyForMode('explicit'), null);
});

test('the mode Fill Orders implies is one it actually accepts', () => {
  // If these ever disagree, picking Fill Orders would set a strategy its own
  // generator rejects — the page would break on the first click.
  const { error } = search({ mode: 'mix', strategy: strategyForMode('mix') });
  assert.equal(error, null);
});
