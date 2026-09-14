// test/bestuse-evaluate.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';

globalThis.ClipperLib = ClipperLib;

import { evaluateCandidate, DEFAULT_SEARCH_GRID_MM } from '../src/bestuse/evaluate.js';

const OUTLINE = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }];
const HIDE = { id: 'h1', species: 'alligator', thicknessMm: 1.8, outlinePolygon: OUTLINE, remainingAreaPct: 100 };

function rect(w, h) {
  return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
}
function comp(id, w, h, overrides = {}) {
  return {
    id, name: id, polygon: rect(w, h), allowedSpecies: null,
    thicknessMinMm: null, thicknessMaxMm: null, valuePerPiece: 10,
    demand: 0, allowedRotations: [0], dieClearanceMm: null, ...overrides,
  };
}
function candidate(items) {
  return { candidateId: 'test', mode: 'explicit', items };
}

test('value is piece value times placed count', () => {
  const result = evaluateCandidate(
    HIDE,
    candidate([{ component: comp('a', 20, 20, { valuePerPiece: 7 }), quantity: 3, unverified: [] }]),
    { method: 'laser', laserClearanceMm: 0 }
  );

  assert.equal(result.counts.a, 3);
  assert.equal(result.value, 21);
});

test('utilization is placed area over hide outline area', () => {
  // Three 20x20 = 1200mm^2 of a 200x100 = 20000mm^2 hide.
  const result = evaluateCandidate(
    HIDE,
    candidate([{ component: comp('a', 20, 20), quantity: 3, unverified: [] }]),
    { method: 'laser', laserClearanceMm: 0 }
  );

  assert.ok(Math.abs(result.utilization - 1200 / 20000) < 1e-9, `got ${result.utilization}`);
});

test('an unpriced component contributes 0 and is reported, not treated as free', () => {
  const result = evaluateCandidate(
    HIDE,
    candidate([
      { component: comp('priced', 20, 20, { valuePerPiece: 5 }), quantity: 2, unverified: [] },
      { component: comp('free', 20, 20, { valuePerPiece: null }), quantity: 2, unverified: [] },
    ]),
    { method: 'laser', laserClearanceMm: 0 }
  );

  assert.equal(result.value, 10, 'only the priced component contributes');
  assert.deepEqual(result.unpriced, ['free']);
});

test('noFit reports COMPONENT ids, deduplicated — not part ids', () => {
  // The sheet fits one 150x90; asking for four means three cannot fit.
  const result = evaluateCandidate(
    HIDE,
    candidate([{ component: comp('big', 150, 90), quantity: 4, unverified: [] }]),
    { method: 'laser', laserClearanceMm: 0 }
  );

  assert.equal(result.counts.big, 1);
  assert.deepEqual(result.noFit, ['big'], 'one component id, not big#1/big#2/big#3');
});

test('noDie reports component ids and stays separate from noFit', () => {
  // "buy a die" and "find a bigger offcut" are different fixes, so they must
  // never be merged into one list.
  const result = evaluateCandidate(
    HIDE,
    candidate([
      { component: comp('tooled', 20, 20, { dieClearanceMm: 2 }), quantity: 2, unverified: [] },
      { component: comp('untooled', 20, 20, { dieClearanceMm: null }), quantity: 2, unverified: [] },
    ]),
    { method: 'die' }
  );

  assert.deepEqual(result.noDie, ['untooled']);
  assert.deepEqual(result.noFit, []);
  assert.equal(result.counts.tooled, 2);
  assert.equal(result.counts.untooled ?? 0, 0);
});

test('demandSatisfied counts each component only up to its demand', () => {
  const result = evaluateCandidate(
    HIDE,
    candidate([{ component: comp('a', 20, 20, { demand: 2 }), quantity: 5, unverified: [] }]),
    { method: 'laser', laserClearanceMm: 0 }
  );

  assert.equal(result.counts.a, 5, 'all five are cut');
  assert.equal(result.demandSatisfied, 2, 'but only two were wanted');
});

test('unverified is the union across the candidate components', () => {
  const result = evaluateCandidate(
    HIDE,
    candidate([
      { component: comp('a', 20, 20), quantity: 1, unverified: ['thicknessMm'] },
      { component: comp('b', 20, 20), quantity: 1, unverified: ['thicknessMm'] },
    ]),
    { method: 'laser', laserClearanceMm: 0 }
  );

  assert.deepEqual(result.unverified, ['thicknessMm'], 'union, deduplicated');
});

test('placements come from the nester, never from an estimate', () => {
  const result = evaluateCandidate(
    HIDE,
    candidate([{ component: comp('a', 20, 20), quantity: 2, unverified: [] }]),
    { method: 'laser', laserClearanceMm: 0 }
  );

  assert.equal(result.placements.length, 2);
  for (const p of result.placements) {
    assert.equal(typeof p.x, 'number');
    assert.equal(typeof p.y, 'number');
    assert.equal(typeof p.rotation, 'number');
  }
});

test('the search defaults to a coarser grid than the nester does', () => {
  // Deliberately different defaults: place() stays at 1mm so the existing
  // nest workspace is untouched, while this pipeline — which packs dozens of
  // candidates — starts coarse. A 1mm scan of a 277-piece candidate measured
  // 172 seconds against 5.5 at 5mm.
  assert.equal(DEFAULT_SEARCH_GRID_MM, 5);

  const result = evaluateCandidate(
    HIDE,
    candidate([{ component: comp('a', 13, 13), quantity: 6, unverified: [] }]),
    { method: 'laser', laserClearanceMm: 0 }
  );

  assert.ok(result.placements.length > 0);
  for (const p of result.placements) {
    assert.equal(p.x % DEFAULT_SEARCH_GRID_MM, 0, `x=${p.x} is off the search grid`);
    assert.equal(p.y % DEFAULT_SEARCH_GRID_MM, 0, `y=${p.y} is off the search grid`);
  }
});

test('an explicit gridStepMm overrides the search default', () => {
  const fine = evaluateCandidate(
    HIDE,
    candidate([{ component: comp('a', 13, 13), quantity: 6, unverified: [] }]),
    { method: 'laser', laserClearanceMm: 0, gridStepMm: 1 }
  );

  assert.ok(
    fine.placements.some((p) => p.x % DEFAULT_SEARCH_GRID_MM !== 0 || p.y % DEFAULT_SEARCH_GRID_MM !== 0),
    'a 1mm run must be able to use positions the 5mm grid cannot reach'
  );
});

test('a coarse run packs less tightly but every placement is still real', () => {
  // The trade this setting exists to make: fewer pieces, same exactness.
  // A coarse layout is genuinely cuttable — it just leaves more waste — so
  // utilization may drop while nothing becomes invalid.
  const items = [{ component: comp('a', 13, 13), quantity: 60, unverified: [] }];

  const coarse = evaluateCandidate(HIDE, candidate(items), {
    method: 'laser', laserClearanceMm: 0, gridStepMm: 10,
  });
  const fine = evaluateCandidate(HIDE, candidate(items), {
    method: 'laser', laserClearanceMm: 0, gridStepMm: 1,
  });

  assert.ok(
    coarse.placements.length < fine.placements.length,
    `coarse placed ${coarse.placements.length}, fine placed ${fine.placements.length}`
  );
  assert.ok(coarse.utilization <= fine.utilization);
  assert.ok(coarse.placements.length > 0, 'coarse must still produce a usable layout');
});
