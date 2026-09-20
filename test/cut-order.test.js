// test/cut-order.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';

globalThis.ClipperLib = ClipperLib;

import {
  orderForHeat,
  sortInteriorPaths,
  consecutiveGapStats,
  KIND_ORDER,
} from '../src/cut-order.js';
import { exportToSVG } from '../src/svg/export.js';

// A 5x5 grid of pieces, which is the worst case: cut in placement order,
// every cut lands next to the one before it.
const GRID = [];
for (let row = 0; row < 5; row++) {
  for (let col = 0; col < 5; col++) GRID.push({ id: `${row}-${col}`, x: col * 10, y: row * 10 });
}

test('the beam stops returning to leather it was just beside', () => {
  // The measure that matters is how OFTEN consecutive cuts are neighbours,
  // not the single worst pair — some cluster always remains, so the worst
  // pair barely moves however good the ordering is.
  const stats = (entries) => consecutiveGapStats(entries, { adjacentWithinMm: 10 });
  const before = stats(GRID);
  const after = stats(orderForHeat(GRID));

  assert.equal(before.adjacent, 20, 'grid order should cut neighbour after neighbour');
  assert.ok(after.adjacent <= 3, `still ${after.adjacent} back-to-back pairs`);
  assert.ok(after.mean > before.mean * 1.5, `mean gap ${before.mean} -> ${after.mean}`);
});

test('nothing is lost or duplicated in the reordering', () => {
  const reordered = orderForHeat(GRID);
  assert.equal(reordered.length, GRID.length);
  assert.deepEqual(
    reordered.map((e) => e.id).sort(),
    GRID.map((e) => e.id).sort()
  );
});

test('the same job always produces the same order', () => {
  // A file that changes between runs is one nobody can diff or trust.
  const a = orderForHeat(GRID).map((e) => e.id);
  const b = orderForHeat([...GRID]).map((e) => e.id);
  assert.deepEqual(a, b);
});

test('the order does not depend on how the pieces arrived', () => {
  const shuffled = [...GRID].reverse();
  assert.deepEqual(
    orderForHeat(GRID).map((e) => e.id),
    orderForHeat(shuffled).map((e) => e.id)
  );
});

test('it starts at a corner rather than wherever the list began', () => {
  const first = orderForHeat([...GRID].reverse())[0];
  assert.equal(first.y, 0);
  assert.equal(first.x, 0);
});

test('a long narrow job that fits one quadrant still comes out ordered', () => {
  // Nothing to rotate between; the loop must finish rather than spin.
  const strip = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, x: i * 5, y: 0 }));
  const out = orderForHeat(strip);
  assert.equal(out.length, strip.length);
  assert.deepEqual(out.map((e) => e.id).sort(), strip.map((e) => e.id).sort());
});

test('one or two pieces are left alone', () => {
  assert.deepEqual(orderForHeat([]), []);
  const two = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 1 }];
  assert.deepEqual(orderForHeat(two), two);
});

// --- order within one piece ---------------------------------------------

test('the outline is cut last, after everything inside it', () => {
  // Not a preference: cutting the outline frees the piece, and anything cut
  // afterwards goes into something loose enough to shift or drop.
  const paths = [
    { kind: 'cut', closed: true, points: [] },
    { kind: 'mark', closed: false, points: [] },
    { kind: 'score', closed: false, points: [] },
  ];
  assert.deepEqual(sortInteriorPaths(paths).map((p) => p.kind), ['mark', 'score', 'cut']);
  assert.deepEqual(KIND_ORDER, ['mark', 'score', 'cut']);
});

test('paths of the same kind keep their original order', () => {
  const paths = [
    { kind: 'cut', id: 1 }, { kind: 'cut', id: 2 }, { kind: 'mark', id: 3 }, { kind: 'cut', id: 4 },
  ];
  assert.deepEqual(sortInteriorPaths(paths).map((p) => p.id), [3, 1, 2, 4]);
});

test('sorting does not mutate what it was given', () => {
  const paths = [{ kind: 'cut' }, { kind: 'mark' }];
  sortInteriorPaths(paths);
  assert.deepEqual(paths.map((p) => p.kind), ['cut', 'mark']);
});

// --- and in the file itself ---------------------------------------------

const rect = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const HOLE = { kind: 'cut', closed: true, points: [
  { x: 4, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 8 }, { x: 4, y: 8 },
] };

test('the file puts a piece interior cuts before its outline', () => {
  const part = { id: 'p', polygon: rect(20, 20), interiorPaths: [HOLE] };
  const svg = exportToSVG(rect(100, 100), [{ id: 'p', x: 0, y: 0, rotation: 0 }], [part]);
  const cuts = [...svg.matchAll(/<polygon points="([^"]+)" stroke="#FF0000"/g)].map((m) => m[1]);

  // The hole's line is shorter than the outline's; it must come first.
  const holeIndex = cuts.findIndex((points) => points.includes('4,4'));
  const outlineIndex = cuts.findIndex((points) => points.includes('20,20'));
  assert.ok(holeIndex >= 0 && outlineIndex >= 0, 'both cuts should be present');
  assert.ok(holeIndex < outlineIndex, 'the outline was cut before the hole');
});

test('the file spreads a grid of pieces out rather than cutting in rows', () => {
  const part = { id: 'p', polygon: rect(8, 8) };
  const placements = GRID.map((g) => ({ id: 'p', x: g.x, y: g.y, rotation: 0 }));
  const svg = exportToSVG(rect(100, 100), placements, [part]);

  // Read back the order the pieces appear in and measure it.
  const centres = [...svg.matchAll(/<polygon points="([^"]+)" stroke="#FF0000"/g)]
    .map((m) => m[1].split(' ').map((p) => p.split(',').map(Number)))
    .map((points) => ({
      x: points.reduce((t, p) => t + p[0], 0) / points.length,
      y: points.reduce((t, p) => t + p[1], 0) / points.length,
    }));

  assert.equal(centres.length, 25);
  const { adjacent, mean } = consecutiveGapStats(centres, { adjacentWithinMm: 10 });
  assert.ok(adjacent <= 3, `${adjacent} pieces still cut back to back`);
  assert.ok(mean > 20, `mean gap only ${mean.toFixed(1)}mm`);
});
