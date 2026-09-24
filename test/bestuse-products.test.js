// test/bestuse-products.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';

globalThis.ClipperLib = ClipperLib;

import { productCandidates, evaluateProductCandidate } from '../src/bestuse/products.js';

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

const BACK = comp('back', 80, 100, { valuePerPiece: 12 });
const POCKET = comp('pocket', 60, 40, { valuePerPiece: 4 });
const WALLET = {
  id: 'wallet-1',
  name: 'card wallet',
  parts: [
    { partId: 'back', quantity: 1, mustMatch: true },
    { partId: 'pocket', quantity: 2, mustMatch: true },
  ],
};

test('productCandidates returns nothing when no products are given', () => {
  assert.deepEqual(productCandidates([elig(BACK), elig(POCKET)], { hide: HIDE, products: [] }), []);
  assert.deepEqual(productCandidates([elig(BACK), elig(POCKET)], { hide: HIDE }), []);
});

test('productCandidates skips a product whose part is not eligible on this hide', () => {
  // Only BACK is eligible -- POCKET was excluded upstream (species/thickness),
  // so the wallet can never be completed here at all.
  const candidates = productCandidates([elig(BACK)], { hide: HIDE, products: [WALLET] });
  assert.deepEqual(candidates, []);
});

test('productCandidates builds one candidate per product, with a sets estimate to search from', () => {
  const candidates = productCandidates([elig(BACK), elig(POCKET)], { hide: HIDE, products: [WALLET] });
  assert.equal(candidates.length, 1);
  const [candidate] = candidates;
  assert.equal(candidate.mode, 'products');
  assert.equal(candidate.product, WALLET);
  assert.equal(candidate.entries.length, 2);
  assert.ok(candidate.maxSets >= 1);
});

test('evaluateProductCandidate nests only whole sets -- every part count is an exact multiple of its per-set quantity', () => {
  const candidates = productCandidates([elig(BACK), elig(POCKET)], { hide: HIDE, products: [WALLET] });
  const result = evaluateProductCandidate(HIDE, candidates[0], { method: 'laser', gridStepMm: 15 });

  assert.equal(result.productName, 'card wallet');
  assert.ok(result.completeCount > 0, 'expected at least one complete wallet on a 600x400 hide');
  // 1 back and 2 pockets per set, exactly -- never a spare of either.
  assert.equal(result.counts.back, result.completeCount * 1);
  assert.equal(result.counts.pocket, result.completeCount * 2);
  assert.equal(result.value, result.completeCount * (12 * 1 + 4 * 2));
});

test('evaluateProductCandidate reports 0 complete sets when even one does not fit', () => {
  const tinyHide = { ...HIDE, outlinePolygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] };
  const candidates = productCandidates([elig(BACK), elig(POCKET)], { hide: tinyHide, products: [WALLET] });
  // The area estimate itself already floors at 1 set as a generous upper
  // bound (see productCandidates) -- the exact nest is what has to refuse it.
  const result = evaluateProductCandidate(tinyHide, candidates[0], { method: 'laser', gridStepMm: 15 });

  assert.equal(result.completeCount, 0);
  assert.equal(result.value, 0);
  assert.deepEqual(result.placements, []);
});

test('evaluateProductCandidate treats an unpriced part as contributing 0 to value, not NaN', () => {
  const unpricedBack = comp('back', 80, 100, { valuePerPiece: null });
  const candidates = productCandidates([elig(unpricedBack), elig(POCKET)], { hide: HIDE, products: [WALLET] });
  const result = evaluateProductCandidate(HIDE, candidates[0], { method: 'laser', gridStepMm: 15 });

  assert.ok(result.completeCount > 0);
  assert.deepEqual(result.unpriced, ['back']);
  assert.equal(result.value, result.completeCount * (0 + 4 * 2));
});

test('evaluateProductCandidate reports demandSatisfied equal to completeCount when no demand is set (the default)', () => {
  const candidates = productCandidates([elig(BACK), elig(POCKET)], { hide: HIDE, products: [WALLET] });
  const result = evaluateProductCandidate(HIDE, candidates[0], { method: 'laser', gridStepMm: 15 });
  assert.equal(WALLET.demand, undefined, 'sanity check: this fixture names no demand');
  assert.equal(result.demandSatisfied, result.completeCount);
});

test('evaluateProductCandidate caps demandSatisfied at demand when fewer are wanted than fit', () => {
  const wallet = { ...WALLET, demand: 1 };
  const candidates = productCandidates([elig(BACK), elig(POCKET)], { hide: HIDE, products: [wallet] });
  const result = evaluateProductCandidate(HIDE, candidates[0], { method: 'laser', gridStepMm: 15 });
  assert.ok(result.completeCount > 1, 'a 600x400 hide should fit more than 1 wallet');
  assert.equal(result.demandSatisfied, 1);
});

test('evaluateProductCandidate reports demandSatisfied equal to completeCount when demand exceeds what fits', () => {
  const wallet = { ...WALLET, demand: 1000 };
  const candidates = productCandidates([elig(BACK), elig(POCKET)], { hide: HIDE, products: [wallet] });
  const result = evaluateProductCandidate(HIDE, candidates[0], { method: 'laser', gridStepMm: 15 });
  assert.equal(result.demandSatisfied, result.completeCount);
  assert.ok(result.demandSatisfied < 1000);
});

test('evaluateProductCandidate reports noDie and 0 complete sets when a part has no recorded die clearance', () => {
  const candidates = productCandidates([elig(BACK), elig(POCKET)], { hide: HIDE, products: [WALLET] });
  const result = evaluateProductCandidate(HIDE, candidates[0], { method: 'die', gridStepMm: 15 });

  assert.equal(result.completeCount, 0);
  assert.equal(result.value, 0);
  assert.ok(result.noDie.includes('back'));
  assert.ok(result.noDie.includes('pocket'));
});
