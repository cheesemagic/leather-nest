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

// ---- group atomicity (product set spec, 2026-09-26) ----

// Parts carrying a group key: every member must land on one hide or none.
const grouped = (id, w, h, group) => ({ ...part(id, w, h), group });
const byGroup = (p) => p.group ?? null;

test('a group that fits entirely stays together on one hide', () => {
  const { layouts, noFit } = nestAcrossHides(
    [hide('only', 200, 200)],
    [grouped('a', 40, 40, 'set0'), grouped('b', 40, 40, 'set0')],
    { ...opts, groupOf: byGroup }
  );

  assert.deepEqual(noFit, []);
  assert.equal(layouts.length, 1);
  assert.equal(layouts[0].placements.length, 2);
});

test('a group that only half fits is returned whole to the next hide', () => {
  // The small hide takes exactly one 40x40. Without rollback it would keep
  // that one piece and orphan its partner on another hide -- which is the
  // visible mismatch the whole flag exists to prevent.
  const { layouts, noFit } = nestAcrossHides(
    [hide('small', 45, 45), hide('big', 200, 200)],
    [grouped('a', 40, 40, 'set0'), grouped('b', 40, 40, 'set0')],
    { ...opts, groupOf: byGroup }
  );

  assert.deepEqual(noFit, []);
  assert.equal(layouts.length, 1, 'the small hide produced no layout at all');
  assert.equal(layouts[0].hideId, 'big');
  assert.equal(layouts[0].placements.length, 2, 'both members landed together');
});

test('rolling one group back does not evict an ungrouped part from the same hide', () => {
  // 45x70 deliberately: one 40x40 group member fits, its partner cannot (two
  // would need 80mm either way), and the 20x20 loose part still fits the
  // leftover band. So the group must roll back while the loose part stays.
  const { layouts } = nestAcrossHides(
    [hide('small', 45, 70), hide('big', 200, 200)],
    [
      grouped('pair-a', 40, 40, 'set0'),
      grouped('pair-b', 40, 40, 'set0'),
      part('loose', 20, 20),
    ],
    { ...opts, groupOf: byGroup }
  );

  const small = layouts.find((l) => l.hideId === 'small');
  const big = layouts.find((l) => l.hideId === 'big');
  assert.ok(small, 'the small hide still carries the ungrouped part');
  assert.deepEqual(small.placements.map((p) => p.id), ['loose']);
  assert.equal(big.placements.length, 2);
});

test('two different groups are kept apart from one another', () => {
  // Each set must be whole, but two sets need not share a hide.
  const { layouts, noFit } = nestAcrossHides(
    [hide('a', 95, 45), hide('b', 95, 45)],
    [
      grouped('s0-a', 40, 40, 'set0'), grouped('s0-b', 40, 40, 'set0'),
      grouped('s1-a', 40, 40, 'set1'), grouped('s1-b', 40, 40, 'set1'),
    ],
    { ...opts, groupOf: byGroup }
  );

  assert.deepEqual(noFit, []);
  for (const layout of layouts) {
    const groups = new Set(layout.placements.map((p) => p.id.slice(0, 2)));
    assert.equal(groups.size, 1, `hide ${layout.hideId} mixed two sets`);
  }
});

test('a group that fits nowhere is reported whole, not in pieces', () => {
  const { layouts, noFit } = nestAcrossHides(
    [hide('small', 45, 45)],
    [grouped('a', 40, 40, 'set0'), grouped('b', 40, 40, 'set0')],
    { ...opts, groupOf: byGroup }
  );

  assert.equal(layouts.length, 0);
  assert.deepEqual(noFit.sort(), ['a', 'b'], 'neither half is left placed');
});

test('parts with no group are unaffected by group handling', () => {
  // groupOf returning null is the default for every part in a plain job.
  const { layouts, noFit } = nestAcrossHides(
    [hide('only', 200, 200)],
    [part('x', 30, 30), part('y', 30, 30)],
    { ...opts, groupOf: () => null }
  );
  assert.deepEqual(noFit, []);
  assert.equal(layouts[0].placements.length, 2);
});
