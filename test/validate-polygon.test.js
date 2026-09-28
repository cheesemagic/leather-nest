import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePolygon,
  polygonArea,
  MAX_DIMENSION_MM,
  MIN_AREA_SQ_MM,
} from '../src/nesting/geometry.js';

// Added 2026-09-27. Nothing checked an outline before it was written to a
// record, in either direction it arrives from -- OpenCV or an uploaded SVG.

const SQUARE = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

test('a plain rectangle is accepted', () => {
  assert.equal(validatePolygon(SQUARE), null);
});

test('a concave outline is accepted — concave is normal here, not an error', () => {
  // Most real hides are concave, and the nester handles them exactly.
  const lShape = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 40 },
    { x: 40, y: 40 },
    { x: 40, y: 100 },
    { x: 0, y: 100 },
  ];
  assert.equal(validatePolygon(lShape), null);
});

test('a repeated closing point is tolerated, not rejected', () => {
  // Plenty of drawing tools write the first point again to close a path, and
  // every function in this module treats a point array as already closed.
  const closed = [...SQUARE, { x: 0, y: 0 }];
  assert.equal(validatePolygon(closed), null);
});

test('a closing point does not let a triangle through as a two-sided shape', () => {
  const degenerate = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 0 }];
  assert.match(validatePolygon(degenerate), /at least 3 points/);
});

test('a bow tie is refused — it has two insides, not one', () => {
  // The case that motivated this. clipper does not complain about a
  // self-crossing path, it applies a fill rule and answers containment
  // questions with confidence about the wrong region.
  //
  // Lopsided on purpose. A SYMMETRIC bow tie has two equal lobes wound in
  // opposite directions, so the shoelace sum cancels to exactly zero and the
  // area check catches it first -- see the test below. This one has to reach
  // the crossing check to be caught at all.
  const bowTie = [
    { x: 0, y: 0 },
    { x: 100, y: 80 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
  ];
  assert.match(validatePolygon(bowTie), /crosses itself/);
});

test('a self-crossing outline with real area on both sides is refused', () => {
  const crossedPentagon = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 20, y: 60 },
    { x: 50, y: -20 },
    { x: 80, y: 60 },
  ];
  assert.ok(polygonArea(crossedPentagon) > 1000, 'this one is not caught by area');
  assert.match(validatePolygon(crossedPentagon), /crosses itself/);
});

test('a symmetric bow tie is refused by area, its two lobes cancelling out', () => {
  // Worth pinning: the shoelace sum is signed, so equal lobes wound opposite
  // ways sum to nothing. Either refusal is correct; this records which fires.
  const symmetric = [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
  ];
  assert.equal(polygonArea(symmetric), 0);
  assert.match(validatePolygon(symmetric), /encloses no area/);
});

test('a shape that only touches itself at a vertex is still accepted', () => {
  // Touching is not crossing. simplifyPolygon leaves collinear runs behind and
  // traced outlines double back along an edge, so rejecting contact would
  // reject real hides.
  const pinched = [
    { x: 0, y: 0 },
    { x: 50, y: 50 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  assert.equal(validatePolygon(pinched), null);
});

test('three collinear points are refused for enclosing nothing', () => {
  const flat = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }];
  assert.match(validatePolygon(flat), /encloses no area/);
});

test('a pile of identical points is refused however many there are', () => {
  // Three trips the point-count check rather than the area one, because the
  // repeated-closing-point rule strips the last of them first. Both are
  // refusals; the shape of the message is not worth pinning here, only that
  // nothing this degenerate is ever accepted.
  for (const count of [3, 4, 5, 8]) {
    const pile = Array.from({ length: count }, () => ({ x: 7, y: 7 }));
    assert.ok(validatePolygon(pile), `${count} identical points must be refused`);
  }
  assert.match(validatePolygon(Array.from({ length: 4 }, () => ({ x: 7, y: 7 }))), /encloses no area/);
});

test('a shape smaller than a square millimetre is refused', () => {
  const speck = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 0.5 }];
  assert.ok(polygonArea(speck) < MIN_AREA_SQ_MM);
  assert.match(validatePolygon(speck), /encloses no area/);
});

test('an outline larger than ten metres is refused, and the message blames the unit', () => {
  // The realistic cause is an SVG read as the wrong unit, which lands 10x to
  // 100x out. Naming the unit is the whole point of the message.
  const huge = [
    { x: 0, y: 0 },
    { x: MAX_DIMENSION_MM + 1, y: 0 },
    { x: MAX_DIMENSION_MM + 1, y: 500 },
    { x: 0, y: 500 },
  ];
  const error = validatePolygon(huge);
  assert.match(error, /too large to be real/);
  assert.match(error, /unit/);
});

test('a hide-sized outline is comfortably inside the size ceiling', () => {
  // Two metres: larger than any real hide, so the ceiling is a unit-error trap
  // and not a constraint anyone will hit legitimately.
  const bigHide = [
    { x: 0, y: 0 },
    { x: 2000, y: 0 },
    { x: 2000, y: 1200 },
    { x: 0, y: 1200 },
  ];
  assert.equal(validatePolygon(bigHide), null);
});

test('NaN and Infinity coordinates are refused', () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    const polygon = [{ x: 0, y: 0 }, { x: bad, y: 0 }, { x: 10, y: 10 }];
    assert.match(validatePolygon(polygon), /not a pair of numbers/, `${bad} must be refused`);
  }
});

test('a missing or malformed outline is refused rather than throwing', () => {
  for (const bad of [null, undefined, 'a polygon', 42, {}]) {
    assert.match(validatePolygon(bad), /missing/);
  }
  assert.match(validatePolygon([]), /at least 3 points/);
  assert.match(validatePolygon([{ x: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }]), /not a pair of numbers/);
  assert.match(validatePolygon([null, { x: 1, y: 1 }, { x: 2, y: 2 }]), /not a pair of numbers/);
});

test('every refusal reads as a sentence an operator could act on', () => {
  const broken = [
    [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }],
    [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }],
    [{ x: 0, y: 0 }, { x: 20000, y: 0 }, { x: 20000, y: 500 }],
  ];
  for (const polygon of broken) {
    const error = validatePolygon(polygon);
    assert.equal(typeof error, 'string');
    assert.ok(error.length > 20, `too terse to help: ${error}`);
    assert.doesNotMatch(error, /polygon|vertex|vertices|NaN|undefined/i, `jargon leaked: ${error}`);
  }
});
