import test from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';

globalThis.ClipperLib = ClipperLib;

import { nestAcrossHides } from '../src/nesting/multi.js';

const rect = (w, h) => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];

const hide = (id, w, h) => ({ id, polygon: rect(w, h) });
const part = (id, w, h, extra = {}) => ({
  id,
  polygon: rect(w, h),
  allowedRotations: [0],
  ...extra,
});

// One orientation keeps these deterministic and fast: the rotation search is
// nestBestOrientation's job and is covered by its own tests, and six
// orientations per hide per case makes this file slow for no extra coverage.
const opts = { orientations: 1 };

test('everything that fits on the first hide stays on it', () => {
  const { layouts, noFit } = nestAcrossHides(
    [hide('only', 100, 100)],
    [part('a', 20, 20), part('b', 20, 20)],
    opts
  );

  assert.equal(layouts.length, 1);
  assert.equal(layouts[0].hideId, 'only');
  assert.equal(layouts[0].placements.length, 2);
  assert.deepEqual(noFit, []);
});

test('what does not fit spills onto the next hide', () => {
  // The small hide holds one 40x40 and no more; the second takes the rest.
  const { layouts, noFit } = nestAcrossHides(
    [hide('small', 45, 45), hide('big', 200, 200)],
    [part('a', 40, 40), part('b', 40, 40), part('c', 40, 40)],
    opts
  );

  assert.deepEqual(noFit, [], 'all three are placed somewhere');
  assert.equal(layouts.length, 2);
  assert.equal(layouts[0].hideId, 'small');
  assert.equal(layouts[0].placements.length, 1);
  assert.equal(layouts[1].hideId, 'big');
  assert.equal(layouts[1].placements.length, 2);
});

test('hides are used smallest first, so offcuts go before whole skins', () => {
  // Handed largest-first on purpose: the ordering must be the function's, not
  // the caller's. One part, and it fits either -- so which hide it lands on
  // is entirely the policy.
  const { layouts } = nestAcrossHides(
    [hide('whole-skin', 300, 300), hide('offcut', 60, 60)],
    [part('a', 50, 50)],
    opts
  );

  assert.equal(layouts.length, 1);
  assert.equal(layouts[0].hideId, 'offcut', 'the scrap is consumed, the skin is kept whole');
});

test('a part too big for every hide is reported, not silently dropped', () => {
  const { layouts, noFit } = nestAcrossHides(
    [hide('a', 50, 50), hide('b', 60, 60)],
    [part('fits', 40, 40), part('enormous', 500, 500)],
    opts
  );

  assert.deepEqual(noFit, ['enormous']);
  assert.equal(layouts.flatMap((l) => l.placements).length, 1);
});

test('no part is ever placed twice', () => {
  // The spill loop removes placed parts from the remaining list. Getting that
  // wrong would cut the same piece on two hides, which wastes real leather.
  const { layouts } = nestAcrossHides(
    [hide('a', 100, 100), hide('b', 100, 100), hide('c', 100, 100)],
    Array.from({ length: 6 }, (_, i) => part(`p${i}`, 30, 30)),
    opts
  );

  const placed = layouts.flatMap((l) => l.placements.map((p) => p.id));
  assert.equal(new Set(placed).size, placed.length, `duplicate placements: ${placed}`);
});

test('a hide a part cannot legally be cut from is skipped for that part', () => {
  // Species and thickness vary per hide, so eligibility is per hide-and-part.
  // Without this the nester would happily lay a caiman piece on a python hide.
  const hides = [
    { id: 'python', polygon: rect(100, 100), species: 'python' },
    { id: 'caiman', polygon: rect(100, 100), species: 'caiman' },
  ];
  const parts = [part('caiman-only', 40, 40, { species: 'caiman' })];

  const { layouts, noFit } = nestAcrossHides(hides, parts, {
    ...opts,
    eligibleFor: (h, p) => h.species === p.species,
  });

  assert.deepEqual(noFit, []);
  assert.equal(layouts.length, 1);
  assert.equal(layouts[0].hideId, 'caiman');
});

test('a hide nothing fits on produces no layout at all', () => {
  // An empty layout would read as "this hide was used", and would put a hide
  // with nothing on it into a cut file.
  const { layouts } = nestAcrossHides(
    [hide('too-small', 5, 5), hide('fine', 100, 100)],
    [part('a', 40, 40)],
    opts
  );

  assert.equal(layouts.length, 1);
  assert.equal(layouts[0].hideId, 'fine');
});

test('empty inputs are answered, not crashed on', () => {
  assert.deepEqual(nestAcrossHides([], [part('a', 10, 10)], opts), {
    layouts: [],
    noFit: ['a'],
  });
  assert.deepEqual(nestAcrossHides([hide('a', 100, 100)], [], opts), {
    layouts: [],
    noFit: [],
  });
});

test('later hides are not consulted once everything is placed', () => {
  // Nesting is expensive -- six orientations of a full NFP scan per hide --
  // so a finished job must stop rather than walk the rest of the library.
  let consulted = 0;
  nestAcrossHides(
    [hide('a', 100, 100), hide('b', 100, 100), hide('c', 100, 100)],
    [part('only', 20, 20)],
    {
      ...opts,
      eligibleFor: (h, p) => {
        consulted++;
        return true;
      },
    }
  );
  assert.equal(consulted, 1, 'only the first hide should have been considered');
});
