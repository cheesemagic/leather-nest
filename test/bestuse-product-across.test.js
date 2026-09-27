import test from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';

globalThis.ClipperLib = ClipperLib;

import { runProductAcrossHides } from '../src/bestuse/across.js';

const rect = (w, h) => [
  { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h },
];
const hide = (id, w, h, extra = {}) => ({
  id, outlinePolygon: rect(w, h), remainingAreaPct: 100, ...extra,
});
const component = (id, w, h, extra = {}) => ({
  id, name: id, polygon: rect(w, h), allowedRotations: [0], ...extra,
});
const opts = { method: 'laser', laserClearanceMm: 0, gridStepMm: 5, orientations: 1 };

test('a product that fits one hide is made there', () => {
  const result = runProductAcrossHides({
    hides: [hide('h1', 200, 200)],
    components: [component('back', 40, 40), component('pocket', 20, 20)],
    product: { id: 'wallet', name: 'Wallet', parts: [
      { partId: 'back', quantity: 1 }, { partId: 'pocket', quantity: 2 },
    ] },
    ...opts,
  });

  assert.equal(result.error, null);
  assert.ok(result.completeCount >= 1, `expected at least one set, got ${result.completeCount}`);
  assert.equal(result.layouts.length, 1);
});

test('visible pieces of one set never land on two different hides', () => {
  // Two 40x40 vamps per set. The small hide takes exactly one, so without
  // grouping a set would be split across hides -- the mismatch the flag exists
  // to prevent. Both components are must-match by default.
  const result = runProductAcrossHides({
    hides: [hide('small', 45, 45), hide('big', 200, 200)],
    components: [component('vamp', 40, 40)],
    product: { id: 'shoe', name: 'Sneaker', parts: [{ partId: 'vamp', quantity: 2 }] },
    ...opts,
  });

  assert.ok(result.completeCount >= 1);

  // Every set appears on exactly one hide. Counted across layouts, so a set
  // split between two of them fails here rather than passing unnoticed.
  const hidesPerSet = new Map();
  for (const layout of result.layouts) {
    assert.ok(layout.setIndexes.length > 0, 'a layout should report which sets it carries');
    for (const setIndex of layout.setIndexes) {
      hidesPerSet.set(setIndex, (hidesPerSet.get(setIndex) ?? 0) + 1);
    }
  }
  assert.ok(hidesPerSet.size > 0, 'at least one set was made');
  for (const [setIndex, hideCount] of hidesPerSet) {
    assert.equal(hideCount, 1, `set ${setIndex} was split across ${hideCount} hides`);
  }
  // The small hide could never hold a whole set, so it contributes nothing.
  assert.ok(!result.layouts.some((l) => l.hideId === 'small'), 'the small hide holds no half-set');
});

test('a piece marked as spannable may come off another hide', () => {
  // Same geometry, but the second piece is an interior lining nobody sees
  // beside anything, so it is free to land wherever it fits.
  const result = runProductAcrossHides({
    hides: [hide('small', 45, 45), hide('big', 200, 200)],
    components: [
      component('vamp', 40, 40),
      component('lining', 40, 40, { mustMatch: false }),
    ],
    product: { id: 'shoe', name: 'Sneaker', parts: [
      { partId: 'vamp', quantity: 1 }, { partId: 'lining', quantity: 1 },
    ] },
    ...opts,
  });

  assert.ok(result.completeCount >= 1);
  const usedHides = new Set(result.layouts.map((l) => l.hideId));
  assert.ok(usedHides.has('small'), 'the spannable lining used the offcut');
});

test('a product that fits nowhere reports zero sets rather than a partial one', () => {
  const result = runProductAcrossHides({
    hides: [hide('tiny', 30, 30)],
    components: [component('panel', 90, 90)],
    product: { id: 'p', name: 'Big thing', parts: [{ partId: 'panel', quantity: 1 }] },
    ...opts,
  });

  assert.equal(result.completeCount, 0);
  assert.deepEqual(result.layouts, []);
});

test('more sets are made when more leather is available', () => {
  const one = runProductAcrossHides({
    hides: [hide('h', 100, 100)],
    components: [component('panel', 45, 45)],
    product: { id: 'p', name: 'Thing', parts: [{ partId: 'panel', quantity: 2 }] },
    ...opts,
  });
  const more = runProductAcrossHides({
    hides: [hide('h', 100, 100), hide('h2', 200, 200)],
    components: [component('panel', 45, 45)],
    product: { id: 'p', name: 'Thing', parts: [{ partId: 'panel', quantity: 2 }] },
    ...opts,
  });
  assert.ok(more.completeCount > one.completeCount,
    `more leather should make more sets: ${one.completeCount} -> ${more.completeCount}`);
});

test('a product naming a component that does not exist is an error, not a crash', () => {
  const result = runProductAcrossHides({
    hides: [hide('h', 200, 200)],
    components: [component('back', 40, 40)],
    product: { id: 'p', name: 'Broken', parts: [{ partId: 'missing', quantity: 1 }] },
    ...opts,
  });
  assert.match(result.error, /component/i);
  assert.equal(result.completeCount, 0);
});
