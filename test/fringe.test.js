// test/fringe.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slitPositions,
  fringedStrip,
  fringeToSVG,
  DEFAULT_STRAND_WIDTH_MM,
} from '../src/fringe.js';

const strip = (overrides = {}) =>
  fringedStrip({ lengthMm: 200, widthMm: 60, fringeDepthMm: 45, ...overrides });

test('strands come out even, with the rounding spread across all of them', () => {
  // 200mm strip, 3mm margins, 5mm strands: 194 usable does not divide evenly.
  // Every strand must still be identical — a runt strand at the edge is the
  // most visible and the most likely to tear off.
  const { positions, strandCount, actualStrandWidth } = slitPositions({
    lengthMm: 200,
    strandWidthMm: 5,
    marginMm: 3,
  });

  assert.equal(strandCount, 39);
  assert.equal(positions.length, strandCount - 1, 'n strands need n-1 cuts');
  const gaps = positions.slice(1).map((x, i) => x - positions[i]);
  for (const gap of gaps) {
    assert.ok(Math.abs(gap - actualStrandWidth) < 1e-9, `uneven strand: ${gap}`);
  }
});

test('the outer strands are full width, not offcuts of the remainder', () => {
  const { positions, actualStrandWidth } = slitPositions({
    lengthMm: 200, strandWidthMm: 5, marginMm: 3,
  });
  const firstStrand = positions[0] - 3;
  const lastStrand = 200 - 3 - positions[positions.length - 1];
  assert.ok(Math.abs(firstStrand - actualStrandWidth) < 1e-9);
  assert.ok(Math.abs(lastStrand - actualStrandWidth) < 1e-9);
});

test('slits stay clear of both ends', () => {
  const { positions } = slitPositions({ lengthMm: 200, strandWidthMm: 5, marginMm: 3 });
  assert.ok(positions[0] >= 3, 'first slit ran into the end margin');
  assert.ok(positions[positions.length - 1] <= 197, 'last slit ran into the end margin');
});

test('the strip stays in one piece — slits stop short of the far edge', () => {
  const result = strip();
  assert.equal(result.headerMm, 15);
  assert.ok(result.headerMm > 0, 'no header means the strands fall off');

  const svg = fringeToSVG(result);
  for (const [, y2] of svg.matchAll(/y2="([\d.]+)"/g)) {
    assert.ok(Number(y2) > 0, 'a slit reached the top edge and freed a strand');
  }
});

test('fringe deeper than the strip is refused, with the reason', () => {
  assert.throws(
    () => strip({ fringeDepthMm: 60 }),
    /separate pieces instead of fringe/
  );
  assert.throws(() => strip({ fringeDepthMm: 75 }), /must be less than/);
});

test('a strip too short to fringe says so rather than producing nothing', () => {
  assert.throws(() => strip({ lengthMm: 5, marginMm: 3 }), /no room for fringe/);
});

test('nonsense measurements are refused, not silently accepted', () => {
  assert.throws(() => strip({ lengthMm: 0 }), /length/i);
  assert.throws(() => strip({ widthMm: -10 }), /width/i);
  assert.throws(() => strip({ fringeDepthMm: 0 }), /depth/i);
  assert.throws(() => strip({ strandWidthMm: 0 }), /strand/i);
  assert.throws(() => strip({ marginMm: -1 }), /margin/i);
});

test('a very wide strand setting still yields one strand, not zero', () => {
  const { strandCount, positions } = slitPositions({
    lengthMm: 50, strandWidthMm: 500, marginMm: 3,
  });
  assert.equal(strandCount, 1);
  assert.equal(positions.length, 0, 'one strand needs no cuts at all');
});

test('the kerf eats into every strand from both sides', () => {
  // Each slit widens by a full kerf, so a strand loses half a kerf per side.
  // On 5mm strands a 0.3mm kerf is 6% of the strand — worth reporting.
  const plain = strip();
  const cut = strip({ kerfMm: 0.3 });

  assert.equal(plain.finishedStrandWidthMm, plain.strandWidthMm);
  assert.ok(
    Math.abs(cut.finishedStrandWidthMm - (cut.strandWidthMm - 0.3)) < 1e-9,
    `finished ${cut.finishedStrandWidthMm} vs drawn ${cut.strandWidthMm}`
  );
  assert.equal(cut.strandWidthMm, plain.strandWidthMm, 'the drawn size should not move');
});

test('the file has one line per slit plus the outline', () => {
  const result = strip();
  const svg = fringeToSVG(result);
  const lines = [...svg.matchAll(/<line /g)].length;
  const polygons = [...svg.matchAll(/<polygon /g)].length;

  assert.equal(lines, result.slitPositions.length);
  assert.equal(polygons, 1);
  assert.match(svg, /width="200mm" height="60mm"/);
});

test('the default strand width is a stated assumption, not a measurement', () => {
  // Nobody has cut fringe. 5mm is a starting point to be replaced once
  // someone has seen how narrow leather strands can go before they tear.
  assert.equal(DEFAULT_STRAND_WIDTH_MM, 5);
});
